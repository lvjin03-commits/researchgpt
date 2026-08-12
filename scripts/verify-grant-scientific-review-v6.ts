import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type OpenAI from "openai";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
  type GrantFactMapV1,
} from "../lib/grants/diagnostics/semantic-review-v6-contracts.ts";
import { assembleGrantScientificReviewV1 } from "../lib/grants/diagnostics/semantic-review-v6-scientific-assembler.ts";
import { buildGrantScientificReviewModelInputV1 } from "../lib/grants/diagnostics/semantic-review-v6-scientific-input.ts";
import { buildGrantScientificReviewMessagesV1 } from "../lib/grants/diagnostics/semantic-review-v6-scientific-prompt.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "../lib/grants/diagnostics/semantic-review-v6-input.ts";
import {
  executeGrantScientificReviewV1,
  GrantScientificReviewExecutionErrorV1,
} from "../lib/grants/infrastructure/model/openai-grant-scientific-review-v6.ts";

const revisionId = randomUUID();
const sectionId = randomUUID();
const nodeId1 = randomUUID();
const nodeId2 = randomUUID();
const verifiedCardId = randomUUID();
const metadataCardId = randomUUID();
const sourceId = randomUUID();
const fingerprint = "a".repeat(64);
const text1 = "本项目提出离子桥联调控界面反应的科学问题，并拟验证其作用机制。";
const text2 = "前期循环结果显示性能得到改善，但尚未直接观察界面机制。";
const sections = [{
  sectionRef: "S1",
  semanticRole: "rationale",
  title: "立项依据",
  parentSectionRef: null,
  order: 0,
  nodes: [
    { locationRef: "N1", nodeType: "paragraph" as const, order: 0, text: text1 },
    { locationRef: "N2", nodeType: "paragraph" as const, order: 1, text: text2 },
  ],
}];
const locationByRef = new Map([
  ["N1", { sectionId, nodeId: nodeId1 }],
  ["N2", { sectionId, nodeId: nodeId2 }],
]);
const evidenceCards = [
  {
    sourceId,
    cardId: verifiedCardId,
    sourceTitle: "已核验前期材料",
    provenanceType: "own_unpublished_work" as const,
    verificationStatus: "verified" as const,
    supportedScope: "支持前期循环性能描述",
    excerpt: "循环性能得到改善。",
    authorizationRevision: 1,
    sourceContentHash: "b".repeat(64),
    excerptHash: "c".repeat(64),
  },
  {
    sourceId,
    cardId: metadataCardId,
    sourceTitle: "仅元数据记录",
    provenanceType: "published_literature" as const,
    verificationStatus: "metadata_only" as const,
    supportedScope: "record_existence_only",
    excerpt: null,
    authorizationRevision: 1,
    sourceContentHash: "d".repeat(64),
    excerptHash: null,
  },
];
const prepared: GrantSemanticReviewV6PreparedInputV1 = {
  sourceRevisionId: revisionId,
  inputFingerprint: "e".repeat(64),
  locationScopeFingerprint: fingerprint,
  factMapRequest: {
    contractVersion: "grant-semantic-diagnostic-v6",
    schemaVersion: "grant-fact-map-v1",
    promptVersion: "grant-semantic-review-v6",
    stage: "fact_mapping",
    locationScopeFingerprint: fingerprint,
    documentLanguage: "zh",
    documentTitle: "离子桥联研究",
    fundingCategory: "青年科学基金项目",
    inputMode: "full_document",
    sections,
  },
  reviewBaseRequest: {
    contractVersion: "grant-semantic-diagnostic-v6",
    promptVersion: "grant-semantic-review-v6",
    stage: "semantic_review_base",
    locationScopeFingerprint: fingerprint,
    documentLanguage: "zh",
    documentTitle: "离子桥联研究",
    fundingCategory: "青年科学基金项目",
    inputMode: "full_document",
    sections,
    evidenceCards,
    priorFindings: [],
  },
  locationByRef,
  locationRefByNodeId: new Map([[nodeId1, "N1"], [nodeId2, "N2"]]),
  sectionIdByNodeId: new Map([[nodeId1, sectionId], [nodeId2, sectionId]]),
  allowedEvidenceCardIds: new Set([verifiedCardId, metadataCardId]),
  figureLocationRefByAssetId: new Map(),
};
const factMap: GrantFactMapV1 = {
  schemaVersion: "grant-fact-map-v1",
  sourceRevisionId: revisionId,
  locationScopeFingerprint: fingerprint,
  semanticObjects: [
    {
      schemaVersion: "grant-semantic-object-v1",
      sourceRevisionId: revisionId,
      semanticObjectRef: "S1",
      objectType: "scientific_question",
      normalizedFacet: "interface_reaction_control",
      anchors: [{
        sourceRevisionId: revisionId,
        sectionId,
        nodeId: nodeId1,
        startOffset: 0,
        endOffset: text1.length,
        anchorHash: createHash("sha256").update(text1).digest("hex"),
      }],
    },
    {
      schemaVersion: "grant-semantic-object-v1",
      sourceRevisionId: revisionId,
      semanticObjectRef: "S2",
      objectType: "preliminary_evidence",
      normalizedFacet: "cycling_performance",
      anchors: [{
        sourceRevisionId: revisionId,
        sectionId,
        nodeId: nodeId2,
        startOffset: 0,
        endOffset: text2.length,
        anchorHash: createHash("sha256").update(text2).digest("hex"),
      }],
    },
  ],
};

