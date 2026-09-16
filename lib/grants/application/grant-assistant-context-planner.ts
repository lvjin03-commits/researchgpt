import { randomUUID } from "node:crypto";
import { GrantAssistantAnswerModeSchema, GrantAssistantContextPlanSchema,
  GrantAssistantDiagnosticAccessSchema, GrantAssistantDocumentAccessSchema,
  GrantAssistantWebRecommendationSchema, type GrantAssistantContextPlan } from "../assistant/context-plan-contracts.ts";
import { GrantDocumentMemorySnapshotSchema, type GrantDocumentMemorySnapshot } from "../assistant/document-memory-contracts.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import type { GrantAssistantContextPlannerModel } from "../ports/grant-assistant-context-planner-model.ts";
import type { GrantTokenCounter } from "../ports/grant-token-counter.ts";
import { admitGrantAssistantPlanningContext, type GrantAssistantContextBudgetManifest,
  type GrantAssistantContextBudgetPolicy } from "./grant-assistant-context-budget.ts";
import { buildGrantAssistantPlanningProjection } from "./grant-document-memory-projection.ts";
import { createGrantAssistantFailureReason, type GrantAssistantFailureReason,
  type GrantAssistantFailureReasonCode } from "../model-execution/assistant-failure-reasons.ts";

export class GrantAssistantContextPlannerError extends Error {
  readonly code: "stale_memory" | "planning_capacity_exceeded" | "invalid_model_output" |
    "invalid_target" | "inconsistent_model_identity";
  readonly failureStage = "semantic_planning" as const;
  readonly failureReason: GrantAssistantFailureReason;
  readonly providerRequestId?: string;
  readonly providerRequestIds: string[];
  readonly usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
  readonly requestDispatched: boolean;
  readonly usageKnown: boolean;

  constructor(code: GrantAssistantContextPlannerError["code"], reasonCode: GrantAssistantFailureReasonCode,
    message: string, metadata?: { providerRequestId?: string;
      usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
      safeFacts?: Parameters<typeof createGrantAssistantFailureReason>[0]["safeFacts"] }) {
    super(message);
    this.name = "GrantAssistantContextPlannerError";
    this.code = code;
    this.providerRequestId = metadata?.providerRequestId;
    this.providerRequestIds = metadata?.providerRequestId ? [metadata.providerRequestId] : [];
    this.usage = metadata?.usage;
    this.requestDispatched = Boolean(metadata?.providerRequestId);
    this.usageKnown = metadata?.usage !== undefined;
    this.failureReason = createGrantAssistantFailureReason({ reasonCode,
      stage: "semantic_planning", safeFacts: metadata?.safeFacts });
  }
}

