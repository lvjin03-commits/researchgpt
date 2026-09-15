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
import { GrantFullDocumentAnalysisError } from "./grant-full-document-hierarchical-analysis.ts";
import { admitGrantAssistantAnswerContext, GrantAssistantContextBudgetError,
  type GrantAssistantContextBudgetManifest, type GrantAssistantContextBudgetPolicy } from "./grant-assistant-context-budget.ts";

type PipelineModel = GrantDocumentMemoryModel & GrantAssistantContextPlannerModel & GrantAssistantModel &
  Partial<GrantFullDocumentAnalysisModel>;

export type GrantAssistantExecutionMode = "memory_discussion" | "targeted_original" |
  "hierarchical_full_review";

export class GrantAssistantMemoryPipelineError extends Error {
  readonly code: "inconsistent_model_identity";
  constructor(code: GrantAssistantMemoryPipelineError["code"], message: string) {
    super(message);
    this.name = "GrantAssistantMemoryPipelineError";
    this.code = code;
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
  const budgetError = input.error instanceof GrantAssistantContextBudgetError ? input.error : null;
  const fullDocumentError = input.error instanceof GrantFullDocumentAnalysisError ? input.error : null;
  const providerRequestIds = [...new Set([
    ...input.providerRequestIds,
    ...(modelError?.providerRequestIds ?? []),
  ])];
  const usage = { ...input.usage };
  addUsage(usage, modelError?.usage);
  throw new GrantAssistantModelError(
    budgetError?.code ?? modelError?.category ?? (fullDocumentError?.code === "unit_capacity_exceeded"
      || fullDocumentError?.code === "synthesis_capacity_exceeded" ? "answer_capacity_exceeded" : "internal_contract_error"),
    input.error instanceof Error ? input.error.message : "Grant Assistant pipeline failed.",
    {
      providerRequestIds,
      ...(providerRequestIds.at(-1) ? { providerRequestId: providerRequestIds.at(-1) } : {}),
      usage,
      failureStage: input.stage,
      requestDispatched: providerRequestIds.length > 0 || Boolean(modelError?.requestDispatched),
      usageKnown: modelError ? modelError.usageKnown : true,
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
  if (!question) throw new GrantAssistantModelError("provider_contract_error", "A user question is required.");
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
      throwPipelineFailure({ error: new Error("Hierarchical full-document review model is not configured."),
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
