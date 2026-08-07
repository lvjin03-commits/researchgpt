const STRUCTURED_FAILURES = new Set([
  "no_json_object",
  "truncated_json",
  "json_syntax_error",
  "schema_validation_failed",
]);

const COMPONENT_OPERATION = "component.generate";

function countBy(values) {
  const counts = {};
  for (const value of values) {
    const key = String(value ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventOperation(event) {
  const payload = event?.event_payload ?? {};
  return String(payload.operation ?? payload.type ?? payload.code ?? "unknown");
}

function eventComponentKey(event) {
  const payload = event?.event_payload ?? {};
  const correlationId = payload.correlationId;
  return (
    payload.componentKey ??
    payload.component_key ??
    payload.correlation?.componentKey ??
    (typeof correlationId === "string" && correlationId.includes(":")
      ? correlationId.slice(correlationId.indexOf(":") + 1)
      : null)
  );
}

function eventFailureCode(event) {
  const payload = event?.event_payload ?? {};
  return String(
    payload.failureCode ??
      payload.errorCode ??
      payload.metadata?.errorCode ??
      payload.code ??
      payload.evidence?.failureCode ??
      "unknown",
  );
}

function isFigureFailureEvent(event) {
  const payload = event?.event_payload ?? {};
  return (
    event.stage === "asset_generation" &&
    event.status === "failed" &&
    (payload.category === "image" || eventOperation(event) === "component.failed")
  );
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function isExecutionFailure(execution) {
  return ["validation_failed", "failed", "unknown_outcome"].includes(execution.status);
}

function isStructuredFailure(execution) {
  return STRUCTURED_FAILURES.has(execution.failure_category);
}

function rootExecution(execution) {
  return !execution.parent_execution_key;
}

function operationFamily(operation) {
  if (operation === COMPONENT_OPERATION) return "component";
  if (operation === "request.understand" || operation === "template.match" || operation?.startsWith("outline.")) {
    return "planning";
  }
  return "other";
}

function executionGroupKey(execution) {
  return [execution.job_id, execution.component_key ?? "document", execution.operation].join("::");
}

function analyzeJob(job, executions, events) {
  const childrenByParent = groupBy(
    executions.filter((execution) => execution.parent_execution_key),
    (execution) => execution.parent_execution_key,
  );
  const componentExecutions = executions.filter((execution) => execution.operation === COMPONENT_OPERATION);
  const componentRootGroups = groupBy(componentExecutions.filter(rootExecution), executionGroupKey);
  const componentStructuredFailures = componentExecutions.filter(
    (execution) => isExecutionFailure(execution) && isStructuredFailure(execution),
  );
  const componentStructuredFailuresWithoutRecovery = componentStructuredFailures.filter(
    (execution) => !(childrenByParent.get(execution.execution_key)?.length > 0),
  );
  const componentOuterRetryGroups = [...componentRootGroups.values()].filter((group) => group.length > 1);

  const planningExecutions = executions.filter((execution) => operationFamily(execution.operation) === "planning");
  const planningRecoveryExecutions = planningExecutions.filter((execution) => execution.parent_execution_key);
  const planningRecoveredParents = new Set(
    planningRecoveryExecutions
      .filter((execution) => execution.status === "succeeded")
      .map((execution) => execution.parent_execution_key),
  );
  const figureFailureEvents = events.filter(isFigureFailureEvent);
  const componentFailureEvents = events.filter(
    (event) =>
      event.stage === "content_generation" &&
      event.status === "failed" &&
      eventOperation(event) === "component.failed",
  );

  return {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    modelExecutionCount: executions.length,
    providerCostUsd: executions.reduce((sum, execution) => sum + number(execution.calculated_cost_usd), 0),
    component: {
      rootExecutionCount: componentExecutions.filter(rootExecution).length,
      internalRecoveryExecutionCount: componentExecutions.filter((execution) => execution.parent_execution_key).length,
      structuredFailureCount: componentStructuredFailures.length,
      structuredFailureWithoutRecoveryCount: componentStructuredFailuresWithoutRecovery.length,
      potentiallyRecoverableWithoutOuterRetryCount: componentStructuredFailuresWithoutRecovery.length,
      outerRetryGroupCount: componentOuterRetryGroups.length,
      terminalFailureEventCount: componentFailureEvents.length,
      failureCategories: countBy(
        componentExecutions.filter(isExecutionFailure).map((execution) => execution.failure_category),
      ),
      affectedComponentKeys: [
        ...new Set(
          componentStructuredFailuresWithoutRecovery.map((execution) => execution.component_key).filter(Boolean),
        ),
      ].sort(),
    },
    planning: {
      executionCount: planningExecutions.length,
      internalRecoveryExecutionCount: planningRecoveryExecutions.length,
      recoveredParentCount: planningRecoveredParents.size,
      structuredFailureCount: planningExecutions.filter(
        (execution) => isExecutionFailure(execution) && isStructuredFailure(execution),
      ).length,
    },
    figures: {
      terminalFailureEventCount: figureFailureEvents.length,
      failureCodes: countBy(figureFailureEvents.map(eventFailureCode)),
      affectedComponentKeys: [...new Set(figureFailureEvents.map(eventComponentKey).filter(Boolean))].sort(),
    },
  };
}

export function analyzeDocumentV2FailureAttribution(input) {
  const jobs = [...input.jobs].sort((left, right) =>
    String(right.created_at).localeCompare(String(left.created_at)),
  );
  const executionsByJob = groupBy(input.executions, (row) => row.job_id);
  const eventsByJob = groupBy(input.events, (row) => row.job_id);
  const jobReports = jobs.map((job) =>
    analyzeJob(job, executionsByJob.get(job.id) ?? [], eventsByJob.get(job.id) ?? []),
  );
  const allComponentExecutions = input.executions.filter(
    (execution) => execution.operation === COMPONENT_OPERATION,
  );
  const allPlanningExecutions = input.executions.filter(
    (execution) => operationFamily(execution.operation) === "planning",
  );
  const componentStructuredFailures = allComponentExecutions.filter(
    (execution) => isExecutionFailure(execution) && isStructuredFailure(execution),
  );
  const executionChildrenByParent = groupBy(
    input.executions.filter((execution) => execution.parent_execution_key),
    (execution) => execution.parent_execution_key,
  );
  const unrecoveredComponentFailures = componentStructuredFailures.filter(
    (execution) => !(executionChildrenByParent.get(execution.execution_key)?.length > 0),
  );

  return {
    schemaVersion: "document-v2-failure-attribution-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    query: input.query,
    sourceCounts: { jobs: jobs.length, events: input.events.length, modelExecutions: input.executions.length },
    summary: {
      jobStatuses: countBy(jobs.map((job) => job.status)),
      jobStages: countBy(jobs.map((job) => job.stage)),
      providerCostUsd: input.executions.reduce(
        (sum, execution) => sum + number(execution.calculated_cost_usd),
        0,
      ),
      component: {
        executionCount: allComponentExecutions.length,
        structuredFailureCount: componentStructuredFailures.length,
        structuredFailureWithoutInternalRecoveryCount: unrecoveredComponentFailures.length,
        affectedJobCount: new Set(unrecoveredComponentFailures.map((execution) => execution.job_id)).size,
        outerRetryJobCount: jobReports.filter((job) => job.component.outerRetryGroupCount > 0).length,
        failureCategories: countBy(
          allComponentExecutions.filter(isExecutionFailure).map((execution) => execution.failure_category),
        ),
      },
      planning: {
        executionCount: allPlanningExecutions.length,
        internalRecoveryExecutionCount: allPlanningExecutions.filter(
          (execution) => execution.parent_execution_key,
        ).length,
        affectedJobCount: new Set(
          allPlanningExecutions
            .filter((execution) => execution.parent_execution_key)
            .map((execution) => execution.job_id),
        ).size,
      },
      figures: {
        terminalFailureEventCount: jobReports.reduce(
          (sum, job) => sum + job.figures.terminalFailureEventCount,
          0,
        ),
        affectedJobCount: jobReports.filter((job) => job.figures.terminalFailureEventCount > 0).length,
        failureCodes: countBy(
          input.events.filter(isFigureFailureEvent).map(eventFailureCode),
        ),
      },
    },
    jobs: jobReports,
    interpretation: {
      potentiallyRecoverableIsCounterfactual: true,
      note: "A missing internal recovery child identifies an unattempted recovery opportunity; it does not guarantee that a repair would have succeeded.",
    },
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function documentV2FailureAttributionCsv(report) {
  const headers = [
    "job_id", "status", "stage", "created_at", "model_executions", "provider_cost_usd",
    "component_structured_failures", "component_structured_failures_without_internal_recovery",
    "component_outer_retry_groups", "planning_internal_recoveries", "figure_rejections", "affected_components",
  ];
  const rows = report.jobs.map((job) => [
    job.jobId, job.status, job.stage, job.createdAt, job.modelExecutionCount, job.providerCostUsd.toFixed(8),
    job.component.structuredFailureCount, job.component.structuredFailureWithoutRecoveryCount,
    job.component.outerRetryGroupCount, job.planning.internalRecoveryExecutionCount,
    job.figures.terminalFailureEventCount,
    [...job.component.affectedComponentKeys, ...job.figures.affectedComponentKeys]
      .filter((value, index, values) => values.indexOf(value) === index)
      .join("|"),
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
