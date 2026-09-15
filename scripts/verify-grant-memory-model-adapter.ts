import assert from "node:assert/strict";
import type OpenAI from "openai";
import { OpenAIGrantAiModel } from "../lib/grants/infrastructure/model/openai-grant-ai-model.ts";

const responses = [
  { id: "req-memory-unit", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    summary: "单元摘要", sectionSummaries: [{ sectionAlias: "S1", summary: "章节摘要", sourceAliases: ["D1"] }],
    semanticItems: [{ kind: "scientific_problem", statement: "科学问题", concepts: ["界面"], sourceAliases: ["D1"] }],
  }) } }], usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 1 } } },
  { id: "req-memory-synthesis", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    overview: "全文概览", sectionSummaries: [{ sectionAlias: "S1", summary: "完整章节摘要", sourceAliases: ["D1"] }],
    semanticItems: [{ kind: "research_objective", statement: "研究目标", concepts: ["目标"], sourceAliases: ["D1"] }],
  }) } }], usage: { prompt_tokens: 8, completion_tokens: 4, completion_tokens_details: { reasoning_tokens: 1 } } },
  { id: "req-planner", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    answerMode: "explain", documentAccess: "targeted_original", diagnosticAccess: "relevant",
    webRecommendation: "none", targetSectionAliases: ["S1"], targetMemoryItemAliases: ["M1"],
    needsClarification: false, clarificationQuestion: null, confidence: 0.92, rationale: "需要核对原文。",
  }) } }], usage: { prompt_tokens: 6, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 1 } } },
];
const requestedFormats: string[] = [];
const client = { chat: { completions: { async create(request: { response_format?: { json_schema?: { name?: string } } }) {
  requestedFormats.push(request.response_format?.json_schema?.name ?? "unknown");
  return responses.shift()!;
} } } } as unknown as OpenAI;
const model = new OpenAIGrantAiModel("gpt-offline", "unused-test-key", client);
const unit = await model.analyzeMemoryUnit({ documentLanguage: "zh", contextHash: "a".repeat(64), unitId: "U1",
  modelText: "[D1] 正文", allowedSectionAliases: ["S1"], allowedSourceAliases: ["D1"] });
assert.equal(unit.providerRequestId, "req-memory-unit");
assert.equal(unit.semanticItems[0]?.kind, "scientific_problem");
const synthesis = await model.synthesizeMemory({ documentLanguage: "zh", contextHash: "a".repeat(64),
  analyses: [{ unitId: "U1", summary: unit.summary, sectionSummaries: unit.sectionSummaries,
    semanticItems: unit.semanticItems }], allowedSectionAliases: ["S1"], allowedSourceAliases: ["D1"] });
assert.equal(synthesis.overview, "全文概览");
const plan = await model.plan({ documentLanguage: "zh", question: "解释研究目标", recentConversation: [],
  documentMemoryText: "全文记忆", allowedSectionAliases: ["S1"], allowedMemoryItemAliases: ["M1"],
  explicitContext: { hasDocumentSelection: false, hasCandidate: false, hasEvidence: false,
    webSearchEnabledByUser: false } });
assert.equal(plan.documentAccess, "targeted_original");
assert.equal(plan.clarificationQuestion, undefined);
assert.deepEqual(requestedFormats, ["grant_document_memory_unit", "grant_document_memory_synthesis",
  "grant_assistant_context_plan"]);
assert.equal(responses.length, 0);

console.log("OpenAI Grant adapter enforces structured memory and semantic-planning contracts without a network call.");
