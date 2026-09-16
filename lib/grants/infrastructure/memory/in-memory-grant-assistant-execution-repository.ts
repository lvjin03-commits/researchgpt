import type { GrantAssistantExecutionRepository } from "../../ports/grant-assistant-execution-repository.ts";
import type { GrantAssistantExecution } from "../../assistant/execution-contracts.ts";

export class InMemoryGrantAssistantExecutionRepository implements GrantAssistantExecutionRepository {
  private readonly rows = new Map<string, GrantAssistantExecution>();
  async claim(input: Parameters<GrantAssistantExecutionRepository["claim"]>[0]) {
    const existing = this.rows.get(input.turnId);
    if (existing) {
      if (existing.inputHash !== input.inputHash || existing.sourceRevisionId !== input.sourceRevisionId ||
        existing.policyVersion !== input.policyVersion || existing.modelId !== input.modelId) {
        throw new Error("grant_assistant_execution_identity_mismatch");
      }
      if (existing.status === "completed" || (existing.status === "running" && existing.leaseExpiresAt &&
        existing.leaseExpiresAt >= input.now && existing.leaseToken !== input.leaseToken)) {
        return { execution: existing, claimed: false };
      }
      const claimed = { ...existing, status: "running" as const, version: existing.version + 1,
        leaseToken: input.leaseToken, leaseExpiresAt: input.leaseExpiresAt, failureReasonCode: null,
        updatedAt: input.now };
      this.rows.set(input.turnId, claimed);
      return { execution: claimed, claimed: true };
    }
    const execution: GrantAssistantExecution = { executionId: input.executionId, documentId: input.documentId,
      turnId: input.turnId, sourceRevisionId: input.sourceRevisionId, inputHash: input.inputHash,
      policyVersion: input.policyVersion, modelId: input.modelId, status: "running", version: 0,
      leaseToken: input.leaseToken, leaseExpiresAt: input.leaseExpiresAt,
      checkpoint: { schemaVersion: "grant-assistant-execution-checkpoint-v1" }, failureReasonCode: null,
      createdAt: input.now, updatedAt: input.now };
    this.rows.set(input.turnId, execution);
    return { execution, claimed: true };
  }
  async save(input: Parameters<GrantAssistantExecutionRepository["save"]>[0]) {
    const existing = [...this.rows.values()].find((row) => row.executionId === input.executionId);
    if (!existing || existing.version !== input.expectedVersion || existing.leaseToken !== input.leaseToken) {
      throw new Error("grant_assistant_execution_version_changed");
    }
    const updated: GrantAssistantExecution = { ...existing, status: input.status,
      version: existing.version + 1, checkpoint: input.checkpoint,
      failureReasonCode: input.failureReasonCode ?? null, updatedAt: input.now,
      leaseToken: input.status === "running" ? input.leaseToken : null,
      leaseExpiresAt: input.status === "running" ? input.leaseExpiresAt ?? existing.leaseExpiresAt : null };
    this.rows.set(existing.turnId, updated);
    return updated;
  }
}
