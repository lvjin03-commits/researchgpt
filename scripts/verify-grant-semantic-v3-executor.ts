import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { buildGrantSemanticDiagnosticV3Input } from "../lib/grants/diagnostics/semantic-v3-input.ts";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import {
  OpenAIGrantAiModel,
  grantDiagnosticV3ResponseFormat,
} from "../lib/grants/infrastructure/model/openai-grant-ai-model.ts";
import {
  GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
  GRANT_DIAGNOSTIC_V3_PROMPT_VERSION,
  GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION,
} from "../lib/grants/ports/grant-diagnostic-model.ts";

const sectionId = randomUUID();
const nodeId = randomUUID();
const snapshot: CanonicalGrantSnapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "国家自然科学基金申请书",
  sections: [{ sectionId, semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [nodeId] }],
  nodes: [{ nodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "现有论证没有说明变量之间的可检验关系。" } }],
};
const prepared = buildGrantSemanticDiagnosticV3Input({
  snapshot,
  inputMode: "full_document",
  inputSectionIds: [sectionId],
  inputNodeIds: [nodeId],
  fundingCategory: "青年科学基金项目",
  evidenceCards: [],
  priorFindings: [],
});
const validContent = JSON.stringify({
  findings: [{
    category: "scientific_question_gap",
    title: "科学问题缺少可检验关系",
    diagnosticFact: "立项依据描述了研究方向，但没有说明变量之间的可检验关系。",
    reason: "评审专家可能无法确认拟回答的问题及其判定标准。",
    recommendation: "明确关键变量、作用关系和验证该关系的观察指标。",
    possibleConsequence: "评审专家可能追问如何判定所提出机制是否成立。",
    assessment: { scope: "section", confidence: 0.91, actionability: "requires_expert_judgment" },
    primaryLocation: { sectionId, nodeId },
    relatedLocations: [],
    usedEvidenceCardIds: [],
  }],
});

const calls: Array<Record<string, unknown>> = [];
const client = {
  chat: { completions: { async create(request: Record<string, unknown>) {
    calls.push(request);
    return {
      id: `v3-${calls.length}`,
      object: "chat.completion",
      created: 0,
      model: "gpt-5.5",
      choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", refusal: null, content: validContent } }],
      usage: { prompt_tokens: 200, completion_tokens: 300, total_tokens: 500, completion_tokens_details: { reasoning_tokens: 40 } },
    };
  } } },
} as unknown as OpenAI;
const result = await new OpenAIGrantAiModel("gpt-5.5", "test", client).diagnoseV3(prepared);
assert.equal(calls.length, 1);
assert.equal(calls[0]!.reasoning_effort, "medium");
assert.deepEqual(calls[0]!.response_format, grantDiagnosticV3ResponseFormat());
const messages = calls[0]!.messages as Array<{ role: string; content: string }>;
assert.match(messages[0]!.content, /strict but fair domain reviewer/);
assert.match(messages[0]!.content, /metadata_only Evidence Card establishes record existence only/);
assert.match(messages[0]!.content, /scientific_question_gap/);
assert.equal(result.execution.policyVersion, GRANT_DIAGNOSTIC_V3_POLICY_VERSION);
assert.equal(result.execution.schemaVersion, GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION);
assert.equal(result.execution.promptVersion, GRANT_DIAGNOSTIC_V3_PROMPT_VERSION);
assert.equal(result.findings[0]!.primaryLocation.nodeId, nodeId);

let repairCalls = 0;
const repairClient = {
  chat: { completions: { async create() {
    repairCalls += 1;
    const content = repairCalls === 1
      ? JSON.stringify({ findings: [{ category: "scientific_question_gap" }] })
      : validContent;
    return {
      id: `repair-${repairCalls}`,
      object: "chat.completion",
      created: 0,
      model: "gpt-5.5",
      choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", refusal: null, content } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, completion_tokens_details: { reasoning_tokens: 10 } },
    };
  } } },
} as unknown as OpenAI;
const repaired = await new OpenAIGrantAiModel("gpt-5.5", "test", repairClient).diagnoseV3(prepared);
assert.equal(repairCalls, 2);
assert.equal(repaired.execution.attemptPurpose, "schema_repair");
assert.equal(repaired.execution.recoveredFrom, "structured_output_invalid");
assert.equal(repaired.usage.outputTokens, 200);

console.log("Grant semantic diagnostic V3 prompt and unified execution contracts passed.");
