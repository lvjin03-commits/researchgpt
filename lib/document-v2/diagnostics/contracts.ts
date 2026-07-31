export const DOCUMENT_DIAGNOSTICS_VERSION =
  "document-v2-diagnostics/1.0" as const;

export type DiagnosticCertainty =
  | "deterministic"
  | "suspected"
  | "insufficient_data";

export type DiagnosticEvidence = {
  source: string;
  field: string;
  value: string | number | boolean | null;
};

export type BlockerDiagnosis = {
  code: string;
  severity: "info" | "warning" | "error";
  certainty: DiagnosticCertainty;
  location: {
    stage: string | null;
    operation: string | null;
    componentKey: string | null;
  };
  since: string | null;
  matchedRule: string;
  evidence: DiagnosticEvidence[];
  missingEvidence: string[];
  recommendedNextInspection: string | null;
};

export type DiagnosticTimelineEvent = {
  timestamp: string;
  source: "job" | "event" | "model_execution" | "outbox";
  code: string;
  status: string;
  stage?: string;
  operation?: string;
  componentKey?: string;
  correlation: {
    jobId: string;
    executionKey?: string;
    outboxId?: string;
  };
  durationMs?: number;
  error?: {
    category: string;
    code?: string;
    message?: string;
    fingerprint?: string;
  };
  evidence: Record<string, string | number | boolean | null>;
};

export type ModelExecutionDiagnostic = {
  executionKey: string;
  componentKey: string | null;
  operation: string;
  inputFingerprint: string;
  provider: string;
  requestedModelId: string;
  resolvedModelId: string;
  actualModelId: string | null;
  providerRequestFingerprint: string | null;
  status: string;
  attempt: number;
  leaseExpiresAt: string | null;
  startedAt: string | null;
  responseReceivedAt: string | null;
  rawSavedAt: string | null;
  completedAt: string | null;
  failureCategory: string | null;
  errorMessage: string | null;
  errorFingerprint: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  calculatedCostUsd: number | null;
};

export type DispatchDiagnostic = {
  outboxId: string;
  eventType: string;
  status: string;
  deliveryAttempts: number;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
};

export type DocumentJobDiagnostics = {
  identity: {
    jobId: string;
    pipelineVersion: "document-v2";
    diagnosticsVersion: typeof DOCUMENT_DIAGNOSTICS_VERSION;
  };
  job: {
    status: string;
    stage: string;
    revision: number;
    leaseOwnerMasked: string | null;
    leaseExpiresAt: string | null;
    lastHeartbeatAt: string | null;
    recoveryCount: number;
    createdAt: string;
    updatedAt: string;
  };
  currentPosition: {
    stage: string;
    operation: string | null;
    componentKey: string | null;
    executionKey: string | null;
    derivedFrom: "model_execution" | "event" | "job";
  };
  lastDurableCheckpoint: {
    code: string | null;
    savedAt: string | null;
    reusableOutputs: string[];
    verified: boolean;
    verificationEvidence: DiagnosticEvidence[];
  };
  currentBlocker: BlockerDiagnosis | null;
  findings: BlockerDiagnosis[];
  timeline: DiagnosticTimelineEvent[];
  modelExecutions: ModelExecutionDiagnostic[];
  dispatches: DispatchDiagnostic[];
  cost: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    calculatedCostUsd: number;
    duplicateRisk: boolean;
  };
  health: {
    generatedAt: string;
    sourceMaxUpdatedAt: string | null;
    dataFreshnessMs: number | null;
    incompleteSources: string[];
  };
  codexSummary: {
    jobStatus: string;
    activeStage: string;
    activeOperation: string | null;
    activeComponent: string | null;
    workerState:
      | "active"
      | "lease_expired"
      | "suspected_lost"
      | "not_observable";
    modelRequestState: string | null;
    outboxState: string | null;
    cancellationState: string | null;
    lastSuccessfulCheckpoint: string | null;
    safeResumeFrom: string | null;
    duplicateRisk: boolean;
    incompleteEvidence: string[];
    primaryFindingCode: string | null;
  };
  humanReadableReport: string;
};

