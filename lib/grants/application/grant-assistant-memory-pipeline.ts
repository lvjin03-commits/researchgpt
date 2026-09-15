import { GrantAssistantModelError, type GrantAssistantAdmittedContext,
  type GrantAssistantChatMessage, type GrantAssistantModel } from "../ports/grant-assistant-model.ts";
import type { GrantAssistantContextPlannerModel } from "../ports/grant-assistant-context-planner-model.ts";
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

type PipelineModel = GrantDocumentMemoryModel & GrantAssistantContextPlannerModel & GrantAssistantModel;

export class GrantAssistantMemoryPipelineError extends Error {
  readonly code: "answer_capacity_exceeded" | "inconsistent_model_identity";
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
  provider: "openai";
  modelId: string;
  providerRequestIds: string[];
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
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
  memorySynthesisMaximumInputTokens: number;
  memoryUnitMaximumOutputTokens: number;
  memorySynthesisMaximumOutputTokens: number;
  plannerMaximumInputTokens: number;
  answerMaximumInputTokens: number;
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
  const memoryResult = await buildGrantDocumentMemory({ context: fullContext, route: memoryRoute,
    tokenCounter: input.tokenCounter, model: input.model, repository: input.memoryRepository,
    policyVersion: input.memoryPolicyVersion, synthesisMaximumInputTokens: input.memorySynthesisMaximumInputTokens,
    unitMaximumOutputTokens: input.memoryUnitMaximumOutputTokens,
    synthesisMaximumOutputTokens: input.memorySynthesisMaximumOutputTokens,
    attemptPurpose: input.attemptPurpose });
  const plan = await planGrantAssistantContext({ documentId: input.documentId,
    sourceRevisionId: input.sourceRevisionId, question, recentConversation: input.messages.slice(0, -1),
    memory: memoryResult.snapshot, model: input.model, tokenCounter: input.tokenCounter,
    maximumInputTokens: input.plannerMaximumInputTokens, plannerPolicyVersion: input.plannerPolicyVersion,
    explicitContext: input.explicitContext });
  const plannedContext = await assembleGrantAssistantPlannedContext({ documentId: input.documentId,
    sourceRevisionId: input.sourceRevisionId, snapshot: input.snapshot, memory: memoryResult.snapshot,
    plan, diagnostics: input.diagnostics });
  const identities = new Set([memoryResult.snapshot.modelId, plan.modelId]);
  if (identities.size !== 1 || !identities.has(input.expectedModelId)) {
    throw new GrantAssistantMemoryPipelineError("inconsistent_model_identity",
      "Memory and context planning must use the configured Grant Assistant model.");
  }
  const providerRequestIds = [
    ...(memoryResult.reused ? [] : memoryResult.snapshot.providerRequestIds),
    ...(plan.providerRequestId ? [plan.providerRequestId] : []),
  ];
  const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  if (!memoryResult.reused) addUsage(usage, memoryResult.snapshot.usage);
  addUsage(usage, plan.usage);
  const common = { memoryReused: memoryResult.reused, memoryId: memoryResult.snapshot.memoryId,
    memoryHash: memoryResult.snapshot.memoryHash, plan, plannedContext, provider: "openai" as const,
    modelId: input.expectedModelId, providerRequestIds, usage };
  if (plan.needsClarification) return { ...common, status: "needs_clarification",
    clarificationQuestion: plan.clarificationQuestion! };

  const admittedContext: GrantAssistantAdmittedContext[] = plannedContext.sources.map((source) => ({
    sourceAlias: source.sourceAlias, sourceType: source.sourceType, label: source.label, excerpt: source.excerpt }));
  const answerPayload = { messages: input.messages, admittedContext, contextPlan: {
    answerMode: plan.answerMode, documentAccess: plan.documentAccess,
    diagnosticAccess: plan.diagnosticAccess, rationale: plan.rationale } };
  if (input.tokenCounter.count(JSON.stringify(answerPayload)) > input.answerMaximumInputTokens) {
    throw new GrantAssistantMemoryPipelineError("answer_capacity_exceeded",
      "The complete planned context exceeds the configured answer input capacity; no source was truncated.");
  }
  const generated = await input.model.answerChat({ documentLanguage: /[\u3400-\u9fff]/u.test(question) ? "zh" : "en",
    ...answerPayload, attemptPurpose: input.attemptPurpose });
  if (generated.provider !== "openai" || generated.modelId !== input.expectedModelId) {
    throw new GrantAssistantMemoryPipelineError("inconsistent_model_identity",
      "The answer did not use the configured Grant Assistant model.");
  }
  if (generated.providerRequestId) providerRequestIds.push(generated.providerRequestId);
  addUsage(usage, generated.usage);
  const answer = validateGrantAssistantGroundedAnswer({ content: generated.content,
    admittedContext, claims: generated.claims, citations: generated.citations });
  return { ...common, status: "answered", providerRequestIds, usage, answer, admittedContext,
    outputHash: sha256Canonical(answer) };
}
