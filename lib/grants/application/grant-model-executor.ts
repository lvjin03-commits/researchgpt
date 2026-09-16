import { randomUUID } from "node:crypto";
import { GrantModelCallAttemptSchema } from "../model-execution/contracts.ts";
import { GrantAssistantFailureReasonSchema,
  createGrantAssistantFailureReason,
  type GrantAssistantFailureReason } from "../model-execution/assistant-failure-reasons.ts";
import { grantModelRetryPurpose, type GrantModelFailureCategory, type GrantModelOperationPolicy } from "../model-execution/operation-registry.ts";
import type { GrantModelCallRepository } from "../ports/grant-model-call-repository.ts";

export class GrantModelExecutionError extends Error {
  readonly category: GrantModelFailureCategory;
  readonly traceId: string;
  readonly failureStage?: "memory_build" | "semantic_planning" | "context_admission" |
    "original_retrieval" | "answer_generation" | "persistence";
  readonly requestDispatched: boolean;
  readonly usageKnown: boolean;
  readonly failureReason?: GrantAssistantFailureReason;

  constructor(category: GrantModelFailureCategory, traceId: string, message: string,
    failureStage?: GrantModelExecutionError["failureStage"], metadata?: {
      requestDispatched?: boolean; usageKnown?: boolean;
      failureReason?: GrantAssistantFailureReason;
    }) {
    super(message);
    this.name = "GrantModelExecutionError";
    this.category = category;
    this.traceId = traceId;
    this.failureStage = failureStage;
    this.requestDispatched = metadata?.requestDispatched ?? false;
    this.usageKnown = metadata?.usageKnown ?? false;
    this.failureReason = metadata?.failureReason;
  }
}

export type GrantModelAttemptResult<T> = {
  value: T;
  outputHash: string;
  providerRequestId?: string;
  providerRequestIds?: string[];
  contextManifestHash?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
};

export type GrantModelUsageObserver = (event: {
  usageEventId: string;
  billingOperationId: string;
  operation: GrantModelOperationPolicy["operation"];
  provider: GrantModelOperationPolicy["provider"];
  modelId: string;
  attemptNumber: number;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  occurredAt: string;
}) => Promise<void>;

function failureAttemptMetadata(error: unknown) {
  if (!error || typeof error !== "object") return {
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
    requestDispatched: false, usageKnown: false,
  };
  const candidate = error as { providerRequestId?: unknown; providerRequestIds?: unknown;
    failureStage?: unknown; failureReason?: unknown; requestDispatched?: unknown; usageKnown?: unknown; usage?: {
      inputTokens?: unknown; outputTokens?: unknown; reasoningTokens?: unknown } };
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  const providerRequestIds = Array.isArray(candidate.providerRequestIds)
    ? candidate.providerRequestIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const validStages = new Set(["memory_build", "semantic_planning", "context_admission",
    "original_retrieval", "answer_generation", "persistence"]);
  const failureReason = GrantAssistantFailureReasonSchema.safeParse(candidate.failureReason);
  return {
    ...(typeof candidate.providerRequestId === "string" && candidate.providerRequestId.trim()
      ? { providerRequestId: candidate.providerRequestId }
      : {}),
    ...(providerRequestIds.length > 0 ? { providerRequestIds } : {}),
    ...(typeof candidate.failureStage === "string" && validStages.has(candidate.failureStage)
      ? { failureStage: candidate.failureStage as NonNullable<GrantModelExecutionError["failureStage"]> }
      : {}),
    ...(failureReason.success ? { failureReason: failureReason.data } : {}),
    requestDispatched: candidate.requestDispatched === true || providerRequestIds.length > 0
      || (typeof candidate.providerRequestId === "string" && Boolean(candidate.providerRequestId.trim())),
    usageKnown: candidate.usageKnown === true || candidate.usage !== undefined,
    inputTokens: count(candidate.usage?.inputTokens),
    outputTokens: count(candidate.usage?.outputTokens),
    reasoningTokens: count(candidate.usage?.reasoningTokens),
  };
}

export class GrantModelExecutor {
  private readonly repository: GrantModelCallRepository;
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly onUsage?: GrantModelUsageObserver;

  constructor(
    repository: GrantModelCallRepository,
    createId: () => string = randomUUID,
    now: () => string = () => new Date().toISOString(),
    onUsage?: GrantModelUsageObserver,
  ) {
    this.repository = repository;
    this.createId = createId;
    this.now = now;
    this.onUsage = onUsage;
  }

