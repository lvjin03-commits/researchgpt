import type {
  BlockerDiagnosis,
  DiagnosticTimelineEvent,
  DispatchDiagnostic,
  DocumentJobDiagnostics,
  ModelExecutionDiagnostic,
} from "./contracts";
import { DOCUMENT_DIAGNOSTICS_VERSION } from "./contracts";
import { diagnoseBlockers } from "./blocker-rules";
import { diagnoseConsistency } from "./consistency";
import type { DiagnosticSources } from "./repository";
import {
  diagnosticFingerprint,
  maskIdentifier,
  sanitizeDiagnosticError,
} from "./redaction";

const ACTIVE_EXECUTION = new Set([
  "running",
  "request_started",
  "response_received",
]);

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
}

function objectArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
        .slice(0, 20)
    : [];
}

const PLANNING_DIAGNOSTIC_DETAIL_KEYS = new Set([
  "requestedLanguage",
  "violatingSectionOrders",
  "violatingFields",
  "sourceComponent",
  "sourceRevision",
  "repairAttemptCount",
  "safeResumeFrom",
]);

function parsePlanningDiagnosticDetails(value: unknown) {
  if (typeof value !== "string" || !value.trim().startsWith("{")) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, detail]) => {
        if (!PLANNING_DIAGNOSTIC_DETAIL_KEYS.has(key)) return [];
        if (["string", "number", "boolean"].includes(typeof detail)) {
          return [[key, detail]];
        }
        if (
          Array.isArray(detail) &&
          detail.every((item) =>
            ["string", "number", "boolean"].includes(typeof item),
          )
        ) {
          return [[key, detail.join(",")]];
        }
        return [];
      }),
    ) as Record<string, string | number | boolean>;
  } catch {
    return {};
  }
}

function planningFailureFinding(
  event: DiagnosticTimelineEvent | undefined,
): BlockerDiagnosis | null {
  if (event?.error?.code !== "outline_language_mismatch") return null;
  return {
    code: "outline_language_mismatch",
    severity: "error",
    certainty: "deterministic",
    location: {
      stage: event.stage ?? "planning",
      operation: event.operation ?? "outline.section_index",
      componentKey: event.componentKey ?? "document-section-index",
    },
    since: event.timestamp,
    matchedRule: "published_section_index_language_contract_failed",
    evidence: Object.entries(event.evidence).map(([field, value]) => ({
      source: "event",
      field,
      value,
    })),
    missingEvidence: [],
    recommendedNextInspection:
      "Resume from a new outline.section_index revision; preserve request, template, evidence, and thesis checkpoints.",
  };
}

function modelExecutionPersistenceFinding(
  event: DiagnosticTimelineEvent | undefined,
): BlockerDiagnosis | null {
  if (
    event?.error?.code !==
    "document_model_model_execution_persistence_failed"
  ) {
    return null;
  }
  return {
    code: "model_execution_persistence_failed",
    severity: "error",
    certainty: "deterministic",
    location: {
      stage: event.stage ?? null,
      operation: event.operation ?? null,
      componentKey: event.componentKey ?? null,
    },
    since: event.timestamp,
    matchedRule: "durable_model_execution_insert_failed",
    evidence: [
      {
        source: "event",
        field: "failureCode",
        value: event.error.code,
      },
      ...(event.error.fingerprint
        ? [
            {
              source: "event",
              field: "errorFingerprint",
              value: event.error.fingerprint,
            },
          ]
        : []),
    ],
    missingEvidence: [],
    recommendedNextInspection:
      "Inspect the model-execution persistence contract and database error code; the provider request was not started.",
  };
}

const DETERMINISTIC_CAPTION_FAILURES = new Set([
  "figure_caption_numbered",
  "table_caption_numbered",
]);

function captionFormatFailureFinding(
  event: DiagnosticTimelineEvent | undefined,
): BlockerDiagnosis | null {
  const code = event?.error?.code;
  if (!code || !DETERMINISTIC_CAPTION_FAILURES.has(code)) return null;
  return {
    code,
    severity: "warning",
    certainty: "deterministic",
    location: {
      stage: event.stage ?? "content_generation",
      operation: event.operation ?? "component.failed",
      componentKey: event.componentKey ?? null,
    },
    since: event.timestamp,
    matchedRule: "generated_caption_contains_renderer_owned_number",
    evidence: [
      {
        source: "event",
        field: "failureCode",
        value: code,
      },
      {
        source: "system",
        field: "availableRecoveryMechanism",
        value: "caption-v1",
      },
    ],
    missingEvidence: [],
    recommendedNextInspection:
      "Resume the failed component and reprocess its captions with the deterministic caption normalizer; do not restart planning.",
  };
}

