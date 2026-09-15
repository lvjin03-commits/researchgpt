import type { GrantModelCallAttempt } from "../model-execution/contracts.ts";

export interface GrantModelCallRepository {
  start(attempt: GrantModelCallAttempt): Promise<GrantModelCallAttempt>;
  finish(input: {
    callId: string;
    expectedStatus: "started";
    status: "succeeded" | "failed";
    outputHash?: string;
    providerRequestId?: string;
    providerRequestIds?: string[];
    failureCategory?: string;
    failureStage?: "memory_build" | "semantic_planning" | "context_admission" |
      "original_retrieval" | "answer_generation" | "persistence";
    requestDispatched: boolean;
    usageKnown: boolean;
    contextManifestHash?: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    completedAt: string;
  }): Promise<GrantModelCallAttempt>;
  listByTrace(documentId: string, traceId: string): Promise<GrantModelCallAttempt[]>;
}
