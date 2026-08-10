import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import {
  GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS,
  GrantArgumentRoleSchema,
  GrantArgumentMapV1Schema,
  type GrantRootDiagnosticProviderResultV1,
} from "../lib/grants/diagnostics/hierarchical-semantic-contracts.ts";
import {
  buildGrantHierarchicalDiagnosticPreparedInputV1,
  buildGrantRootDiagnosticModelInputV1,
} from "../lib/grants/diagnostics/hierarchical-semantic-input.ts";
import { buildGrantRootDiagnosticMessagesV1 } from "../lib/grants/diagnostics/hierarchical-root-diagnostic-prompt.ts";
import { buildGrantSemanticDiagnosticV3Input } from "../lib/grants/diagnostics/semantic-v3-input.ts";
import {
  GrantRootDiagnosticExecutionError,
  executeGrantRootDiagnosticV1,
  grantRootDiagnosticResponseFormatV1,
} from "../lib/grants/infrastructure/model/openai-grant-root-diagnostic.ts";

const sourceRevisionId = randomUUID();
const sectionA = randomUUID();
const sectionB = randomUUID();
const nodeA = randomUUID();
const nodeB = randomUUID();
const snapshot: CanonicalGrantSnapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "国家自然科学基金申请书",
  sections: [
    { sectionId: sectionA, semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [nodeA] },
    { sectionId: sectionB, semanticRole: "methods", title: "研究方案", order: 1, nodeIds: [nodeB] },
  ],
  nodes: [
    { nodeId: nodeA, sectionId: sectionA, order: 0, nodeType: "paragraph", content: { text: "申请书提出界面配位决定传输行为的科学问题。" } },
    { nodeId: nodeB, sectionId: sectionB, order: 0, nodeType: "paragraph", content: { text: "研究方案只安排宏观电导率测试。" } },
  ],
};
const prepared = buildGrantHierarchicalDiagnosticPreparedInputV1({
  sourceRevisionId,
  prepared: buildGrantSemanticDiagnosticV3Input({
    snapshot,
    inputMode: "full_document",
    inputSectionIds: [sectionA, sectionB],
    inputNodeIds: [nodeA, nodeB],
    fundingCategory: "青年科学基金项目",
    evidenceCards: [],
    priorFindings: [],
  }),
});
const argumentMap = GrantArgumentMapV1Schema.parse({
  schemaVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.argumentMapSchemaVersion,
  sourceRevisionId,
  modules: GrantArgumentRoleSchema.options.map((role) => ({
    role,
    presence: "explicit",
    statement: `${role}在申请书中有表述。`,
    sourceLocations: [{ sectionId: sectionA, nodeId: nodeA }],
  })),
  relations: [{
    fromRole: "scientific_question",
    toRole: "technical_route",
    relation: "tests",
    sourceLocations: [{ sectionId: sectionA, nodeId: nodeA }, { sectionId: sectionB, nodeId: nodeB }],
  }],
});
const request = buildGrantRootDiagnosticModelInputV1({ prepared, argumentMap });
const requestText = JSON.stringify(request);
assert.match(requestText, /"sourceLocationRefs":\["N1"\]/);
assert.equal(requestText.includes(sectionA), false);
assert.equal(requestText.includes(nodeA), false);

const messages = buildGrantRootDiagnosticMessagesV1(request);
assert.match(messages[0]!.content, /One rootFinding must represent one underlying issue/);
assert.match(messages[0]!.content, /Merge repeated sentence-level or section-level manifestations/);
assert.match(messages[0]!.content, /Do not assign severity, priority, scores/);
assert.match(messages[0]!.content, /metadata_only proves record existence only/);

const validResult = {
  rootFindings: [{
    category: "objective_content_route_gap" as const,
    affectedArgumentRoles: ["scientific_question" as const, "technical_route" as const],
    title: "科学问题与验证路径未形成对应",
    diagnosticFact: "申请书提出界面配位问题，但方案只安排宏观电导率测试。",
    reason: "当前观察量不能直接区分界面配位机制是否成立。",
    recommendation: "补充能够直接观测或区分界面配位变化的验证环节。",
    possibleConsequence: "评审专家可能追问宏观电导率如何证明界面配位机制。",
    assessment: { scope: "cross_section" as const, confidence: 0.92, actionability: "requires_expert_judgment" as const },
    occurrences: [{
      primaryLocationRef: "N1",
      relatedLocations: [{ locationRef: "N2", role: "downstream_dependency" as const, quote: null }],
    }, {
      primaryLocationRef: "N2",
      relatedLocations: [{ locationRef: "N1", role: "upstream_dependency" as const, quote: null }],
    }],
    evidenceBasis: "document_only" as const,
    usedEvidenceCardIds: [],
  }],
};

