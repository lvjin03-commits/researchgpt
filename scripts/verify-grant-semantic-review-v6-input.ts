import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { zodResponseFormat } from "openai/helpers/zod";
import { GrantFactMapProviderResultV1Schema } from "../lib/grants/diagnostics/semantic-review-v6-contracts.ts";
import { assembleGrantFactMapV1, buildGrantFactMapSystemPromptV1 } from "../lib/grants/diagnostics/semantic-review-v6-fact-map.ts";
import { buildGrantSemanticReviewV6PreparedInputV1 } from "../lib/grants/diagnostics/semantic-review-v6-input.ts";
import type { GrantHierarchicalDiagnosticPreparedInputV1 } from "../lib/grants/diagnostics/hierarchical-semantic-input.ts";

const sourceRevisionId = randomUUID();
const sectionId = randomUUID();
const nodeId1 = randomUUID();
const nodeId2 = randomUUID();
const evidenceId = randomUUID();
const sourceId = randomUUID();
const locations = new Map([
  ["N1", { sectionId, nodeId: nodeId1 }],
  ["N2", { sectionId, nodeId: nodeId2 }],
]);
const refsByNode = new Map([[nodeId1, "N1"], [nodeId2, "N2"]]);
const sections = [{
  sectionRef: "S1",
  semanticRole: "rationale",
  title: "立项依据",
  parentSectionRef: null,
  order: 0,
  nodes: [
    { locationRef: "N1", nodeType: "paragraph" as const, order: 0, text: "本项目拟阐明离子桥联调控界面反应的科学问题。" },
    { locationRef: "N2", nodeType: "paragraph" as const, order: 1, text: "前期循环结果显示材料性能得到改善。" },
  ],
}];
const fingerprint = "a".repeat(64);
const hierarchicalPrepared: GrantHierarchicalDiagnosticPreparedInputV1 = {
  sourceRevisionId,
  locationScopeFingerprint: fingerprint,
  argumentMapRequest: {
    contractVersion: "grant-semantic-diagnostic-v5",
    locationScopeFingerprint: fingerprint,
    documentLanguage: "zh",
    documentTitle: "离子桥联电解质研究",
    fundingCategory: "青年科学基金项目",
    inputMode: "full_document",
    stage: "argument_mapping",
    sections,
  },
  rootDiagnosisBaseRequest: {
    contractVersion: "grant-semantic-diagnostic-v5",
    locationScopeFingerprint: fingerprint,
    documentLanguage: "zh",
    documentTitle: "离子桥联电解质研究",
    fundingCategory: "青年科学基金项目",
    inputMode: "full_document",
    stage: "root_diagnosis",
    sections,
    evidenceCards: [{
      sourceId,
      cardId: evidenceId,
      sourceTitle: "已授权前期材料",
      provenanceType: "own_unpublished_work",
      verificationStatus: "metadata_only",
      supportedScope: "record_existence_only",
      excerpt: null,
      authorizationRevision: 1,
      sourceContentHash: "b".repeat(64),
      excerptHash: null,
    }],
    priorFindings: [],
  },
  locationByRef: locations,
  locationRefByNodeId: refsByNode,
  sectionIdByNodeId: new Map([[nodeId1, sectionId], [nodeId2, sectionId]]),
  allowedEvidenceCardIds: new Set([evidenceId]),
  figureLocationRefByAssetId: new Map(),
};

const prepared = buildGrantSemanticReviewV6PreparedInputV1({ prepared: hierarchicalPrepared });
assert.equal(prepared.sourceRevisionId, sourceRevisionId);
assert.equal(prepared.locationScopeFingerprint, fingerprint);
assert.equal(prepared.factMapRequest.contractVersion, "grant-semantic-diagnostic-v6");
assert.equal(prepared.factMapRequest.schemaVersion, "grant-fact-map-v1");
assert.equal(prepared.factMapRequest.promptVersion, "grant-semantic-review-v6");
assert.deepEqual(prepared.factMapRequest.sections, sections);
assert.deepEqual(prepared.reviewBaseRequest.sections, sections);
assert.strictEqual(prepared.locationByRef, locations, "V6 must reuse the existing atomic-location authority");
assert.strictEqual(prepared.allowedEvidenceCardIds, hierarchicalPrepared.allowedEvidenceCardIds);
assert.match(prepared.inputFingerprint, /^[a-f0-9]{64}$/);

const providerPayload = JSON.stringify(prepared.factMapRequest);
assert.equal(providerPayload.includes(sectionId), false, "provider input must not expose canonical section IDs");
assert.equal(providerPayload.includes(nodeId1), false, "provider input must not expose canonical node IDs");
assert.equal(providerPayload.includes(evidenceId), false, "Fact Map stage must not receive Evidence Cards");

const responseFormat = zodResponseFormat(GrantFactMapProviderResultV1Schema, "grant_fact_map_v1");
assert.equal(responseFormat.type, "json_schema");
assert.equal(responseFormat.json_schema.strict, true);
assert.equal((responseFormat.json_schema.schema as { additionalProperties?: boolean }).additionalProperties, false);
assert.throws(() => GrantFactMapProviderResultV1Schema.parse({
  semanticObjects: [{
    objectType: "scientific_question",
    normalizedFacet: "interface_reaction_control",
    sourceLocationRefs: ["N1"],
    diagnosis: "不得在Fact Map中输出诊断。",
  }],
}));

const assembled = assembleGrantFactMapV1({
  prepared,
  providerResult: {
    semanticObjects: [
      { objectType: "scientific_question", normalizedFacet: "interface_reaction_control", sourceLocationRefs: ["N1"] },
      { objectType: "preliminary_evidence", normalizedFacet: "cycling_performance", sourceLocationRefs: ["N2"] },
    ],
  },
});
assert.equal(assembled.success, true);
if (assembled.success) {
  assert.deepEqual(assembled.factMap.semanticObjects.map((item) => item.semanticObjectRef), ["S1", "S2"]);
  assert.equal(assembled.factMap.semanticObjects[0]?.anchors[0]?.nodeId, nodeId1);
  assert.equal(assembled.factMap.semanticObjects[0]?.anchors[0]?.anchorHash, createHash("sha256").update(sections[0]!.nodes[0]!.text).digest("hex"));
  assert.equal(assembled.factMap.semanticObjects[0]?.anchors[0]?.startOffset, 0);
  assert.equal(assembled.factMap.semanticObjects[0]?.anchors[0]?.endOffset, sections[0]!.nodes[0]!.text.length);
}

const unknownLocation = assembleGrantFactMapV1({
  prepared,
  providerResult: { semanticObjects: [{ objectType: "innovation_claim", normalizedFacet: "ion_bridge_mechanism", sourceLocationRefs: ["N99"] }] },
});
assert.equal(unknownLocation.success, false);
if (!unknownLocation.success) assert(unknownLocation.issues.some((issue) => issue.code === "source_location_unknown"));

const duplicateLocation = assembleGrantFactMapV1({
  prepared,
  providerResult: { semanticObjects: [{ objectType: "research_objective", normalizedFacet: "mechanism_validation", sourceLocationRefs: ["N1", "N1"] }] },
});
assert.equal(duplicateLocation.success, false);
if (!duplicateLocation.success) assert(duplicateLocation.issues.some((issue) => issue.code === "source_location_duplicate"));

const prompt = buildGrantFactMapSystemPromptV1("zh");
assert.match(prompt, /Do not diagnose/);
assert.match(prompt, /Never invent or combine IDs/);

console.log("Grant Semantic Review V6 frozen-input and Fact Map checks passed.");
