import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import {
  buildGrantHierarchicalDiagnosticPreparedInputV1,
} from "../lib/grants/diagnostics/hierarchical-semantic-input.ts";
import {
  buildGrantSemanticDiagnosticV3Input,
  GrantSemanticDiagnosticV3InputScopeError,
} from "../lib/grants/diagnostics/semantic-v3-input.ts";

const sourceRevisionId = randomUUID();
const parentSectionId = randomUUID();
const childSectionId = randomUUID();
const parentNodeId = randomUUID();
const childNodeId = randomUUID();
const snapshot: CanonicalGrantSnapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "国家自然科学基金申请书",
  sections: [
    { sectionId: childSectionId, semanticRole: "methods", title: "研究方案", parentSectionId, order: 1, nodeIds: [childNodeId] },
    { sectionId: parentSectionId, semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [parentNodeId] },
  ],
  nodes: [
    { nodeId: childNodeId, sectionId: childSectionId, order: 0, nodeType: "paragraph", content: { text: "通过对照实验验证核心假设。" } },
    { nodeId: parentNodeId, sectionId: parentSectionId, order: 0, nodeType: "paragraph", content: { text: "本项目拟回答界面调控机制问题。" } },
  ],
};

function prepare(sectionIds = [childSectionId, parentSectionId], nodeIds = [childNodeId, parentNodeId]) {
  return buildGrantSemanticDiagnosticV3Input({
    snapshot,
    inputMode: "full_document",
    inputSectionIds: sectionIds,
    inputNodeIds: nodeIds,
    fundingCategory: "青年科学基金项目",
    evidenceCards: [],
    priorFindings: [],
  });
}

const existingPrepared = prepare();
const hierarchical = buildGrantHierarchicalDiagnosticPreparedInputV1({ sourceRevisionId, prepared: existingPrepared });

assert.equal(existingPrepared.request.sections[0]!.nodes[0]!.locationRef, "N1", "V4 alias behavior must remain unchanged");
assert.equal(existingPrepared.request.sections[1]!.nodes[0]!.locationRef, "N2", "V4 alias behavior must remain unchanged");
assert.equal(hierarchical.argumentMapRequest.sections[0]!.nodes[0]!.locationRef, "N1");
assert.equal(hierarchical.rootDiagnosisBaseRequest.sections[0]!.nodes[0]!.locationRef, "N1");
assert.deepEqual(hierarchical.argumentMapRequest.sections, hierarchical.rootDiagnosisBaseRequest.sections);
assert.equal(hierarchical.argumentMapRequest.locationScopeFingerprint, hierarchical.rootDiagnosisBaseRequest.locationScopeFingerprint);
assert.equal(hierarchical.locationByRef, existingPrepared.locationByRef, "two-stage input must reuse the authoritative map object");
assert.equal(hierarchical.locationRefByNodeId, existingPrepared.locationRefByNodeId);
assert.deepEqual(hierarchical.locationByRef.get("N1"), { sectionId: parentSectionId, nodeId: parentNodeId });
assert.deepEqual(hierarchical.locationByRef.get("N2"), { sectionId: childSectionId, nodeId: childNodeId });

const sameScopeDifferentCallerOrder = buildGrantHierarchicalDiagnosticPreparedInputV1({
  sourceRevisionId,
  prepared: prepare([parentSectionId, childSectionId], [parentNodeId, childNodeId]),
});
assert.equal(
  sameScopeDifferentCallerOrder.locationScopeFingerprint,
  hierarchical.locationScopeFingerprint,
  "canonical ordering must make the location scope deterministic",
);
assert.deepEqual(sameScopeDifferentCallerOrder.argumentMapRequest.sections, hierarchical.argumentMapRequest.sections);

const anotherRevision = buildGrantHierarchicalDiagnosticPreparedInputV1({
  sourceRevisionId: randomUUID(),
  prepared: prepare(),
});
assert.notEqual(anotherRevision.locationScopeFingerprint, hierarchical.locationScopeFingerprint);

const providerPayload = JSON.stringify({
  argumentMapRequest: hierarchical.argumentMapRequest,
  rootDiagnosisBaseRequest: hierarchical.rootDiagnosisBaseRequest,
});
assert.equal(providerPayload.includes(parentSectionId), false, "provider input must not expose canonical section UUIDs");
assert.equal(providerPayload.includes(childSectionId), false, "provider input must not expose canonical section UUIDs");
assert.equal(providerPayload.includes(parentNodeId), false, "provider input must not expose canonical node UUIDs");
assert.equal(providerPayload.includes(childNodeId), false, "provider input must not expose canonical node UUIDs");

assert.throws(() => prepare([parentSectionId], [childNodeId]), GrantSemanticDiagnosticV3InputScopeError);
assert.throws(() => buildGrantHierarchicalDiagnosticPreparedInputV1({
  sourceRevisionId: "not-a-revision-id",
  prepared: existingPrepared,
}));

console.log("Grant hierarchical diagnostic frozen-input and atomic-location contracts passed.");
