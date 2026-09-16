import { GrantAssistantModelError, type GrantAssistantAdmittedContext,
  type GrantAssistantChatMessage, type GrantAssistantModel } from "../ports/grant-assistant-model.ts";
import type { GrantAssistantContextPlannerModel } from "../ports/grant-assistant-context-planner-model.ts";
import type { GrantFullDocumentAnalysisModel } from "../ports/grant-full-document-analysis-model.ts";
import type { GrantDiagnosticRepository } from "../ports/grant-diagnostic-repository.ts";
import type { GrantDocumentMemoryModel } from "../ports/grant-document-memory-model.ts";
import type { GrantDocumentMemoryRepository } from "../ports/grant-document-memory-repository.ts";
import type { GrantTokenCounter } from "../ports/grant-token-counter.ts";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import { validateGrantAssistantGroundedAnswer } from "../assistant/grounded-answer-validator.ts";
import type { GrantAssistantAnswer } from "../assistant/answer-contract.ts";
import { buildGrantDocumentMemory } from "./grant-document-memory-builder.ts";
import { planGrantAssistantContext } from "./grant-assistant-context-planner.ts";
import { assembleGrantAssistantPlannedContext } from "./grant-assistant-planned-context.ts";
import { buildGrantFullDocumentContext } from "./grant-full-document-context.ts";
import { routeGrantFullDocumentContext, type GrantFullDocumentCapacityPolicy } from "./grant-full-document-capacity-router.ts";
import { executeGrantAssistantHierarchicalReview } from "./grant-assistant-hierarchical-review.ts";
import { admitGrantAssistantAnswerContext, GrantAssistantContextBudgetError,
  type GrantAssistantContextBudgetManifest, type GrantAssistantContextBudgetPolicy } from "./grant-assistant-context-budget.ts";
import { createGrantAssistantFailureReason, createGrantAssistantProviderFailureReason,
  GrantAssistantFailureReasonSchema,
  type GrantAssistantFailureReason, type GrantAssistantFailureReasonCode,
  type GrantAssistantFailureStage } from "../model-execution/assistant-failure-reasons.ts";

type PipelineModel = GrantDocumentMemoryModel & GrantAssistantContextPlannerModel & GrantAssistantModel &
  Partial<GrantFullDocumentAnalysisModel>;

export type GrantAssistantExecutionMode = "memory_discussion" | "targeted_original" |
  "hierarchical_full_review";

export class GrantAssistantMemoryPipelineError extends Error {
  readonly code: "inconsistent_model_identity";
  readonly failureReason: GrantAssistantFailureReason;
  readonly failureStage: GrantAssistantFailureStage;
  readonly requestDispatched = false;
  readonly usageKnown = true;
  constructor(code: GrantAssistantMemoryPipelineError["code"], reasonCode: GrantAssistantFailureReasonCode,
    stage: GrantAssistantFailureStage, message: string) {
    super(message);
    this.name = "GrantAssistantMemoryPipelineError";
    this.code = code;
    this.failureStage = stage;
    this.failureReason = createGrantAssistantFailureReason({ reasonCode, stage,
      safeFacts: { requestDispatched: false, usageKnown: true } });
  }
}
type PipelineCommon = {
  memoryReused: boolean;
  memoryId: string;
  memoryHash: string;
  plan: Awaited<ReturnType<typeof planGrantAssistantContext>>;
  plannedContext: Awaited<ReturnType<typeof assembleGrantAssistantPlannedContext>>;
  executionMode: GrantAssistantExecutionMode;
  provider: "openai";
  modelId: string;
  providerRequestIds: string[];
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  contextManifests: GrantAssistantContextBudgetManifest[];
};

export type GrantAssistantMemoryPipelineResult =
  | (PipelineCommon & { status: "needs_clarification"; clarificationQuestion: string })
  | (PipelineCommon & { status: "answered"; answer: GrantAssistantAnswer;
      admittedContext: GrantAssistantAdmittedContext[]; outputHash: string });

function addUsage(target: PipelineCommon["usage"], usage?: {
  inputTokens?: number; outputTokens?: number; reasoningTokens?: number }) {
  target.inputTokens += usage?.inputTokens ?? 0;
  target.outputTokens += usage?.outputTokens ?? 0;
  target.reasoningTokens += usage?.reasoningTokens ?? 0;
}