const request = buildGrantScientificReviewModelInputV1({ prepared, factMap });
assert.equal(request.stage, "scientific_review");
assert.equal(request.schemaVersion, "grant-scientific-finding-v1");
assert.deepEqual(request.factMapObjects.map((item) => item.semanticObjectRef), ["S1", "S2"]);
assert.deepEqual(request.factMapObjects[0]?.sourceLocationRefs, ["N1"]);
assert.equal(JSON.stringify(request).includes(nodeId1), false, "Scientific provider input must not expose canonical node IDs");

const finding = {
  findingRef: "F1",
  category: "evidence_support_gap",
  semanticObjectRefs: ["S1", "S2"],
  title: "性能证据尚不能直接支撑界面机制",
  diagnosticFact: "原文提供了循环性能改善，但未提供直接机制观测。",
  existingDesign: [{ locationRef: "N2", summary: "已有循环性能结果", evidenceTier: "performance_improvement" }],
  residualGap: "仍缺少直接观察界面反应路径的机制证据。",
  reasonExistingDesignIsInsufficient: "性能改善能够支持可行性，但不能单独证明机制。",
  recommendation: "补充可直接观察界面过程的验证设计，并说明成立判据。",
  possibleReviewerQuestion: "如何证明性能改善来自所提出的界面机制？",
  assessment: { scope: "cross_section", confidence: 0.9, actionability: "requires_evidence" },
  primaryLocationRef: "N1",
  relatedLocations: [{ locationRef: "N2", role: "supporting_location" }],
  evidenceBasis: "document_only",
  usedEvidenceCardIds: [] as string[],
};
const validResult = {
  findings: [finding],
  coverageItems: [
    { semanticObjectRef: "S1", objectType: "scientific_question", disposition: "residual_gap_found", findingRefs: ["F1"], unableToVerifyReason: null },
    { semanticObjectRef: "S2", objectType: "preliminary_evidence", disposition: "residual_gap_found", findingRefs: ["F1"], unableToVerifyReason: null },
  ],
};

const assembled = assembleGrantScientificReviewV1({ prepared, factMap, providerResult: validResult });
assert.equal(assembled.success, true);
if (assembled.success) {
  assert.equal(assembled.scientificFindings.length, 1);
  assert.equal(assembled.scientificFindings[0]?.primaryLocation.nodeId, nodeId1);
  assert.equal(assembled.coverageReport.coverageItems.length, 2);
}

const invalidRelated = structuredClone(validResult);
invalidRelated.findings[0]!.relatedLocations.push({ locationRef: "N99", role: "comparison_location" });
const normalized = assembleGrantScientificReviewV1({ prepared, factMap, providerResult: invalidRelated });
assert.equal(normalized.success, true, "invalid related locations should degrade locally");
if (normalized.success) assert(normalized.actions.some((action) => action.code === "drop_invalid_related_location"));

const invalidExisting = structuredClone(validResult);
invalidExisting.findings[0]!.existingDesign[0]!.locationRef = "N99";
const rejectedExisting = assembleGrantScientificReviewV1({ prepared, factMap, providerResult: invalidExisting });
assert.equal(rejectedExisting.success, false, "unverifiable existing-design claims must reject the review");

