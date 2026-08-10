import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { buildGrantSemanticDiagnosticV3Input } from "../lib/grants/diagnostics/semantic-v3-input.ts";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import {
  OpenAIGrantAiModel,
  grantDiagnosticV3ResponseFormat,
} from "../lib/grants/infrastructure/model/openai-grant-ai-model.ts";
import { GrantSemanticDiagnosticResultV3Schema } from "../lib/grants/diagnostics/semantic-v3-contracts.ts";
import { safeGrantDiagnosticValidationIssues } from "../lib/grants/diagnostics/validation-telemetry.ts";
import {
  GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
  GRANT_DIAGNOSTIC_V3_PROMPT_VERSION,
  GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION,
  GrantDiagnosticExecutionError,
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
    primaryLocation: { locationRef: "N1" },
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
assert.match(messages[0]!.content, /Never return sectionId or nodeId/);
assert.doesNotMatch(messages[1]!.content, /sectionId|nodeId/);
assert.match(messages[1]!.content, /"locationRef":"N1"/);
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

let structuralReferenceCalls = 0;
const invalidReferencePayload = JSON.parse(validContent) as Record<string, unknown>;
((invalidReferencePayload.findings as Array<Record<string, unknown>>)[0]!.primaryLocation as Record<string, unknown>).locationRef = "N999";
const structuralReferenceClient = {
  chat: { completions: { async create() {
    structuralReferenceCalls += 1;
    return {
      id: "invalid-reference",
      object: "chat.completion",
      created: 0,
      model: "gpt-5.5",
      choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", refusal: null, content: JSON.stringify(invalidReferencePayload) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, completion_tokens_details: { reasoning_tokens: 10 } },
    };
  } } },
} as unknown as OpenAI;
await assert.rejects(
  () => new OpenAIGrantAiModel("gpt-5.5", "test", structuralReferenceClient).diagnoseV3(prepared),
  (error: unknown) => {
    assert(error instanceof GrantDiagnosticExecutionError);
    assert.equal(error.category, "semantic_reference_invalid");
    assert.equal(error.metadata.attemptCount, 1);
    assert.deepEqual(error.metadata.zodIssuePaths, ["findings.0.primaryLocation.locationRef"]);
    assert.equal(JSON.stringify(error.metadata).includes("N999"), false);
    return true;
  },
);
assert.equal(structuralReferenceCalls, 1, "structural ID failures must not trigger a second paid model call");

const degradedPayload = JSON.parse(validContent) as Record<string, unknown>;
((degradedPayload.findings as Array<Record<string, unknown>>)[0]!.relatedLocations as unknown[]) = [{
  locationRef: "N999",
  role: "supporting_location",
  quote: null,
}];
const degradedClient = {
  chat: { completions: { async create() {
    return {
      id: "degraded-related-location",
      object: "chat.completion",
      created: 0,
      model: "gpt-5.5",
      choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", refusal: null, content: JSON.stringify(degradedPayload) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, completion_tokens_details: { reasoning_tokens: 10 } },
    };
  } } },
} as unknown as OpenAI;
const degraded = await new OpenAIGrantAiModel("gpt-5.5", "test", degradedClient).diagnoseV3(prepared);
assert.equal(degraded.findings.length, 1, "a bad related location must not discard a Finding with a valid primary location");
assert.equal(degraded.findings[0]!.relatedLocations.length, 0);
assert.equal(degraded.execution.normalizationActions?.some((action) => action.rule === "invalid_related_location_ref_removed"), true);

const mixedPrimaryPayload = JSON.parse(validContent) as { findings: Array<Record<string, unknown>> };
mixedPrimaryPayload.findings.push({
  ...structuredClone(mixedPrimaryPayload.findings[0]!),
  title: "invalid primary",
  primaryLocation: { locationRef: "N404" },
});
const mixedPrimaryClient = {
  chat: { completions: { async create() {
    return {
      id: "mixed-primary-location",
      object: "chat.completion",
      created: 0,
      model: "gpt-5.5",
      choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", refusal: null, content: JSON.stringify(mixedPrimaryPayload) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, completion_tokens_details: { reasoning_tokens: 10 } },
    };
  } } },
} as unknown as OpenAI;
const mixedPrimary = await new OpenAIGrantAiModel("gpt-5.5", "test", mixedPrimaryClient).diagnoseV3(prepared);
assert.equal(mixedPrimary.findings.length, 1, "an invalid primary location must discard only its own Finding");
assert.equal(mixedPrimary.execution.normalizationActions?.some((action) => action.rule === "finding_invalid_primary_location_removed"), true);

const invalidCrossSectionPayload = JSON.parse(validContent) as { findings: Array<Record<string, unknown>> };
invalidCrossSectionPayload.findings[0] = {
  ...invalidCrossSectionPayload.findings[0]!,
  category: "cross_section_inconsistency",
  relatedLocations: [{ locationRef: "N404", role: "upstream_dependency", quote: null }],
};
const invalidCrossSectionClient = {
  chat: { completions: { async create() {
    return {
      id: "invalid-cross-section-location",
      object: "chat.completion",
      created: 0,
      model: "gpt-5.5",
      choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", refusal: null, content: JSON.stringify(invalidCrossSectionPayload) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, completion_tokens_details: { reasoning_tokens: 10 } },
    };
  } } },
} as unknown as OpenAI;
await assert.rejects(
  () => new OpenAIGrantAiModel("gpt-5.5", "test", invalidCrossSectionClient).diagnoseV3(prepared),
  (error: unknown) => error instanceof GrantDiagnosticExecutionError
    && error.category === "semantic_reference_invalid"
    && error.metadata.normalizationActions?.some((action) => action.rule === "finding_required_related_location_missing_removed") === true,
);

const normalizedPayload = JSON.parse(validContent) as Record<string, unknown>;
((normalizedPayload.findings as Array<Record<string, unknown>>)[0]!.relatedLocations as unknown[]) = [
  { locationRef: "N1", role: "supporting_location", quote: "   " },
  { locationRef: "N1", role: "supporting_location", quote: "duplicate" },
];
const normalizationClient = {
  chat: { completions: { async create() {
    return {
      id: "normalized-reference",
      object: "chat.completion",
      created: 0,
      model: "gpt-5.5",
      choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", refusal: null, content: JSON.stringify(normalizedPayload) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, completion_tokens_details: { reasoning_tokens: 10 } },
    };
  } } },
} as unknown as OpenAI;
const normalized = await new OpenAIGrantAiModel("gpt-5.5", "test", normalizationClient).diagnoseV3(prepared);
assert.equal(normalized.findings[0]!.relatedLocations.length, 1);
assert.equal(normalized.findings[0]!.relatedLocations[0]!.quote, null);
assert.deepEqual(normalized.execution.normalizationActions?.map((action) => action.rule), [
  "empty_quote_to_null",
  "related_location_duplicate_removed",
]);

const privateText = "PRIVATE-GRANT-CONTENT";
const contentFailure = GrantSemanticDiagnosticResultV3Schema.safeParse({
  findings: [{
    ...(JSON.parse(validContent).findings[0] as Record<string, unknown>),
    diagnosticFact: "",
    reason: privateText,
  }],
});
assert.equal(contentFailure.success, false);
if (!contentFailure.success) {
  const safeIssues = safeGrantDiagnosticValidationIssues(contentFailure.error);
  assert.equal(safeIssues.some((issue) => issue.path === "findings.0.diagnosticFact" && issue.fieldClass === "content"), true);
  assert.equal(JSON.stringify(safeIssues).includes(privateText), false);
}

console.log("Grant semantic diagnostic V3 prompt and unified execution contracts passed.");