  async execute<T>(input: {
    documentId: string;
    sessionId?: string;
    turnId?: string;
    billingOperationId?: string;
    traceId?: string;
    inputHash: string;
    policy: GrantModelOperationPolicy;
    invoke: (attempt: { attemptNumber: number; attemptPurpose: "initial" | "schema_repair" | "capacity_retry" | "transient_retry"; policy: GrantModelOperationPolicy }) => Promise<GrantModelAttemptResult<T>>;
    classifyFailure: (error: unknown) => GrantModelFailureCategory;
  }): Promise<{ value: T; traceId: string; attempts: number; usage: {
    inputTokens: number; outputTokens: number; reasoningTokens: number;
  } }> {
    const traceId = input.traceId ?? this.createId();
    let purpose: "initial" | "schema_repair" | "capacity_retry" | "transient_retry" = "initial";
    let lastError: unknown;
    let lastCategory: GrantModelFailureCategory = "unknown_provider_failure";

    for (let attemptNumber = 1; attemptNumber <= input.policy.maximumAttempts; attemptNumber += 1) {
      const callId = this.createId();
      try {
        await this.repository.start(GrantModelCallAttemptSchema.parse({
          callId, traceId, documentId: input.documentId, sessionId: input.sessionId,
          turnId: input.turnId, operation: input.policy.operation,
          policyVersion: input.policy.policyVersion, provider: input.policy.provider,
          modelId: input.policy.modelId, attemptNumber, attemptPurpose: purpose,
          status: "started", inputHash: input.inputHash, startedAt: this.now(),
        }));
      } catch (error) {
        throw new GrantModelExecutionError("internal_contract_error", traceId,
          error instanceof Error ? error.message : "Grant model attempt could not be started.",
          "persistence", { requestDispatched: false, usageKnown: true,
            failureReason: createGrantAssistantFailureReason({
              reasonCode: "persistence.attempt_start_failed", stage: "persistence",
              safeFacts: { attemptNumber, requestDispatched: false, usageKnown: true },
            }) });
      }
      let result: GrantModelAttemptResult<T>;
      try {
        result = await input.invoke({ attemptNumber, attemptPurpose: purpose, policy: input.policy });
      } catch (error) {
        lastError = error;
        lastCategory = input.classifyFailure(error);
        const failureMetadata = failureAttemptMetadata(error);
        try {
          await this.repository.finish({
            callId, expectedStatus: "started", status: "failed", failureCategory: lastCategory,
            ...failureMetadata, completedAt: this.now(),
          });
        } catch (persistenceError) {
          throw new GrantModelExecutionError("internal_contract_error", traceId,
            persistenceError instanceof Error ? persistenceError.message : "Grant model failure could not be persisted.",
            "persistence", { requestDispatched: failureMetadata.requestDispatched,
              usageKnown: failureMetadata.usageKnown,
              failureReason: createGrantAssistantFailureReason({
                reasonCode: "persistence.attempt_finish_failed", stage: "persistence",
                safeFacts: { attemptNumber, requestDispatched: failureMetadata.requestDispatched,
                  usageKnown: failureMetadata.usageKnown },
              }) });
        }
        if (attemptNumber >= input.policy.maximumAttempts || !input.policy.retryableCategories.has(lastCategory)) break;
        purpose = grantModelRetryPurpose(lastCategory);
        continue;
      }
      const completedAt = this.now();
      try {
        await this.repository.finish({
          callId, expectedStatus: "started", status: "succeeded", outputHash: result.outputHash,
          providerRequestId: result.providerRequestId,
          providerRequestIds: result.providerRequestIds,
          requestDispatched: true,
          usageKnown: result.usage !== undefined,
          contextManifestHash: result.contextManifestHash,
          inputTokens: result.usage?.inputTokens ?? 0, outputTokens: result.usage?.outputTokens ?? 0,
          reasoningTokens: result.usage?.reasoningTokens ?? 0, completedAt,
        });
      } catch (error) {
        throw new GrantModelExecutionError("internal_contract_error", traceId,
          error instanceof Error ? error.message : "Grant model success could not be persisted.",
          "persistence", { requestDispatched: true, usageKnown: result.usage !== undefined,
            failureReason: createGrantAssistantFailureReason({
              reasonCode: "persistence.attempt_finish_failed", stage: "persistence",
              safeFacts: { attemptNumber, requestDispatched: true,
                usageKnown: result.usage !== undefined },
            }) });
      }
      if (result.usage) await this.onUsage?.({
        usageEventId: callId,
        billingOperationId: input.billingOperationId ?? input.turnId ?? callId,
        operation: input.policy.operation,
        provider: input.policy.provider,
        modelId: input.policy.modelId,
        attemptNumber,
        usage: {
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          reasoningTokens: result.usage?.reasoningTokens ?? 0,
        },
        occurredAt: completedAt,
      });
      return { value: result.value, traceId, attempts: attemptNumber, usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        reasoningTokens: result.usage?.reasoningTokens ?? 0,
      } };
    }
    const failure = failureAttemptMetadata(lastError);
    throw new GrantModelExecutionError(lastCategory, traceId,
      lastError instanceof Error ? lastError.message : "Grant model execution failed.",
      failure.failureStage, { requestDispatched: failure.requestDispatched, usageKnown: failure.usageKnown,
        failureReason: failure.failureReason });
  }
}