const metadataOverclaim = structuredClone(validResult);
metadataOverclaim.findings[0]!.evidenceBasis = "authorized_evidence";
metadataOverclaim.findings[0]!.usedEvidenceCardIds = [metadataCardId];
const rejectedMetadata = assembleGrantScientificReviewV1({ prepared, factMap, providerResult: metadataOverclaim });
assert.equal(rejectedMetadata.success, false, "metadata-only cards cannot support scientific conclusions");

const missingCoverage = structuredClone(validResult);
missingCoverage.coverageItems.pop();
const rejectedCoverage = assembleGrantScientificReviewV1({ prepared, factMap, providerResult: missingCoverage });
assert.equal(rejectedCoverage.success, false, "every Fact Map object must be reviewed exactly once");

const noGapResult = {
  findings: [],
  coverageItems: factMap.semanticObjects.map((object) => ({
    semanticObjectRef: object.semanticObjectRef,
    objectType: object.objectType,
    disposition: "verified_no_residual_gap" as const,
    findingRefs: [],
    unableToVerifyReason: null,
  })),
};
assert.equal(assembleGrantScientificReviewV1({ prepared, factMap, providerResult: noGapResult }).success, true);

const messages = buildGrantScientificReviewMessagesV1(request);
assert.match(messages[0]!.content, /Never invent a residual gap/);
assert.match(messages[0]!.content, /metadata_only establishes record existence only/);
assert.equal(request.expectedCoverageItemCount, factMap.semanticObjects.length);
assert.match(messages[0]!.content, /exactly expectedCoverageItemCount entries/);
assert.match(messages[0]!.content, /Every emitted Finding ref must be used/);
assert.match(messages[1]!.content, /"expectedCoverageItemCount":2/);
assert.equal(/severity|priority/.test(JSON.stringify(validResult)), false);

const largeCoverageRequest = {
  ...request,
  expectedCoverageItemCount: 71,
  factMapObjects: Array.from({ length: 71 }, (_, index) => ({
    semanticObjectRef: `S${index + 1}` as `S${number}`,
    objectType: "scientific_question" as const,
    normalizedFacet: `coverage_object_${index + 1}`,
    sourceLocationRefs: ["N1" as const],
  })),
};
const largeCoverageMessages = buildGrantScientificReviewMessagesV1(largeCoverageRequest);
const largeCoveragePayload = JSON.parse(largeCoverageMessages[1]!.content);
assert.equal(largeCoveragePayload.expectedCoverageItemCount, 71);
assert.equal(largeCoveragePayload.factMapObjects.length, 71);
assert.equal(largeCoveragePayload.factMapObjects[70]?.semanticObjectRef, "S71");

const calls: Array<Record<string, unknown>> = [];
function fakeClient(result: unknown, finishReason = "stop"): OpenAI {
  return {
    chat: {
      completions: {
        create: async (payload: Record<string, unknown>) => {
          calls.push(payload);
          return {
            id: "chatcmpl-scientific-v1",
            choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(result), refusal: null } }],
            usage: { prompt_tokens: 1200, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 120 } },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

const executed = await executeGrantScientificReviewV1({
  client: fakeClient(validResult),
  modelId: "gpt-5.5",
  prepared,
  factMap,
  maxCompletionTokens: 12000,
});
assert.equal(executed.scientificFindings.length, 1);
assert.equal(executed.execution.operation, "diagnostic.scientific_review");
assert.equal(executed.execution.contractVersion, GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion);
assert.equal(calls.length, 1, "Scientific executor must not own a retry loop");
assert.equal(calls[0]!.max_completion_tokens, 12000);
assert.equal(calls[0]!.reasoning_effort, "medium");

await assert.rejects(
  () => executeGrantScientificReviewV1({
    client: fakeClient(validResult, "length"),
    modelId: "gpt-5.5",
    prepared,
    factMap,
    maxCompletionTokens: 12000,
  }),
  (error: unknown) => error instanceof GrantScientificReviewExecutionErrorV1
    && error.code === "scientific_review_output_truncated",
);

console.log("Grant Semantic Review V6 scientific input, prompt, assembly and executor checks passed.");
