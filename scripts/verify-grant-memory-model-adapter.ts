import assert from "node:assert/strict";
import type OpenAI from "openai";
import { OpenAIGrantAiModel } from "../lib/grants/infrastructure/model/openai-grant-ai-model.ts";
import { GrantAssistantModelError } from "../lib/grants/ports/grant-assistant-model.ts";

const responses = [
  { id: "req-memory-unit", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    summary: "单元摘要", sectionSummaries: [{ sectionAlias: "S1", summary: "章节摘要", sourceAliases: ["D1"] }],
    semanticItems: [{ kind: "scientific_problem", statement: "科学问题", concepts: ["界面"], sourceAliases: ["D1"] }],
  }) } }], usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 1 } } },
  { id: "req-planner", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    answerMode: "explain", documentAccess: "targeted_original", diagnosticAccess: "relevant",
    webRecommendation: "none", targetSectionAliases: ["S1"], targetMemoryItemAliases: ["M1"],
    needsClarification: false, clarificationQuestion: null, confidence: 0.92, rationale: "需要核对原文。",
  }) } }], usage: { prompt_tokens: 6, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 1 } } },
];
const requestedFormats: string[] = [];
const requestedOutputTokens: number[] = [];
const requestedReasoningEfforts: string[] = [];
const client = { chat: { completions: { async create(request: {
  response_format?: { json_schema?: { name?: string } }; max_completion_tokens?: number; reasoning_effort?: string;
}) {
  requestedFormats.push(request.response_format?.json_schema?.name ?? "unknown");
  requestedOutputTokens.push(request.max_completion_tokens ?? 0);
  requestedReasoningEfforts.push(request.reasoning_effort ?? "unknown");
  return responses.shift()!;
} } } } as unknown as OpenAI;
const model = new OpenAIGrantAiModel("gpt-offline", "unused-test-key", client);
const unit = await model.analyzeMemoryUnit({ documentLanguage: "zh", contextHash: "a".repeat(64), unitId: "U1",
  modelText: "[D1] 正文", allowedSectionAliases: ["S1"], allowedSourceAliases: ["D1"],
  attemptPurpose: "initial", maximumOutputTokens: 2_400 });
assert.equal(unit.providerRequestId, "req-memory-unit");
assert.equal(unit.semanticItems[0]?.kind, "scientific_problem");
const plan = await model.plan({ documentLanguage: "zh", question: "解释研究目标", recentConversation: [],
  documentMemoryText: "全文记忆", allowedSectionAliases: ["S1"], allowedMemoryItemAliases: ["M1"],
  explicitContext: { hasDocumentSelection: false, hasCandidate: false, hasEvidence: false,
    webSearchEnabledByUser: false }, maximumOutputTokens: 700 });
assert.equal(plan.documentAccess, "targeted_original");
assert.equal(plan.clarificationQuestion, undefined);
assert.deepEqual(requestedFormats, ["grant_document_memory_unit", "grant_assistant_context_plan"]);
assert.deepEqual(requestedOutputTokens, [2_400, 700],
  "Memory extraction must consume its caller-owned output budget instead of an adapter hard-coded limit.");
assert.equal(requestedReasoningEfforts[0], "none",
  "Deterministic memory extraction must not spend hidden reasoning tokens.");
assert.equal(responses.length, 0);

const truncatedClient = { chat: { completions: { async create() {
  return {
    id: "req-memory-truncated",
    choices: [{ finish_reason: "length", message: { content: "" } }],
    usage: { prompt_tokens: 31, completion_tokens: 17, completion_tokens_details: { reasoning_tokens: 3 } },
  };
} } } } as unknown as OpenAI;
const truncatedModel = new OpenAIGrantAiModel("gpt-offline", "unused-test-key", truncatedClient);
await assert.rejects(
  truncatedModel.analyzeMemoryUnit({
    documentLanguage: "zh", contextHash: "b".repeat(64), unitId: "U2",
    modelText: "[D2] 正文", allowedSectionAliases: ["S2"], allowedSourceAliases: ["D2"],
    attemptPurpose: "capacity_retry", maximumOutputTokens: 4_000,
  }),
  (error: unknown) => {
    assert.ok(error instanceof GrantAssistantModelError);
    assert.equal(error.category, "output_truncated");
    assert.equal(error.providerRequestId, "req-memory-truncated");
    assert.deepEqual(error.usage, { inputTokens: 31, outputTokens: 17, reasoningTokens: 3 });
    return true;
  },
);

console.log("OpenAI Grant adapter enforces structured memory and semantic-planning contracts without a network call.");
