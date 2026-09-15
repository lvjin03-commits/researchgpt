import { randomUUID } from "node:crypto";
import { GrantAssistantAnswerModeSchema, GrantAssistantContextPlanSchema,
  GrantAssistantDiagnosticAccessSchema, GrantAssistantDocumentAccessSchema,
  GrantAssistantWebRecommendationSchema, type GrantAssistantContextPlan } from "../assistant/context-plan-contracts.ts";
import { GrantDocumentMemorySnapshotSchema, type GrantDocumentMemorySnapshot } from "../assistant/document-memory-contracts.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import type { GrantAssistantContextPlannerModel } from "../ports/grant-assistant-context-planner-model.ts";
import type { GrantTokenCounter } from "../ports/grant-token-counter.ts";

export class GrantAssistantContextPlannerError extends Error {
  readonly code: "stale_memory" | "planning_capacity_exceeded" | "invalid_model_output" |
    "invalid_target" | "inconsistent_model_identity";
  constructor(code: GrantAssistantContextPlannerError["code"], message: string) {
    super(message);
    this.name = "GrantAssistantContextPlannerError";
    this.code = code;
  }
}

export type GrantAssistantPlanningProjection = {
  modelText: string;
  sectionIdByAlias: Map<string, string>;
  memoryItemIdByAlias: Map<string, string>;
};

export function buildGrantAssistantPlanningProjection(memoryInput: GrantDocumentMemorySnapshot): GrantAssistantPlanningProjection {
  const memory = GrantDocumentMemorySnapshotSchema.parse(memoryInput);
  const sectionIdByAlias = new Map(memory.sections.map((section, index) => [`S${index + 1}`, section.sectionId]));
  const memoryItemIdByAlias = new Map(memory.items.map((item) => [item.memoryItemId, item.memoryItemId]));
  const sectionAliasById = new Map([...sectionIdByAlias].map(([alias, sectionId]) => [sectionId, alias]));
  const modelText = [
    `全文记忆概览：${memory.overview}`,
    "章节记忆：",
    ...memory.sections.map((section, index) =>
      `[S${index + 1}] ${section.title}（${section.semanticRole}）\n${section.summary}`),
    "语义记忆：",
    ...memory.items.map((item) => {
      const sectionAliases = item.sourceSectionIds.map((sectionId) => sectionAliasById.get(sectionId)!).filter(Boolean);
      return `[${item.memoryItemId}] ${item.kind} | ${item.concepts.join("、")} | 来源章节 ${sectionAliases.join(",") || "未知"}\n${item.statement}`;
    }),
  ].join("\n\n");
  return { modelText, sectionIdByAlias, memoryItemIdByAlias };
}

export async function planGrantAssistantContext(input: {
  documentId: string;
  sourceRevisionId: string;
  question: string;
  recentConversation: Array<{ role: "user" | "assistant"; content: string }>;
  memory: GrantDocumentMemorySnapshot;
  model: GrantAssistantContextPlannerModel;
  tokenCounter: GrantTokenCounter;
  maximumInputTokens: number;
  plannerPolicyVersion: string;
  explicitContext?: {
    hasDocumentSelection?: boolean;
    hasCandidate?: boolean;
    hasEvidence?: boolean;
    webSearchEnabledByUser?: boolean;
  };
  createId?: () => string;
}): Promise<GrantAssistantContextPlan> {
  const question = input.question.trim();
  if (!question) throw new GrantAssistantContextPlannerError("invalid_model_output", "A planning question is required.");
  const memory = GrantDocumentMemorySnapshotSchema.parse(input.memory);
  if (memory.documentId !== input.documentId || memory.sourceRevisionId !== input.sourceRevisionId) {
    throw new GrantAssistantContextPlannerError("stale_memory",
      "Assistant planning requires memory built from the current canonical Revision.");
  }
  if (!Number.isSafeInteger(input.maximumInputTokens) || input.maximumInputTokens <= 0) {
    throw new Error("Planner maximum input tokens must be a positive integer.");
  }
  const projection = buildGrantAssistantPlanningProjection(memory);
  const recentConversation = input.recentConversation.slice(-6).map((message) => ({
    role: message.role, content: message.content.trim() }));
  const explicitContext = {
    hasDocumentSelection: input.explicitContext?.hasDocumentSelection ?? false,
    hasCandidate: input.explicitContext?.hasCandidate ?? false,
    hasEvidence: input.explicitContext?.hasEvidence ?? false,
    webSearchEnabledByUser: input.explicitContext?.webSearchEnabledByUser ?? false,
  };
  const planningPayload = { question, recentConversation, documentMemoryText: projection.modelText, explicitContext };
  if (input.tokenCounter.count(JSON.stringify(planningPayload)) > input.maximumInputTokens) {
    throw new GrantAssistantContextPlannerError("planning_capacity_exceeded",
      "The complete grant memory does not fit the declared semantic-planning capacity.");
  }
  const proposal = await input.model.plan({ documentLanguage: /[\u3400-\u9fff]/u.test(question + memory.overview) ? "zh" : "en",
    ...planningPayload, allowedSectionAliases: [...projection.sectionIdByAlias.keys()],
    allowedMemoryItemAliases: [...projection.memoryItemIdByAlias.keys()] });
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
  return GrantAssistantContextPlanSchema.parse({ schemaVersion: "grant-assistant-context-plan-v1",
    planId: (input.createId ?? randomUUID)(), planHash: sha256Canonical({ sourceRevisionId: input.sourceRevisionId,
      memoryHash: memory.memoryHash, plannerPolicyVersion: input.plannerPolicyVersion, question, semanticDecision }),
    documentId: input.documentId, sourceRevisionId: input.sourceRevisionId, memoryId: memory.memoryId,
    memoryHash: memory.memoryHash, plannerPolicyVersion: input.plannerPolicyVersion, ...semanticDecision,
    provider: "openai", modelId: proposal.modelId, ...(proposal.providerRequestId ? { providerRequestId: proposal.providerRequestId } : {}),
    usage: { inputTokens: proposal.usage?.inputTokens ?? 0, outputTokens: proposal.usage?.outputTokens ?? 0,
      reasoningTokens: proposal.usage?.reasoningTokens ?? 0 } });
}