const calls: Array<Record<string, unknown>> = [];
function clientFor(content: string, finishReason = "stop") {
  return {
    chat: { completions: { async create(payload: Record<string, unknown>) {
      calls.push(payload);
      return {
        id: `root-${calls.length}`,
        object: "chat.completion",
        created: 0,
        model: "gpt-5.5",
        choices: [{ index: 0, finish_reason: finishReason, logprobs: null, message: { role: "assistant", refusal: null, content } }],
        usage: { prompt_tokens: 800, completion_tokens: 600, total_tokens: 1400, completion_tokens_details: { reasoning_tokens: 100 } },
      };
    } } },
  } as unknown as OpenAI;
}

const executed = await executeGrantRootDiagnosticV1({
  client: clientFor(JSON.stringify(validResult)),
  modelId: "gpt-5.5",
  prepared,
  argumentMap,
});
assert.equal(calls.length, 1);
assert.deepEqual(calls[0]!.response_format, grantRootDiagnosticResponseFormatV1());
assert.equal(calls[0]!.reasoning_effort, "medium");
assert.equal(executed.result.rootFindings.length, 1);
assert.equal(executed.result.rootFindings[0]!.occurrences.length, 2, "one root card must retain multiple source manifestations");
assert.deepEqual(executed.result.rootFindings[0]!.occurrences[0]!.primaryLocation, { sectionId: sectionA, nodeId: nodeA });
assert.deepEqual(executed.result.rootFindings[0]!.occurrences[0]!.relatedLocations[0], {
  sectionId: sectionB,
  nodeId: nodeB,
  role: "downstream_dependency",
  quote: null,
});

const degraded: GrantRootDiagnosticProviderResultV1 = structuredClone(validResult);
degraded.rootFindings[0]!.affectedArgumentRoles.push("scientific_question");
degraded.rootFindings[0]!.occurrences[0]!.relatedLocations.push({
  locationRef: "N999",
  role: "supporting_location",
  quote: null,
});
const degradedResult = await executeGrantRootDiagnosticV1({
  client: clientFor(JSON.stringify(degraded)), modelId: "gpt-5.5", prepared, argumentMap,
});
assert.equal(degradedResult.result.rootFindings.length, 1, "invalid related locations must not discard an anchored root finding");
assert.equal(degradedResult.result.rootFindings[0]!.affectedArgumentRoles.length, 2);
assert.equal(degradedResult.execution.normalizationActions?.some((action) => action.rule === "invalid_related_location_removed"), true);

const badPrimary: GrantRootDiagnosticProviderResultV1 = structuredClone(validResult);
for (const occurrence of badPrimary.rootFindings[0]!.occurrences) occurrence.primaryLocationRef = "N999";
await assert.rejects(
  () => executeGrantRootDiagnosticV1({ client: clientFor(JSON.stringify(badPrimary)), modelId: "gpt-5.5", prepared, argumentMap }),
  (error: unknown) => error instanceof GrantRootDiagnosticExecutionError
    && error.code === "root_diagnosis_reference_invalid"
    && error.metadata.invalidReferencePaths?.includes("rootFindings.0.occurrences.0.primaryLocationRef") === true
    && JSON.stringify(error.metadata).includes("N999") === false,
);

const badEvidence: GrantRootDiagnosticProviderResultV1 = structuredClone(validResult);
badEvidence.rootFindings[0]!.evidenceBasis = "authorized_evidence";
badEvidence.rootFindings[0]!.usedEvidenceCardIds = [randomUUID()];
await assert.rejects(
  () => executeGrantRootDiagnosticV1({ client: clientFor(JSON.stringify(badEvidence)), modelId: "gpt-5.5", prepared, argumentMap }),
  (error: unknown) => error instanceof GrantRootDiagnosticExecutionError
    && error.code === "root_diagnosis_evidence_invalid",
);

await assert.rejects(
  () => executeGrantRootDiagnosticV1({ client: clientFor(JSON.stringify(validResult), "length"), modelId: "gpt-5.5", prepared, argumentMap }),
  (error: unknown) => error instanceof GrantRootDiagnosticExecutionError
    && error.code === "root_diagnosis_output_truncated",
);

assert.equal(calls.length, 5, "each root-diagnosis execution must make exactly one provider call in Step 4");
console.log("Grant root-diagnostic prompt, execution, grouping, reference and evidence contracts passed.");
