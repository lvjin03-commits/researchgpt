import { randomUUID } from "node:crypto";
import { GrantModelCallAttemptSchema } from "../model-execution/contracts.ts";
import { grantModelRetryPurpose, type GrantModelFailureCategory, type GrantModelOperationPolicy } from "../model-execution/operation-registry.ts";
import type { GrantModelCallRepository } from "../ports/grant-model-call-repository.ts";

export class GrantModelExecutionError extends Error {
  readonly category: GrantModelFailureCategory;
  readonly traceId: string;

  constructor(category: GrantModelFailureCategory, traceId: string, message: string) {
    super(message);
    this.name = "GrantModelExecutionError";
    this.category = category;
    this.traceId = traceId;
  }
}

export type GrantModelAttemptResult<T> = {
  value: T;
  outputHash: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
};

export class GrantModelExecutor {
  private readonly repository: GrantModelCallRepository;
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    repository: GrantModelCallRepository,
    createId: () => string = randomUUID,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.repository = repository;
    this.createId = createId;
    this.now = now;
  }

  async execute<T>(input: {
    documentId: string;
    sessionId?: string;
    turnId?: string;
    traceId?: string;
    inputHash: string;
    policy: GrantModelOperationPolicy;
    invoke: (attempt: { attemptNumber: number; attemptPurpose: "initial" | "schema_repair" | "capacity_retry" | "transient_retry"; policy: GrantModelOperationPolicy }) => Promise<GrantModelAttemptResult<T>>;
    classifyFailure: (error: unknown) => GrantModelFailureCategory;
  }): Promise<{ value: T; traceId: string; attempts: number }> {
    const traceId = input.traceId ?? this.createId();
    let purpose: "initial" | "schema_repair" | "capacity_retry" | "transient_retry" = "initial";
    let lastError: unknown;
    let lastCategory: GrantModelFailureCategory = "unknown_provider_failure";

    for (let attemptNumber = 1; attemptNumber <= input.policy.maximumAttempts; attemptNumber += 1) {
      const callId = this.createId();
      await this.repository.start(GrantModelCallAttemptSchema.parse({
        callId, traceId, documentId: input.documentId, sessionId: input.sessionId,
        turnId: input.turnId, operation: input.policy.operation,
        policyVersion: input.policy.policyVersion, provider: input.policy.provider,
        modelId: input.policy.modelId, attemptNumber, attemptPurpose: purpose,
        status: "started", inputHash: input.inputHash, startedAt: this.now(),
      }));
      let result: GrantModelAttemptResult<T>;
      try {
        result = await input.invoke({ attemptNumber, attemptPurpose: purpose, policy: input.policy });
      } catch (error) {
        lastError = error;
        lastCategory = input.classifyFailure(error);
        await this.repository.finish({
          callId, expectedStatus: "started", status: "failed", failureCategory: lastCategory,
          inputTokens: 0, outputTokens: 0, reasoningTokens: 0, completedAt: this.now(),
        });
        if (attemptNumber >= input.policy.maximumAttempts || !input.policy.retryableCategories.has(lastCategory)) break;
        purpose = grantModelRetryPurpose(lastCategory);
        continue;
      }
      await this.repository.finish({
        callId, expectedStatus: "started", status: "succeeded", outputHash: result.outputHash,
        providerRequestId: result.providerRequestId,
        inputTokens: result.usage?.inputTokens ?? 0, outputTokens: result.usage?.outputTokens ?? 0,
        reasoningTokens: result.usage?.reasoningTokens ?? 0, completedAt: this.now(),
      });
      return { value: result.value, traceId, attempts: attemptNumber };
    }
    throw new GrantModelExecutionError(lastCategory, traceId, lastError instanceof Error ? lastError.message : "Grant model execution failed.");
  }
}
