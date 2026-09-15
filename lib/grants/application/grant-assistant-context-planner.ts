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

export class GrantAssistantContextPlannerError extends Error {
  readonly code: "stale_memory" | "planning_capacity_exceeded" | "invalid_model_output" |
    "invalid_target" | "inconsistent_model_identity";
  constructor(code: GrantAssistantContextPlannerError["code"], message: string) {
    super(message);
    this.name = "GrantAssistantContextPlannerError";
    this.code = code;
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
  if (!question) throw new GrantAssistantContextPlannerError("invalid_model_output", "A planning question is required.");
  const memory = GrantDocumentMemorySnapshotSchema.parse(input.memory);
  if (memory.documentId !== input.documentId || memory.sourceRevisionId !== input.sourceRevisionId) {
    throw new GrantAssistantContextPlannerError("stale_memory",
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
  const answerMode = GrantAssistantAnswerModeSchema.safeParse(proposal.answerMode);
  const documentAccess = GrantAssistantDocumentAccessSchema.safeParse(proposal.documentAccess);
  const diagnosticAccess = GrantAssistantDiagnosticAccessSchema.safeParse(proposal.diagnosticAccess);
  const webRecommendation = GrantAssistantWebRecommendationSchema.safeParse(proposal.webRecommendation);
  if (!answerMode.success || !documentAccess.success || !diagnosticAccess.success || !webRecommendation.success
    || !proposal.rationale?.trim() || typeof proposal.confidence !== "number" || !Number.isFinite(proposal.confidence)) {
    throw new GrantAssistantContextPlannerError("invalid_model_output", "Semantic planner returned an invalid context decision.");
  }
  const sectionAliases = [...new Set(proposal.targetSectionAliases ?? [])];
  const memoryItemAliases = [...new Set(proposal.targetMemoryItemAliases ?? [])];
  if (sectionAliases.some((alias) => !projection.sectionIdByAlias.has(alias))
    || memoryItemAliases.some((alias) => !projection.memoryItemIdByAlias.has(alias))) {
    throw new GrantAssistantContextPlannerError("invalid_target", "Semantic planner selected an unavailable memory target.");
  }
  if (documentAccess.data === "targeted_original" && sectionAliases.length === 0 && memoryItemAliases.length === 0) {
    throw new GrantAssistantContextPlannerError("invalid_target",
      "Targeted original-text access requires at least one source target.");
  }
  if (diagnosticAccess.data === "relevant" && sectionAliases.length === 0 && memoryItemAliases.length === 0) {
    throw new GrantAssistantContextPlannerError("invalid_target",
      "Relevant diagnostic access requires at least one memory or section target.");
  }
  if (proposal.needsClarification && !proposal.clarificationQuestion?.trim()) {
    throw new GrantAssistantContextPlannerError("invalid_model_output",
      "A clarification decision requires a user-facing question.");
  }
  if (proposal.provider !== "openai" || !proposal.modelId?.trim()) {
    throw new GrantAssistantContextPlannerError("inconsistent_model_identity",
      "Semantic planner did not report the configured provider and model identity.");
  }
  const semanticDecision = { answerMode: answerMode.data, documentAccess: documentAccess.data,
    diagnosticAccess: diagnosticAccess.data, webRecommendation: webRecommendation.data,
    targetSectionIds: sectionAliases.map((alias) => projection.sectionIdByAlias.get(alias)!),
    targetMemoryItemIds: memoryItemAliases.map((alias) => projection.memoryItemIdByAlias.get(alias)!),
    needsClarification: proposal.needsClarification,
    ...(proposal.clarificationQuestion?.trim() ? { clarificationQuestion: proposal.clarificationQuestion.trim() } : {}),
    confidence: Math.max(0, Math.min(1, proposal.confidence)), rationale: proposal.rationale.trim() };
  const plan = GrantAssistantContextPlanSchema.parse({ schemaVersion: "grant-assistant-context-plan-v1",
    planId: (input.createId ?? randomUUID)(), planHash: sha256Canonical({ sourceRevisionId: input.sourceRevisionId,
      memoryHash: memory.memoryHash, plannerPolicyVersion: input.plannerPolicyVersion, question, semanticDecision }),
    documentId: input.documentId, sourceRevisionId: input.sourceRevisionId, memoryId: memory.memoryId,
    memoryHash: memory.memoryHash, plannerPolicyVersion: input.plannerPolicyVersion, ...semanticDecision,
    provider: "openai", modelId: proposal.modelId, ...(proposal.providerRequestId ? { providerRequestId: proposal.providerRequestId } : {}),
    usage: { inputTokens: proposal.usage?.inputTokens ?? 0, outputTokens: proposal.usage?.outputTokens ?? 0,
      reasoningTokens: proposal.usage?.reasoningTokens ?? 0 } });
  return { ...plan, contextManifest: planning.manifest };
}