function throwPipelineFailure(input: {
  error: unknown;
  stage: NonNullable<GrantAssistantModelError["failureStage"]>;
  providerRequestIds: string[];
  usage: PipelineCommon["usage"];
}): never {
  const modelError = input.error instanceof GrantAssistantModelError ? input.error : null;
  const candidate = input.error && typeof input.error === "object" ? input.error as {
    providerRequestId?: unknown; providerRequestIds?: unknown; usage?: {
      inputTokens?: unknown; outputTokens?: unknown; reasoningTokens?: unknown };
    requestDispatched?: unknown; usageKnown?: unknown; failureReason?: unknown } : null;
  const attributed = GrantAssistantFailureReasonSchema.safeParse(candidate?.failureReason);
  const candidateRequestIds = Array.isArray(candidate?.providerRequestIds)
    ? candidate.providerRequestIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  if (typeof candidate?.providerRequestId === "string" && candidate.providerRequestId.trim()) {
    candidateRequestIds.push(candidate.providerRequestId);
  }
  const providerRequestIds = [...new Set([
    ...input.providerRequestIds,
    ...candidateRequestIds,
  ])];
  const usage = { ...input.usage };
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  addUsage(usage, candidate?.usage ? {
    inputTokens: count(candidate.usage.inputTokens),
    outputTokens: count(candidate.usage.outputTokens),
    reasoningTokens: count(candidate.usage.reasoningTokens),
  } : undefined);
  const safeFacts = {
    requestDispatched: providerRequestIds.length > 0 || candidate?.requestDispatched === true,
    usageKnown: candidate?.usageKnown === true || candidate?.usage !== undefined,
  };
  const structuredOutputReasonCode = input.stage === "memory_build"
    ? "memory.unit_output_invalid" as const
    : input.stage === "semantic_planning"
      ? "planner.output_contract_invalid" as const
      : input.stage === "answer_generation"
        ? "answer.output_contract_invalid" as const
        : null;
  const fallbackReason = modelError && ["output_truncated", "content_filtered", "provider_refusal",
    "provider_rate_limited", "provider_transient_error", "provider_contract_error", "provider_unavailable"]
    .includes(modelError.category)
    ? createGrantAssistantProviderFailureReason({ category: modelError.category as
        "output_truncated" | "content_filtered" | "provider_refusal" | "provider_rate_limited" |
        "provider_transient_error" | "provider_contract_error" | "provider_unavailable",
      stage: input.stage, safeFacts })
    : modelError?.category === "structured_output_invalid" && structuredOutputReasonCode
      ? createGrantAssistantFailureReason({ reasonCode: structuredOutputReasonCode,
        stage: input.stage, safeFacts })
      : modelError?.category === "planning_capacity_exceeded"
        ? createGrantAssistantFailureReason({ reasonCode: "budget.planning_required_context_exceeded",
          stage: "context_admission", safeFacts })
        : modelError?.category === "answer_capacity_exceeded"
          ? createGrantAssistantFailureReason({ reasonCode: "budget.answer_required_context_exceeded",
            stage: "context_admission", safeFacts })
          : createGrantAssistantFailureReason({ reasonCode: "executor.unclassified_failure",
            stage: input.stage, safeFacts });
  const failureReason = attributed.success ? attributed.data : fallbackReason;
  throw new GrantAssistantModelError(
    failureReason.category,
    input.error instanceof Error ? input.error.message : "Grant Assistant pipeline failed.",
    {
      providerRequestIds,
      ...(providerRequestIds.at(-1) ? { providerRequestId: providerRequestIds.at(-1) } : {}),
      usage,
      failureStage: failureReason.stage,
      failureReason,
      requestDispatched: providerRequestIds.length > 0 || candidate?.requestDispatched === true,
      usageKnown: candidate?.usageKnown === true || candidate?.usage !== undefined,
    },
  );
}