export async function planGrantAssistantContext(input: {
  documentId: string;
  sourceRevisionId: string;
  question: string;
  recentConversation: Array<{ role: "user" | "assistant"; content: string }>;
  memory: GrantDocumentMemorySnapshot;
  model: GrantAssistantContextPlannerModel;
  tokenCounter: GrantTokenCounter;
  contextBudgetPolicy: GrantAssistantContextBudgetPolicy;
  plannerPolicyVersion: string;
  explicitContext?: {
    hasDocumentSelection?: boolean;
    hasCandidate?: boolean;
    hasEvidence?: boolean;
    webSearchEnabledByUser?: boolean;
  };
  createId?: () => string;
}): Promise<GrantAssistantContextPlan & { contextManifest: GrantAssistantContextBudgetManifest }> {
  const question = input.question.trim();
  if (!question) throw new GrantAssistantContextPlannerError("invalid_model_output", "planner.question_missing",
    "A planning question is required.");
  const parsedMemory = GrantDocumentMemorySnapshotSchema.safeParse(input.memory);
  if (!parsedMemory.success) throw new GrantAssistantContextPlannerError("invalid_model_output",
    "planner.memory_contract_invalid", "Assistant planning received invalid document memory.");
  const memory = parsedMemory.data;
  if (memory.documentId !== input.documentId || memory.sourceRevisionId !== input.sourceRevisionId) {
    throw new GrantAssistantContextPlannerError("stale_memory", "planner.stale_memory",
      "Assistant planning requires memory built from the current canonical Revision.");
  }
  const projection = buildGrantAssistantPlanningProjection(memory);
  const recentConversation = input.recentConversation.map((message) => ({
    role: message.role, content: message.content.trim() }));
  const explicitContext = {
    hasDocumentSelection: input.explicitContext?.hasDocumentSelection ?? false,
    hasCandidate: input.explicitContext?.hasCandidate ?? false,
    hasEvidence: input.explicitContext?.hasEvidence ?? false,
    webSearchEnabledByUser: input.explicitContext?.webSearchEnabledByUser ?? false,
  };
  const documentLanguage = /[\u3400-\u9fff]/u.test(question + memory.l0.overview) ? "zh" : "en";
  const planning = admitGrantAssistantPlanningContext({ documentLanguage, question, documentMemoryText: projection.modelText,
    allowedSectionAliases: [...projection.sectionIdByAlias.keys()],
    allowedMemoryItemAliases: [...projection.memoryItemIdByAlias.keys()], explicitContext, recentConversation,
    budgetPolicy: input.contextBudgetPolicy, tokenCounter: input.tokenCounter });
  const proposal = await input.model.plan(planning.request);
  const proposalMetadata = { providerRequestId: proposal.providerRequestId, usage: proposal.usage };
  const answerMode = GrantAssistantAnswerModeSchema.safeParse(proposal.answerMode);
  const documentAccess = GrantAssistantDocumentAccessSchema.safeParse(proposal.documentAccess);
  const diagnosticAccess = GrantAssistantDiagnosticAccessSchema.safeParse(proposal.diagnosticAccess);
  const webRecommendation = GrantAssistantWebRecommendationSchema.safeParse(proposal.webRecommendation);
  if (!answerMode.success || !documentAccess.success || !diagnosticAccess.success || !webRecommendation.success
    || !proposal.rationale?.trim() || typeof proposal.confidence !== "number" || !Number.isFinite(proposal.confidence)) {
    throw new GrantAssistantContextPlannerError("invalid_model_output", "planner.output_contract_invalid",
      "Semantic planner returned an invalid context decision.", proposalMetadata);
  }
  const sectionAliases = [...new Set(proposal.targetSectionAliases ?? [])];
  const memoryItemAliases = [...new Set(proposal.targetMemoryItemAliases ?? [])];
  if (sectionAliases.some((alias) => !projection.sectionIdByAlias.has(alias))
    || memoryItemAliases.some((alias) => !projection.memoryItemIdByAlias.has(alias))) {
    throw new GrantAssistantContextPlannerError("invalid_target", "planner.unavailable_target",
      "Semantic planner selected an unavailable memory target.", { ...proposalMetadata,
        safeFacts: { selectedTargetCount: sectionAliases.length + memoryItemAliases.length,
          availableTargetCount: projection.sectionIdByAlias.size + projection.memoryItemIdByAlias.size } });
  }
  if (documentAccess.data === "targeted_original" && sectionAliases.length === 0 && memoryItemAliases.length === 0) {
    throw new GrantAssistantContextPlannerError("invalid_target", "planner.targeted_original_missing_target",
      "Targeted original-text access requires at least one source target.", proposalMetadata);
  }
  if (diagnosticAccess.data === "relevant" && sectionAliases.length === 0 && memoryItemAliases.length === 0) {
    throw new GrantAssistantContextPlannerError("invalid_target", "planner.relevant_diagnostic_missing_target",
      "Relevant diagnostic access requires at least one memory or section target.", proposalMetadata);
  }
  if (proposal.needsClarification && !proposal.clarificationQuestion?.trim()) {
    throw new GrantAssistantContextPlannerError("invalid_model_output", "planner.clarification_question_missing",
      "A clarification decision requires a user-facing question.", { ...proposalMetadata,
        safeFacts: { hasClarificationQuestion: false } });
  }
  if (proposal.provider !== "openai" || !proposal.modelId?.trim()) {
    throw new GrantAssistantContextPlannerError("inconsistent_model_identity", "planner.model_identity_mismatch",
      "Semantic planner did not report the configured provider and model identity.", proposalMetadata);
  }
  const semanticDecision = { answerMode: answerMode.data, documentAccess: documentAccess.data,
    diagnosticAccess: diagnosticAccess.data, webRecommendation: webRecommendation.data,
    targetSectionIds: sectionAliases.map((alias) => projection.sectionIdByAlias.get(alias)!),
    targetMemoryItemIds: memoryItemAliases.map((alias) => projection.memoryItemIdByAlias.get(alias)!),
    needsClarification: proposal.needsClarification,
    ...(proposal.clarificationQuestion?.trim() ? { clarificationQuestion: proposal.clarificationQuestion.trim() } : {}),
    confidence: Math.max(0, Math.min(1, proposal.confidence)), rationale: proposal.rationale.trim() };
  const parsedPlan = GrantAssistantContextPlanSchema.safeParse({ schemaVersion: "grant-assistant-context-plan-v1",
    planId: (input.createId ?? randomUUID)(), planHash: sha256Canonical({ sourceRevisionId: input.sourceRevisionId,
      memoryHash: memory.memoryHash, plannerPolicyVersion: input.plannerPolicyVersion, question, semanticDecision }),
    documentId: input.documentId, sourceRevisionId: input.sourceRevisionId, memoryId: memory.memoryId,
    memoryHash: memory.memoryHash, plannerPolicyVersion: input.plannerPolicyVersion, ...semanticDecision,
    provider: "openai", modelId: proposal.modelId, ...(proposal.providerRequestId ? { providerRequestId: proposal.providerRequestId } : {}),
    usage: { inputTokens: proposal.usage?.inputTokens ?? 0, outputTokens: proposal.usage?.outputTokens ?? 0,
      reasoningTokens: proposal.usage?.reasoningTokens ?? 0 } });
  if (!parsedPlan.success) throw new GrantAssistantContextPlannerError("invalid_model_output",
    "planner.output_contract_invalid", "Semantic planner produced an invalid persisted plan.", proposalMetadata);
  const plan = parsedPlan.data;
  return { ...plan, contextManifest: planning.manifest };
}
