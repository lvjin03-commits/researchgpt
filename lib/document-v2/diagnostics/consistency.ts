import type {
  BlockerDiagnosis,
  DispatchDiagnostic,
  ModelExecutionDiagnostic,
} from "./contracts";

export function diagnoseConsistency(input: {
  stage: string;
  executions: ModelExecutionDiagnostic[];
  dispatches: DispatchDiagnostic[];
}): BlockerDiagnosis[] {
  const findings: BlockerDiagnosis[] = [];
  for (const execution of input.executions) {
    if (execution.status === "succeeded" && !execution.rawSavedAt) {
      findings.push({
        code: "diagnostic_state_inconsistency",
        severity: "warning",
        certainty: "deterministic",
        location: {
          stage: input.stage,
          operation: execution.operation,
          componentKey: execution.componentKey,
        },
        since: execution.completedAt,
        matchedRule: "succeeded_execution_without_raw_saved_timestamp",
        evidence: [
          {
            source: "model_execution",
            field: "status",
            value: execution.status,
          },
          {
            source: "model_execution",
            field: "rawSavedAt",
            value: execution.rawSavedAt,
          },
        ],
        missingEvidence: [],
        recommendedNextInspection:
          "Check whether this execution predates the reliability migration or missed response persistence.",
      });
    }
    if (
      execution.responseReceivedAt &&
      execution.startedAt &&
      Date.parse(execution.responseReceivedAt) <
        Date.parse(execution.startedAt)
    ) {
      findings.push({
        code: "timeline_timestamp_inconsistency",
        severity: "warning",
        certainty: "deterministic",
        location: {
          stage: input.stage,
          operation: execution.operation,
          componentKey: execution.componentKey,
        },
        since: execution.responseReceivedAt,
        matchedRule: "response_received_before_execution_started",
        evidence: [
          {
            source: "model_execution",
            field: "startedAt",
            value: execution.startedAt,
          },
          {
            source: "model_execution",
            field: "responseReceivedAt",
            value: execution.responseReceivedAt,
          },
        ],
        missingEvidence: [],
        recommendedNextInspection: "Inspect execution timestamp writes.",
      });
    }
  }
  for (const dispatch of input.dispatches) {
    if (dispatch.status === "delivered" && !dispatch.deliveredAt) {
      findings.push({
        code: "diagnostic_state_inconsistency",
        severity: "warning",
        certainty: "deterministic",
        location: {
          stage: input.stage,
          operation: null,
          componentKey: null,
        },
        since: dispatch.createdAt,
        matchedRule: "delivered_outbox_without_delivered_timestamp",
        evidence: [
          { source: "outbox", field: "status", value: dispatch.status },
          {
            source: "outbox",
            field: "deliveredAt",
            value: dispatch.deliveredAt,
          },
        ],
        missingEvidence: [],
        recommendedNextInspection: "Inspect outbox delivery transaction.",
      });
    }
  }
  return findings;
}