const REFERENCE_CONSISTENCY_FAILURES = [
  {
    pattern: /Reference list does not include cited reference "([^"]+)"\.?/i,
    code: "reference_manifest_missing_cited_id",
    rule: "model_reference_list_omitted_approved_citation",
  },
  {
    pattern: /Reference list includes uncited reference "([^"]+)"\.?/i,
    code: "reference_manifest_contains_uncited_id",
    rule: "model_reference_list_added_uncited_reference",
  },
] as const;

function referenceConsistencyFailureFinding(
  event: DiagnosticTimelineEvent | undefined,
): BlockerDiagnosis | null {
  if (
    event?.componentKey !== "references" ||
    event.error?.code !== "component_structure_invalid" ||
    !event.error.message
  ) {
    return null;
  }
  const errorMessage = event.error.message;
  const match = REFERENCE_CONSISTENCY_FAILURES.map((failure) => ({
    ...failure,
    match: errorMessage.match(failure.pattern),
  })).find((failure) => failure.match);
  if (!match?.match) return null;

  return {
    code: match.code,
    severity: "error",
    certainty: "deterministic",
    location: {
      stage: event.stage ?? "content_generation",
      operation: event.operation ?? "component.failed",
      componentKey: "references",
    },
    since: event.timestamp,
    matchedRule: match.rule,
    evidence: [
      {
        source: "event",
        field: "failureCode",
        value: event.error.code,
      },
      {
        source: "event",
        field: "referenceId",
        value: match.match[1],
      },
    ],
    missingEvidence: [],
    recommendedNextInspection:
      "Rebuild the references component deterministically from approved citation occurrences; preserve mature content and verified references.",
  };
}

const LEGACY_PLACEMENT_FAILURES = [
  {
    pattern: /Table placement (\d+) is outside the paragraph list\.?/i,
    code: "table_placement_out_of_bounds",
    rule: "legacy_model_table_index_exceeds_paragraph_count",
  },
  {
    pattern: /Figure placement (\d+) is outside the paragraph list\.?/i,
    code: "figure_placement_out_of_bounds",
    rule: "legacy_model_figure_index_exceeds_paragraph_count",
  },
] as const;

function legacyPlacementFailureFinding(
  event: DiagnosticTimelineEvent | undefined,
): BlockerDiagnosis | null {
  if (
    event?.error?.code !== "component_generation_failed" ||
    !event.error.message
  ) {
    return null;
  }
  const match = LEGACY_PLACEMENT_FAILURES.map((failure) => ({
    ...failure,
    match: event.error!.message!.match(failure.pattern),
  })).find((failure) => failure.match);
  if (!match?.match) return null;
  return {
    code: match.code,
    severity: "warning",
    certainty: "deterministic",
    location: {
      stage: event.stage ?? "content_generation",
      operation: event.operation ?? "component.failed",
      componentKey: event.componentKey ?? null,
    },
    since: event.timestamp,
    matchedRule: match.rule,
    evidence: [
      {
        source: "event",
        field: "requestedPlacementIndex",
        value: Number(match.match[1]),
      },
      {
        source: "system",
        field: "availableRecoveryMechanism",
        value: "legacy-layout-parser-replay-v1",
      },
    ],
    missingEvidence: [],
    recommendedNextInspection:
      "Reparse the saved component response, derive a valid layout anchor deterministically, and continue without another model call.",
  };
}

