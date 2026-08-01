import type {
  BlockerDiagnosis,
  DispatchDiagnostic,
  ModelExecutionDiagnostic,
} from "./contracts";

const ACTIVE_EXECUTION = new Set([
  "running",
  "request_started",
  "response_received",
]);

export function diagnoseBlockers(input: {
  now: Date;
  job: {
    status: string;
    stage: string;
    leaseExpiresAt: string | null;
    lastHeartbeatAt: string | null;
    updatedAt: string;
  };
  executions: ModelExecutionDiagnostic[];
  dispatches: DispatchDiagnostic[];
}): BlockerDiagnosis[] {
  const findings: BlockerDiagnosis[] = [];
  const activeExecution = [...input.executions]
    .reverse()
    .find((execution) => ACTIVE_EXECUTION.has(execution.status));
  const latestExecution = input.executions.at(-1);
  const latestDispatch = input.dispatches.at(-1);
  const location = {
    stage: input.job.stage,
    operation: activeExecution?.operation ?? latestExecution?.operation ?? null,
    componentKey:
      activeExecution?.componentKey ?? latestExecution?.componentKey ?? null,
  };

  if (input.job.status === "cancelling") {
    const cancellationDispatch = [...input.dispatches]
      .reverse()
      .find(
        (dispatch) =>
          Date.parse(dispatch.createdAt) >= Date.parse(input.job.updatedAt),
      );
    if (!cancellationDispatch) {
      findings.push({
        code: "cancellation_not_dispatched",
        severity: "error",
        certainty: "deterministic",
        location,
        since: input.job.updatedAt,
        matchedRule: "job_cancelling_without_post_request_dispatch",
        evidence: [
          { source: "job", field: "status", value: "cancelling" },
          {
            source: "outbox",
            field: "dispatchCreatedAfterCancellation",
            value: false,
          },
        ],
        missingEvidence: [],
        recommendedNextInspection:
          "Inspect the cancellation dispatch path; a dead worker cannot finalize this cancellation.",
      });
    }
  }

  if (
    input.job.status === "running" &&
    input.job.leaseExpiresAt &&
    Date.parse(input.job.leaseExpiresAt) < input.now.getTime()
  ) {
    findings.push({
      code: "worker_lease_expired",
      severity: "error",
      certainty: "deterministic",
      location,
      since: input.job.leaseExpiresAt,
      matchedRule: "running_job_with_expired_lease",
      evidence: [
        {
          source: "job",
          field: "leaseExpiresAt",
          value: input.job.leaseExpiresAt,
        },
        { source: "job", field: "status", value: input.job.status },
      ],
      missingEvidence: input.job.lastHeartbeatAt ? [] : ["worker heartbeat"],
      recommendedNextInspection:
        "Inspect recovery dispatch and the active model execution before retrying.",
    });
  }

  if (
    activeExecution?.leaseExpiresAt &&
    Date.parse(activeExecution.leaseExpiresAt) < input.now.getTime()
  ) {
    if (activeExecution.status === "response_received") {
      findings.push({
        code: "model_response_processing_stalled",
        severity: "error",
        certainty: "deterministic",
        location,
        since: activeExecution.leaseExpiresAt,
        matchedRule: "received_model_response_not_published_before_lease_expiry",
        evidence: [
          {
            source: "model_execution",
            field: "status",
            value: activeExecution.status,
          },
          {
            source: "model_execution",
            field: "responseReceivedAt",
            value: activeExecution.responseReceivedAt,
          },
          {
            source: "model_execution",
            field: "contentState",
            value: activeExecution.contentState,
          },
        ],
        missingEvidence: ["parsed provider response body"],
        recommendedNextInspection:
          "The provider responded, but parsing or persistence did not complete. Do not classify this as an unknown provider outcome.",
      });
    } else {
      findings.push({
        code: "model_unknown_outcome",
        severity: "error",
        certainty: "suspected",
        location,
        since: activeExecution.leaseExpiresAt,
        matchedRule:
          "active_model_execution_lease_expired_without_durable_result",
        evidence: [
          {
            source: "model_execution",
            field: "status",
            value: activeExecution.status,
          },
          {
            source: "model_execution",
            field: "leaseExpiresAt",
            value: activeExecution.leaseExpiresAt,
          },
          {
            source: "model_execution",
            field: "rawSavedAt",
            value: activeExecution.rawSavedAt,
          },
        ],
        missingEvidence: [
          "provider response outcome",
          "worker invocation finish",
        ],
        recommendedNextInspection:
          "Do not automatically repeat the provider request until its outcome is reviewed.",
      });
    }
  }

  if (latestExecution?.status === "validation_failed") {
    findings.push({
      code: "model_validation_failed",
      severity: "error",
      certainty: "deterministic",
      location,
      since: latestExecution.completedAt,
      matchedRule: "latest_model_execution_validation_failed",
      evidence: [
        {
          source: "model_execution",
          field: "status",
          value: latestExecution.status,
        },
        {
          source: "model_execution",
          field: "failureCategory",
          value: latestExecution.failureCategory,
        },
      ],
      missingEvidence: [],
      recommendedNextInspection:
        "Inspect the sanitized validation error and schema contract.",
    });
  }

  if (latestExecution?.failureCategory === "reasoning_budget_exhausted") {
    findings.push({
      code: "reasoning_budget_exhausted",
      severity: "error",
      certainty: "deterministic",
      location,
      since: latestExecution.completedAt,
      matchedRule: "structured_output_budget_consumed_by_reasoning",
      evidence: [
        {
          source: "model_execution",
          field: "effectiveReasoningEffort",
          value: latestExecution.effectiveReasoningEffort,
        },
        {
          source: "model_execution",
          field: "reasoningTokens",
          value: latestExecution.reasoningTokens,
        },
        {
          source: "model_execution",
          field: "contentLength",
          value: latestExecution.contentLength,
        },
        {
          source: "model_execution",
          field: "finishReason",
          value: latestExecution.finishReason,
        },
      ],
      missingEvidence: [],
      recommendedNextInspection:
        "Verify the operation reasoning policy and resume from the saved planning revision; increasing output capacity is not the first remedy.",
    });
  } else if (latestExecution?.failureCategory === "split_required") {
    findings.push({
      code: "structured_operation_requires_split",
      severity: "error",
      certainty: "deterministic",
      location,
      since: latestExecution.completedAt,
      matchedRule: "structured_output_exceeded_hard_capacity",
      evidence: [
        {
          source: "model_execution",
          field: "operation",
          value: latestExecution.operation,
        },
        {
          source: "model_execution",
          field: "effectiveMaxTokens",
          value: latestExecution.effectiveMaxTokens,
        },
      ],
      missingEvidence: [],
      recommendedNextInspection:
        "Resume through the operation-specific planning revision instead of repeating the same execution key.",
    });
  }

  if (
    latestDispatch?.status === "pending" &&
    input.now.getTime() - Date.parse(latestDispatch.createdAt) > 120_000
  ) {
    findings.push({
      code: "outbox_pending_too_long",
      severity: "warning",
      certainty: "deterministic",
      location,
      since: latestDispatch.createdAt,
      matchedRule: "pending_outbox_older_than_two_minutes",
      evidence: [
        { source: "outbox", field: "status", value: latestDispatch.status },
        {
          source: "outbox",
          field: "deliveryAttempts",
          value: latestDispatch.deliveryAttempts,
        },
      ],
      missingEvidence: [],
      recommendedNextInspection: "Inspect server-side outbox dispatch.",
    });
  }

  return findings;
}