export async function executeGrantAssistantMemoryPipeline(input: {
  documentId: string;
  sourceRevisionId: string;
  snapshot: CanonicalGrantSnapshot;
  messages: GrantAssistantChatMessage[];
  model: PipelineModel;
  memoryRepository: GrantDocumentMemoryRepository;
  diagnostics: Pick<GrantDiagnosticRepository, "listNormalizedFindings">;
  tokenCounter: GrantTokenCounter;
  expectedModelId: string;
  memoryPolicyVersion: string;
  plannerPolicyVersion: string;
  memoryCapacityPolicy: GrantFullDocumentCapacityPolicy;
  memoryMaximumConcurrentUnitAnalyses: number;
  memoryUnitMaximumOutputTokens: number;
  contextBudgetPolicy: GrantAssistantContextBudgetPolicy;
  attemptPurpose: "initial" | "schema_repair" | "capacity_retry" | "transient_retry";
  explicitContext?: {
    hasDocumentSelection?: boolean;
    hasCandidate?: boolean;
    hasEvidence?: boolean;
    webSearchEnabledByUser?: boolean;
  };
}): Promise<GrantAssistantMemoryPipelineResult> {
  const question = [...input.messages].reverse().find((message) => message.role === "user")?.content.trim();
  if (!question) throw new GrantAssistantModelError("provider_contract_error", "A user question is required.", {
    failureStage: "semantic_planning", requestDispatched: false, usageKnown: true,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    failureReason: createGrantAssistantFailureReason({ reasonCode: "planner.question_missing",
      stage: "semantic_planning", safeFacts: { requestDispatched: false, usageKnown: true } }),
  });
  const fullContext = buildGrantFullDocumentContext({ documentId: input.documentId,
    sourceRevisionId: input.sourceRevisionId, snapshot: input.snapshot });
  const memoryRoute = routeGrantFullDocumentContext({ context: fullContext, tokenCounter: input.tokenCounter,
    fixedPromptText: "Build reusable Revision-bound grant document memory.", policy: input.memoryCapacityPolicy });
  const providerRequestIds: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  let memoryResult: Awaited<ReturnType<typeof buildGrantDocumentMemory>>;
  try {
    memoryResult = await buildGrantDocumentMemory({ context: fullContext, route: memoryRoute,
      tokenCounter: input.tokenCounter, model: input.model, repository: input.memoryRepository,
      policyVersion: input.memoryPolicyVersion,
      maximumConcurrentUnitAnalyses: input.memoryMaximumConcurrentUnitAnalyses,
      unitMaximumOutputTokens: input.memoryUnitMaximumOutputTokens,
      attemptPurpose: input.attemptPurpose });
  } catch (error) {
    throwPipelineFailure({ error, stage: "memory_build", providerRequestIds, usage });
  }
  if (!memoryResult.reused) {
    providerRequestIds.push(...memoryResult.snapshot.providerRequestIds);
    addUsage(usage, memoryResult.snapshot.usage);
  }
  let plan: Awaited<ReturnType<typeof planGrantAssistantContext>>;
  try {
    plan = await planGrantAssistantContext({ documentId: input.documentId,
      sourceRevisionId: input.sourceRevisionId, question, recentConversation: input.messages.slice(0, -1),
      memory: memoryResult.snapshot, model: input.model, tokenCounter: input.tokenCounter,
      contextBudgetPolicy: input.contextBudgetPolicy, plannerPolicyVersion: input.plannerPolicyVersion,
      explicitContext: input.explicitContext });
  } catch (error) {
    throwPipelineFailure({ error, stage: error instanceof GrantAssistantContextBudgetError
      ? "context_admission" : "semantic_planning", providerRequestIds, usage });
  }
  if (plan.providerRequestId) providerRequestIds.push(plan.providerRequestId);
  addUsage(usage, plan.usage);
  let plannedContext: Awaited<ReturnType<typeof assembleGrantAssistantPlannedContext>>;
  try {
    plannedContext = await assembleGrantAssistantPlannedContext({ documentId: input.documentId,
      sourceRevisionId: input.sourceRevisionId, snapshot: input.snapshot, memory: memoryResult.snapshot,
      plan, diagnostics: input.diagnostics });
  } catch (error) {
    throwPipelineFailure({ error, stage: "original_retrieval", providerRequestIds, usage });
  }
  const identities = new Set([memoryResult.snapshot.modelId, plan.modelId]);
  if (identities.size !== 1 || !identities.has(input.expectedModelId)) {
    throwPipelineFailure({ error: new GrantAssistantMemoryPipelineError("inconsistent_model_identity",
      "planner.model_identity_mismatch", "semantic_planning",
      "Memory and context planning must use the configured Grant Assistant model."),
      stage: "semantic_planning", providerRequestIds, usage });
  }
  const common = { memoryReused: memoryResult.reused, memoryId: memoryResult.snapshot.memoryId,
    memoryHash: memoryResult.snapshot.memoryHash, plan, plannedContext, provider: "openai" as const,
    executionMode: plan.documentAccess === "full_original" ? "hierarchical_full_review" as const
      : plan.documentAccess === "targeted_original" ? "targeted_original" as const : "memory_discussion" as const,
    modelId: input.expectedModelId, providerRequestIds, usage,
    contextManifests: [plan.contextManifest] };
  if (plan.needsClarification) return { ...common, status: "needs_clarification",
    clarificationQuestion: plan.clarificationQuestion! };

  if (common.executionMode === "hierarchical_full_review") {
    if (!input.model.analyzeUnit || !input.model.synthesize) {
      throwPipelineFailure({ error: {
        ...new Error("Hierarchical full-document review model is not configured."),
        message: "Hierarchical full-document review model is not configured.",
        failureReason: createGrantAssistantFailureReason({ reasonCode: "review.model_unavailable",
          stage: "answer_generation", safeFacts: { requestDispatched: false, usageKnown: true } }),
        requestDispatched: false, usageKnown: true,
      },
        stage: "answer_generation", providerRequestIds, usage });
    }
    let reviewed: Awaited<ReturnType<typeof executeGrantAssistantHierarchicalReview>>;
    try {
      reviewed = await executeGrantAssistantHierarchicalReview({ context: fullContext,
        plannedContext, question, model: input.model as GrantFullDocumentAnalysisModel,
        tokenCounter: input.tokenCounter, contextBudgetPolicy: input.contextBudgetPolicy });
    } catch (error) {
      throwPipelineFailure({ error, stage: error instanceof GrantAssistantContextBudgetError
        ? "context_admission" : "answer_generation", providerRequestIds, usage });
    }
    providerRequestIds.push(...reviewed.execution.providerRequestIds);
    addUsage(usage, reviewed.execution.usage);
    common.contextManifests.push(...reviewed.contextManifests);
    if (reviewed.execution.provider !== "openai" || reviewed.execution.modelId !== input.expectedModelId) {
      throwPipelineFailure({ error: new GrantAssistantMemoryPipelineError("inconsistent_model_identity",
        "review.model_identity_mismatch", "answer_generation",
        "The full-document review did not use the configured Grant Assistant model."),
        stage: "answer_generation", providerRequestIds, usage });
    }
    return { ...common, status: "answered", providerRequestIds, usage,
      answer: reviewed.answer, admittedContext: reviewed.admittedContext,
      outputHash: sha256Canonical(reviewed.answer) };
  }

  const admittedContext: GrantAssistantAdmittedContext[] = plannedContext.sources.map((source) => ({
    sourceAlias: source.sourceAlias, sourceType: source.sourceType, label: source.label, excerpt: source.excerpt }));
  const contextPlan = {
    answerMode: plan.answerMode, documentAccess: plan.documentAccess,
    diagnosticAccess: plan.diagnosticAccess, rationale: plan.rationale };
  let answerAdmission: ReturnType<typeof admitGrantAssistantAnswerContext>;
  try {
    answerAdmission = admitGrantAssistantAnswerContext({
      documentLanguage: /[\u3400-\u9fff]/u.test(question) ? "zh" : "en",
      messages: input.messages, admittedContext, contextPlan, attemptPurpose: input.attemptPurpose,
      budgetPolicy: input.contextBudgetPolicy, tokenCounter: input.tokenCounter,
    });
  } catch (error) {
    throwPipelineFailure({ error, stage: "context_admission", providerRequestIds, usage });
  }
  common.contextManifests.push(answerAdmission.manifest);
  let generated: Awaited<ReturnType<GrantAssistantModel["answerChat"]>>;
  try {
    generated = await input.model.answerChat(answerAdmission.request);
  } catch (error) {
    throwPipelineFailure({ error, stage: "answer_generation", providerRequestIds, usage });
  }
  if (generated.providerRequestId) providerRequestIds.push(generated.providerRequestId);
  addUsage(usage, generated.usage);
  if (generated.provider !== "openai" || generated.modelId !== input.expectedModelId) {
    throwPipelineFailure({ error: new GrantAssistantMemoryPipelineError("inconsistent_model_identity",
      "answer.model_identity_mismatch", "answer_generation",
      "The answer did not use the configured Grant Assistant model."),
      stage: "answer_generation", providerRequestIds, usage });
  }
  let answer: GrantAssistantAnswer;
  try {
    answer = validateGrantAssistantGroundedAnswer({ content: generated.content,
      admittedContext, claims: generated.claims, citations: generated.citations });
  } catch (error) {
    throwPipelineFailure({ error, stage: "answer_generation", providerRequestIds, usage });
  }
  return { ...common, status: "answered", providerRequestIds, usage, answer, admittedContext,
    outputHash: sha256Canonical(answer) };
}
