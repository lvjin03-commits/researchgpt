import type { GrantAssistantExecution, GrantAssistantExecutionCheckpoint } from "../assistant/execution-contracts.ts";

export type GrantAssistantExecutionClaim = {
  execution: GrantAssistantExecution;
  claimed: boolean;
};

export interface GrantAssistantExecutionRepository {
  claim(input: {
    executionId: string;
    documentId: string;
    turnId: string;
    sourceRevisionId: string;
    inputHash: string;
    policyVersion: string;
    modelId: string;
    leaseToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<GrantAssistantExecutionClaim>;
  save(input: {
    executionId: string;
    expectedVersion: number;
    leaseToken: string;
    status: "running" | "failed" | "completed";
    checkpoint: GrantAssistantExecutionCheckpoint;
    failureReasonCode?: string | null;
    now: string;
    leaseExpiresAt?: string | null;
  }): Promise<GrantAssistantExecution>;
}