export function projectDocumentJobDiagnostics(
  sources: DiagnosticSources,
  now = new Date(),
): DocumentJobDiagnostics {
  const recordedCosts = new Map<string, number>();
  for (const event of sources.events) {
    const metadata =
      event.event_payload.metadata &&
      typeof event.event_payload.metadata === "object" &&
      !Array.isArray(event.event_payload.metadata)
        ? (event.event_payload.metadata as Record<string, unknown>)
        : {};
    const inputFingerprint =
      stringValue(metadata.generationConfigFingerprint) ??
      stringValue(metadata.inputFingerprint);
    const calculatedCostUsd = numberValue(metadata.calculatedCostUsd);
    if (inputFingerprint && calculatedCostUsd !== undefined) {
      recordedCosts.set(inputFingerprint, calculatedCostUsd);
    }
  }
  const executions: ModelExecutionDiagnostic[] = sources.executions.map(
    (row) => {
      const sanitizedError = sanitizeDiagnosticError(row.error_message);
      return {
        executionKey: row.execution_key,
        componentKey: row.component_key,
        operation: row.operation,
        inputFingerprint: row.input_fingerprint,
        contentInputFingerprint:
          row.content_input_fingerprint ?? row.input_fingerprint,
        generationConfigFingerprint: row.generation_config_fingerprint,
        attemptNumber: row.attempt_number,
        parentExecutionKey: row.parent_execution_key,
        escalationReason: row.escalation_reason,
        budgetEscalationCount: row.budget_escalation_count,
        expectedOutputTokens: row.expected_output_tokens,
        modelPhysicalMaxOutputTokens:
          row.model_physical_max_output_tokens,
        productMaxOutputTokens: row.product_max_output_tokens,
        operationHardMaxOutputTokens:
          row.operation_hard_max_output_tokens,
        generationBudgetPolicyVersion:
          row.generation_budget_policy_version,
        modelCapabilityVersion: row.model_capability_version,
        provider: row.provider,
        requestedModelId: row.requested_model_id,
        resolvedModelId: row.resolved_model_id,
        requestedReasoningEffort: row.requested_reasoning_effort,
        effectiveReasoningEffort: row.effective_reasoning_effort,
        providerReasoningMode: row.provider_reasoning_mode,
        providerReasoningPolicy: row.provider_reasoning_policy,
        providerReasoningPolicyVersion:
          row.provider_reasoning_policy_version,
        reasoningTokensObserved: row.reasoning_tokens_observed,
        actualModelId: row.actual_model_id,
        providerRequestFingerprint: diagnosticFingerprint(
          row.provider_request_id,
        ),
        status: row.status,
        attempt: row.attempt,
        leaseExpiresAt: row.lease_expires_at,
        startedAt: row.started_at,
        responseReceivedAt: row.response_received_at,
        rawSavedAt: row.raw_saved_at,
        completedAt: row.completed_at,
        failureCategory: row.failure_category,
        errorMessage: sanitizedError,
        errorFingerprint: diagnosticFingerprint(sanitizedError),
        finishReason: row.finish_reason,
        choiceCount: row.choice_count,
        contentState: row.content_state,
        contentLength: row.content_length,
        reasoningContentPresent: row.reasoning_content_present,
        reasoningContentLength: row.reasoning_content_length,
        auxiliaryContentHash: row.auxiliary_content_hash,
        auxiliaryContentLength: row.auxiliary_content_length,
        auxiliaryContentTypes: stringArray(row.auxiliary_content_types),
        responseSource: row.response_source,
        recoveryMode: row.recovery_mode,
        requestedMaxTokens: row.requested_max_tokens,
        effectiveMaxTokens: row.effective_max_tokens,
        visibleOutputTokens: row.visible_output_tokens,
        refusalPresent: row.refusal_present,
        toolCallCount: row.tool_call_count,
        inputTokens: row.input_tokens,
        cachedInputTokens: row.cached_input_tokens,
        outputTokens: row.output_tokens,
        reasoningTokens: row.reasoning_tokens,
        rawContentHash: row.raw_content_hash,
        sanitizedPreview: sanitizeDiagnosticError(row.sanitized_preview),
        providerResponseSavedAt: row.provider_response_saved_at,
        parseStartedAt: row.parse_started_at,
        parseCompletedAt: row.parse_completed_at,
        parseStatus: row.parse_status,
        parseErrorMessage: sanitizeDiagnosticError(row.parse_error_message),
        parseErrorPosition: row.parse_error_position,
        candidateCount: row.candidate_count,
        jsonValidCandidateCount: row.json_valid_candidate_count,
        schemaValidCandidateCount: row.schema_valid_candidate_count,
        repairSteps: stringArray(row.repair_steps),
        candidateDiagnostics: objectArray(row.candidate_diagnostics),
        parserVersion: row.parser_version,
        repairPipelineVersion: row.repair_pipeline_version,
        schemaVersion: row.schema_version,
        calculatedCostUsd:
          row.calculated_cost_usd ?? recordedCosts.get(
            row.generation_config_fingerprint ?? row.input_fingerprint,
          ) ?? null,
        pricingVersion: row.pricing_version,
        costStatus: row.cost_status,
      };
    },
  );
  const dispatches: DispatchDiagnostic[] = sources.outbox.map((row) => ({
    outboxId: row.id,
    eventType: row.event_type,
    status: row.status,
    deliveryAttempts: row.delivery_attempts,
    nextAttemptAt: row.next_attempt_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  }));
  const eventTimeline: DiagnosticTimelineEvent[] = sources.events.map((row) => {
    const payload = row.event_payload;
    const metadata =
      payload.metadata &&
      typeof payload.metadata === "object" &&
      !Array.isArray(payload.metadata)
        ? (payload.metadata as Record<string, unknown>)
        : {};
    const technicalMessage = stringValue(payload.technicalMessage);
    const planningDetails = parsePlanningDiagnosticDetails(technicalMessage);
    let diagnosticMessage = technicalMessage;
    if (technicalMessage?.trim().startsWith("{")) {
      try {
        diagnosticMessage = stringValue(
          (JSON.parse(technicalMessage) as Record<string, unknown>).message,
        );
      } catch {
        diagnosticMessage = technicalMessage;
      }
    }
    const sanitizedError = sanitizeDiagnosticError(diagnosticMessage);
    return {
      timestamp: stringValue(payload.createdAt) ?? row.created_at,
      source: "event",
      code: stringValue(payload.operation) ?? "job.event",
      status: stringValue(payload.status) ?? row.status,
      stage: stringValue(payload.stage) ?? row.stage,
      operation: stringValue(payload.operation),
      componentKey: stringValue(payload.componentKey),
      correlation: { jobId: sources.job.id },
      durationMs: numberValue(payload.durationMs),
      error: sanitizedError
        ? {
            category: stringValue(payload.category) ?? "event",
            code: stringValue(payload.errorCode),
            message: sanitizedError,
            fingerprint: diagnosticFingerprint(sanitizedError) ?? undefined,
          }
        : undefined,
      evidence: Object.fromEntries(
        Object.entries({ ...metadata, ...planningDetails })
          .filter(([, value]) =>
            ["string", "number", "boolean"].includes(typeof value),
          )
          .slice(0, 30),
      ) as Record<string, string | number | boolean | null>,
    };
  });
  const executionTimeline: DiagnosticTimelineEvent[] = executions.map(
    (execution) => ({
      timestamp:
        execution.completedAt ??
        execution.rawSavedAt ??
        execution.responseReceivedAt ??
        execution.startedAt ??
        sources.job.updated_at,
      source: "model_execution",
      code: `model_execution.${execution.status}`,
      status: execution.status,
      operation: execution.operation,
      componentKey: execution.componentKey ?? undefined,
      correlation: {
        jobId: sources.job.id,
        executionKey: execution.executionKey,
      },
      error: execution.errorMessage
        ? {
            category: execution.failureCategory ?? "model_execution",
            message: execution.errorMessage,
            fingerprint: execution.errorFingerprint ?? undefined,
          }
        : undefined,
      evidence: {
        provider: execution.provider,
        requestedModelId: execution.requestedModelId,
        actualModelId: execution.actualModelId,
        inputTokens: execution.inputTokens,
        outputTokens: execution.outputTokens,
        attemptNumber: execution.attemptNumber,
        parentExecutionKey: execution.parentExecutionKey,
        escalationReason: execution.escalationReason,
        expectedOutputTokens: execution.expectedOutputTokens,
        requestedMaxTokens: execution.requestedMaxTokens,
        effectiveMaxTokens: execution.effectiveMaxTokens,
        operationHardMaxOutputTokens:
          execution.operationHardMaxOutputTokens,
        modelPhysicalMaxOutputTokens:
          execution.modelPhysicalMaxOutputTokens,
        productMaxOutputTokens: execution.productMaxOutputTokens,
        rawSavedAt: execution.rawSavedAt,
        finishReason: execution.finishReason,
        choiceCount: execution.choiceCount,
        contentState: execution.contentState,
        contentLength: execution.contentLength,
        reasoningContentPresent: execution.reasoningContentPresent,
        reasoningContentLength: execution.reasoningContentLength,
        providerReasoningMode: execution.providerReasoningMode,
        providerReasoningPolicyVersion:
          execution.providerReasoningPolicyVersion,
        refusalPresent: execution.refusalPresent,
        toolCallCount: execution.toolCallCount,
        providerResponseSavedAt: execution.providerResponseSavedAt,
        parseStatus: execution.parseStatus,
        parseErrorPosition: execution.parseErrorPosition,
        candidateCount: execution.candidateCount,
        jsonValidCandidateCount: execution.jsonValidCandidateCount,
        schemaValidCandidateCount: execution.schemaValidCandidateCount,
        parserVersion: execution.parserVersion,
        repairPipelineVersion: execution.repairPipelineVersion,
        repairSteps: execution.repairSteps.join(",") || null,
      },
    }),
  );
  const outboxTimeline: DiagnosticTimelineEvent[] = dispatches.map(
    (dispatch) => ({
      timestamp: dispatch.deliveredAt ?? dispatch.createdAt,
      source: "outbox",
      code: `outbox.${dispatch.status}`,
      status: dispatch.status,
      correlation: {
        jobId: sources.job.id,
        outboxId: dispatch.outboxId,
      },
      evidence: {
        eventType: dispatch.eventType,
        deliveryAttempts: dispatch.deliveryAttempts,
        nextAttemptAt: dispatch.nextAttemptAt,
      },
    }),
  );
  const timeline = [
    ...eventTimeline,
    ...executionTimeline,
    ...outboxTimeline,
  ].sort(
    (left, right) =>
      Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
  const activeExecution = [...executions]
    .reverse()
    .find((execution) => ACTIVE_EXECUTION.has(execution.status));
  const latestEvent = eventTimeline.at(-1);
  const currentPosition = activeExecution
    ? {
        stage: latestEvent?.stage ?? sources.job.stage,
        operation: activeExecution.operation,
        componentKey: activeExecution.componentKey,
        executionKey: activeExecution.executionKey,
        derivedFrom: "model_execution" as const,
      }
    : latestEvent?.operation
      ? {
          stage: latestEvent.stage ?? sources.job.stage,
          operation: latestEvent.operation,
          componentKey: latestEvent.componentKey ?? null,
          executionKey: null,
          derivedFrom: "event" as const,
        }
      : {
          stage: sources.job.stage,
          operation: null,
          componentKey: null,
          executionKey: null,
          derivedFrom: "job" as const,
        };
  const jobSummary = {
    status: sources.job.status,
    stage: sources.job.stage,
    revision: sources.job.revision,
    leaseOwnerMasked: maskIdentifier(sources.job.lease_owner),
    leaseExpiresAt: sources.job.lease_expires_at,
    lastHeartbeatAt: sources.job.last_heartbeat_at,
    recoveryCount: sources.job.recovery_count,
    createdAt: sources.job.created_at,
    updatedAt: sources.job.updated_at,
  };
  const latestTimelineEvent = eventTimeline.at(-1);
  const latestPlanningFailure =
    ["paused", "failed"].includes(sources.job.status) &&
    latestTimelineEvent?.error?.code === "outline_language_mismatch"
      ? latestTimelineEvent
      : undefined;
  const planningFinding = planningFailureFinding(latestPlanningFailure);
  const persistenceFinding =
    ["paused", "failed"].includes(sources.job.status)
      ? modelExecutionPersistenceFinding(latestTimelineEvent)
      : null;
  const captionFinding =
    ["paused", "failed"].includes(sources.job.status)
      ? captionFormatFailureFinding(latestTimelineEvent)
      : null;
  const referenceFinding =
    ["paused", "failed"].includes(sources.job.status)
      ? referenceConsistencyFailureFinding(latestTimelineEvent)
      : null;
  const placementFinding =
    ["paused", "failed"].includes(sources.job.status)
      ? legacyPlacementFailureFinding(latestTimelineEvent)
      : null;
  const findings = [
    ...(planningFinding ? [planningFinding] : []),
    ...(persistenceFinding ? [persistenceFinding] : []),
    ...(captionFinding ? [captionFinding] : []),
    ...(referenceFinding ? [referenceFinding] : []),
    ...(placementFinding ? [placementFinding] : []),
    ...diagnoseBlockers({
      now,
      job: jobSummary,
      executions,
      dispatches,
    }),
    ...diagnoseConsistency({
      stage: sources.job.stage,
      executions,
      dispatches,
    }),
  ];
  const cost = executions.reduce(
    (total, execution) => ({
      inputTokens: total.inputTokens + execution.inputTokens,
      outputTokens: total.outputTokens + execution.outputTokens,
      cachedInputTokens:
        total.cachedInputTokens + execution.cachedInputTokens,
      reasoningTokens: total.reasoningTokens + execution.reasoningTokens,
      calculatedCostUsd:
        total.calculatedCostUsd + (execution.calculatedCostUsd ?? 0),
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      calculatedCostUsd: 0,
    },
  );
  const executionFingerprints = new Map<string, number>();
  for (const execution of executions) {
    const key = [
      execution.componentKey ?? "document",
      execution.operation,
      execution.contentInputFingerprint,
      execution.generationConfigFingerprint ?? "legacy-config",
    ].join(":");
    executionFingerprints.set(key, (executionFingerprints.get(key) ?? 0) + 1);
  }
  const duplicateRisk = [...executionFingerprints.values()].some(
    (count) => count > 1,
  );
  const incompleteSources = [
    "worker_invocations",
    "verified_checkpoint_projection",
    "provider_attempt_history",
  ];
  const timestamps = [
    sources.job.updated_at,
    ...timeline.map((event) => event.timestamp),
  ].filter(Boolean);
  const sourceMaxUpdatedAt = timestamps.sort(
    (left, right) => Date.parse(right) - Date.parse(left),
  )[0] ?? null;
  const primary = findings[0] ?? null;
  const safeResumeFrom =
    primary?.code === "outline_language_mismatch"
      ? "outline.section_index"
      : primary && DETERMINISTIC_CAPTION_FAILURES.has(primary.code)
        ? primary.location.componentKey
        : primary?.code.startsWith("reference_manifest_")
          ? "references"
          : primary?.code === "table_placement_out_of_bounds" ||
              primary?.code === "figure_placement_out_of_bounds"
            ? primary.location.componentKey
      : null;
  const workerState =
    sources.job.status === "running" && sources.job.lease_expires_at
      ? Date.parse(sources.job.lease_expires_at) < now.getTime()
        ? "lease_expired"
        : sources.job.last_heartbeat_at
          ? "active"
          : "not_observable"
      : "not_observable";
  const report = [
    "Document V2 Diagnostic Report",
    `Generated: ${now.toISOString()}`,
    "",
    "Job",
    `- Job ID: ${sources.job.id}`,
    `- Status: ${sources.job.status}`,
    `- Revision: ${sources.job.revision}`,
    `- Stage: ${sources.job.stage}`,
    "",
    "Current Position",
    `- Operation: ${currentPosition.operation ?? "unknown"}`,
    `- Derived from: ${currentPosition.derivedFrom}`,
    "",
    "Primary Finding",
    `- Code: ${primary?.code ?? "none"}`,
    `- Certainty: ${primary?.certainty ?? "insufficient_data"}`,
    "",
    "Last Durable Checkpoint",
    "- Verified: false",
    "- Reason: protected checkpoint content is intentionally not read by diagnostics v1",
    "",
    "Safe Resume",
    safeResumeFrom
      ? `- Resume from: ${safeResumeFrom}`
      : "- Not determined by diagnostics v1",
  ].join("\n");
  return {
    identity: {
      jobId: sources.job.id,
      pipelineVersion: "document-v2",
      diagnosticsVersion: DOCUMENT_DIAGNOSTICS_VERSION,
    },
    job: jobSummary,
    currentPosition,
    lastDurableCheckpoint: {
      code: null,
      savedAt: null,
      reusableOutputs: [],
      verified: false,
      verificationEvidence: [],
    },
    currentBlocker: primary,
    findings,
    timeline,
    modelExecutions: executions,
    dispatches,
    cost: { ...cost, duplicateRisk },
    health: {
      generatedAt: now.toISOString(),
      sourceMaxUpdatedAt,
      dataFreshnessMs: sourceMaxUpdatedAt
        ? Math.max(0, now.getTime() - Date.parse(sourceMaxUpdatedAt))
        : null,
      incompleteSources,
    },
    codexSummary: {
      jobStatus: sources.job.status,
      activeStage: currentPosition.stage,
      activeOperation: currentPosition.operation,
      activeComponent: currentPosition.componentKey,
      workerState,
      modelRequestState: activeExecution?.status ?? executions.at(-1)?.status ?? null,
      outboxState: dispatches.at(-1)?.status ?? null,
      cancellationState:
        sources.job.status === "cancelling"
          ? "requested_not_finalized"
          : sources.job.status === "cancelled"
            ? "completed"
            : null,
      lastSuccessfulCheckpoint: null,
      safeResumeFrom,
      duplicateRisk,
      incompleteEvidence: incompleteSources,
      primaryFindingCode: primary?.code ?? null,
    },
    humanReadableReport: report,
  };
}
