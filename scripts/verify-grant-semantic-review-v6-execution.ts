import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import type { GrantSemanticReviewV6PreparedInputV1 } from "../lib/grants/diagnostics/semantic-review-v6-input.ts";
import {
  GRANT_SEMANTIC_REVIEW_V6_BUDGET,
  GrantSemanticReviewV6ExecutionError,
  executeGrantSemanticReviewV6,
} from "../lib/grants/infrastructure/model/openai-grant-semantic-review-v6.ts";

const sourceRevisionId = randomUUID();
const sectionId = randomUUID();
const nodeId = randomUUID();
const fingerprint = "a".repeat(64);
const sections = [{
  sectionRef: "S1", semanticRole: "rationale", title: "立项依据", parentSectionRef: null, order: 0,
  nodes: [{ locationRef: "N1", nodeType: "paragraph" as const, order: 0, text: "项目提出界面调控机制并设计验证路径。" }],
}];
const prepared: GrantSemanticReviewV6PreparedInputV1 = {
  sourceRevisionId,
  inputFingerprint: "b".repeat(64),
  locationScopeFingerprint: fingerprint,
  factMapRequest: {
    contractVersion: "grant-semantic-diagnostic-v6", schemaVersion: "grant-fact-map-v1", promptVersion: "grant-semantic-review-v6",
    stage: "fact_mapping", locationScopeFingerprint: fingerprint, documentLanguage: "zh", documentTitle: "界面调控申请书",
    fundingCategory: "青年科学基金项目", inputMode: "full_document", sections,
  },
  reviewBaseRequest: {
    contractVersion: "grant-semantic-diagnostic-v6", promptVersion: "grant-semantic-review-v6", stage: "semantic_review_base",
    locationScopeFingerprint: fingerprint, documentLanguage: "zh", documentTitle: "界面调控申请书",
    fundingCategory: "青年科学基金项目", inputMode: "full_document", sections, evidenceCards: [], priorFindings: [],
  },
  locationByRef: new Map([["N1", { sectionId, nodeId }]]),
  locationRefByNodeId: new Map([[nodeId, "N1"]]),
  sectionIdByNodeId: new Map([[nodeId, sectionId]]),
  allowedEvidenceCardIds: new Set(),
  figureLocationRefByAssetId: new Map(),
};
const factProvider = { semanticObjects: [{ objectType: "scientific_question", normalizedFacet: "interface_control", sourceLocationRefs: ["N1"] }] };
const scientificProvider = {
  findings: [],
  coverageItems: [{ semanticObjectRef: "S1", objectType: "scientific_question", disposition: "verified_no_residual_gap", findingRefs: [], unableToVerifyReason: null }],
};
const narrativeProvider = { findings: [] };

type Reply = { body: unknown; finishReason?: string } | { error: Error };
function queuedClient(replies: Reply[]) {
  const calls: Array<Record<string, unknown>> = [];
  const client = { chat: { completions: { create: async (payload: Record<string, unknown>) => {
    calls.push(payload);
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected provider call beyond aggregate budget.");
    if ("error" in reply) throw reply.error;
    return {
      id: `v6-${calls.length}`,
      choices: [{ finish_reason: reply.finishReason ?? "stop", message: { content: JSON.stringify(reply.body), refusal: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 1 } },
    };
  } } } } as unknown as OpenAI;
  return { client, calls };
}

assert.deepEqual(GRANT_SEMANTIC_REVIEW_V6_BUDGET, {
  factMapMaxCalls: 1, scientificReviewMaxCalls: 2, narrativeReviewMaxCalls: 2,
  totalMaxCalls: 4, normalCallCount: 3, maxCompletionTokenAllocation: 46_000,
  factMapCompletionTokens: 6_000, scientificCompletionTokens: 12_000, scientificCapacityRetryTokens: 18_000,
  narrativeCompletionTokens: 8_000, narrativeCapacityRetryTokens: 14_000,
});

const normalClient = queuedClient([{ body: factProvider }, { body: scientificProvider }, { body: narrativeProvider }]);
const normal = await executeGrantSemanticReviewV6({ client: normalClient.client, modelId: "gpt-5.5", prepared });
assert.equal(normal.providerCallCount, 3);
assert.equal(normal.completionTokenAllocation, 26_000);
assert.deepEqual(normal.stages.map((stage) => stage.status), ["succeeded", "succeeded", "succeeded"]);
assert.equal(normal.resumedFrom, "none");
assert.deepEqual(normal.usage, { inputTokens: 30, outputTokens: 60, reasoningTokens: 3 });
assert.deepEqual(normalClient.calls.map((call) => call.max_completion_tokens), [6_000, 12_000, 8_000]);

const recoveredClient = queuedClient([
  { body: factProvider },
  { body: scientificProvider, finishReason: "length" },
  { body: scientificProvider },
  { body: narrativeProvider },
]);
const recovered = await executeGrantSemanticReviewV6({ client: recoveredClient.client, modelId: "gpt-5.5", prepared });
assert.equal(recovered.providerCallCount, 4);
assert.equal(recovered.completionTokenAllocation, 44_000);
assert.deepEqual(recovered.stages.map((stage) => stage.attemptCount), [1, 2, 1]);
assert.deepEqual(recoveredClient.calls.map((call) => call.max_completion_tokens), [6_000, 12_000, 18_000, 8_000]);

const deterministicFailureClient = queuedClient([{ body: factProvider }, { body: { findings: [], coverageItems: [] } }]);
await assert.rejects(
  () => executeGrantSemanticReviewV6({ client: deterministicFailureClient.client, modelId: "gpt-5.5", prepared }),
  (error: unknown) => error instanceof GrantSemanticReviewV6ExecutionError
    && error.failedStage === "scientific_review"
    && error.providerCallCount === 2
    && error.checkpoint?.factMap.semanticObjects.length === 1,
);
assert.equal(deterministicFailureClient.calls.length, 2, "coverage failures must not consume the exceptional call");

const scientificCheckpoint = {
  sourceRevisionId,
  inputFingerprint: prepared.inputFingerprint,
  locationScopeFingerprint: prepared.locationScopeFingerprint,
  factMap: normal.factMap,
  scientificReview: { scientificFindings: normal.scientificFindings, coverageReport: normal.coverageReport },
};
const resumeClient = queuedClient([{ body: narrativeProvider }]);
const resumed = await executeGrantSemanticReviewV6({ client: resumeClient.client, modelId: "gpt-5.5", prepared, checkpoint: scientificCheckpoint });
assert.equal(resumed.providerCallCount, 1);
assert.equal(resumed.resumedFrom, "scientific_review");
assert.deepEqual(resumed.stages.map((stage) => stage.attemptCount), [0, 0, 1]);

const staleCheckpoint = { ...scientificCheckpoint, sourceRevisionId: randomUUID() };
const staleClient = queuedClient([]);
await assert.rejects(() => executeGrantSemanticReviewV6({ client: staleClient.client, modelId: "gpt-5.5", prepared, checkpoint: staleCheckpoint }));
assert.equal(staleClient.calls.length, 0, "stale checkpoints must fail before any paid call");

console.log("Grant Semantic Review V6 unified call budget, recovery and checkpoint contracts passed.");
