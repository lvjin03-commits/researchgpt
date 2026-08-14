import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantAiEditSessionService, GrantAiEditSessionError } from "../lib/grants/application/grant-ai-edit-session-service.ts";
import { GrantModelExecutor } from "../lib/grants/application/grant-model-executor.ts";
import { sha256Canonical } from "../lib/grants/domain/canonical-json.ts";
import { InMemoryGrantAiEditSessionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-ai-edit-session-repository.ts";
import { InMemoryGrantModelCallRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-model-call-repository.ts";
import { evaluateGrantAiEditFactSafety } from "../lib/grants/edit-session/fact-safety.ts";

const documentId = randomUUID();
const revisionId = randomUUID();
const nodeId = randomUUID();
const actorId = randomUUID();
const sectionId = randomUUID();
let currentRevisionId = revisionId;
let currentText = "原始研究方案。";
const snapshot = () => ({
  schemaVersion: "grant-canonical-v1" as const, title: "测试申请书",
  sections: [{ sectionId, semanticRole: "research_plan", title: "研究方案", order: 0, nodeIds: [nodeId] }],
  nodes: [{ nodeId, sectionId, order: 0, nodeType: "paragraph" as const, content: { text: currentText } }],
});
const revisionService = {
  async getDocument() {
    return { document: { currentRevisionId }, currentRevision: { revisionId: currentRevisionId, snapshot: snapshot() } };
  },
};
const sessionRepository = new InMemoryGrantAiEditSessionRepository();
const callRepository = new InMemoryGrantModelCallRepository();
const semanticBases: string[] = [];
let call = 0;
let contextValid = true;
const contextSourceId = randomUUID();
const contextCardId = randomUUID();
let acceptedCount = 0;
const appliedRevisionId = randomUUID();
const patchService = {
  async proposeApprovedCandidate() { return { proposalId: randomUUID() }; },
  async accept() { acceptedCount += 1; return { aggregate: { currentRevision: { revisionId: appliedRevisionId } } }; },
};
const modelGateway = {
  async validateEditSessionCandidateContext() { return contextValid; },
  async proposeEditSessionTurn(input: { semanticBaseText: string }) {
    semanticBases.push(input.semanticBaseText);
    call += 1;
    const replacementText = call === 1 ? "更清晰的研究方案。" : call === 2 ? "效率提高30%。" : "继续优化后的研究方案。";
    return {
      replacementText, provider: "openai" as const, modelId: "test-model", usedEvidenceCardIds: [contextCardId],
      evidenceBindings: [{ sourceId: contextSourceId, cardId: contextCardId, sourceTitle: "测试资料", provenanceType: "project_material" as const, authorizationRevision: 1, sourceContentHash: "a".repeat(64), excerptHash: "b".repeat(64), uses: ["model", "reasoning"] as ["model", "reasoning"] }],
    };
  },
};
const service = new GrantAiEditSessionService({
  repository: sessionRepository,
  revisionService: revisionService as never,
  modelGateway,
  modelExecutor: new GrantModelExecutor(callRepository),
  patchService: patchService as never,
  configuredGrantModelId: "test-model",
});

const session = await service.createSession({
  documentId, baseRevisionId: revisionId, targetNodeId: nodeId,
  expectedNodeHash: sha256Canonical(currentText), editMode: "replace", actorId,
});
const first = await service.continueSession({ sessionId: session.sessionId, instruction: "写得更清楚" });
assert.equal(first.candidate.safetyState, "passed");
const second = await service.continueSession({ sessionId: session.sessionId, instruction: "加一个数据" });
assert.equal(second.candidate.safetyState, "needs_confirmation");
assert.equal(second.candidate.factCheck.issues[0]?.code, "claim_binding_missing");
const third = await service.continueSession({ sessionId: session.sessionId, instruction: "去掉无依据数据并继续优化" });
assert.equal(third.candidate.basedOnCandidateId, second.candidate.candidateId);
assert.equal(third.candidate.semanticBaseCandidateId, first.candidate.candidateId);
assert.equal(semanticBases[2], first.candidate.text);
assert.equal((await service.getSession(session.sessionId)).turns.length, 3);
assert.equal((await callRepository.listByTrace(documentId, third.traceId)).length, 1);

contextValid = false;
await service.continueSession({ sessionId: session.sessionId, instruction: "撤权后继续" });
const afterRevocation = await service.getSession(session.sessionId);
assert.equal(afterRevocation.candidates.find((candidate) => candidate.candidateId === third.candidate.candidateId)?.safetyState, "needs_repair");
assert.equal(semanticBases[3], first.candidate.text);

currentRevisionId = randomUUID();
await assert.rejects(
  service.continueSession({ sessionId: session.sessionId, instruction: "继续" }),
  (error: unknown) => error instanceof GrantAiEditSessionError && error.code === "session_stale",
);
assert.equal((await service.getSession(session.sessionId)).session.status, "stale");

currentRevisionId = revisionId;
contextValid = true;
const applySession = await service.createSession({ documentId, baseRevisionId: revisionId, targetNodeId: nodeId, expectedNodeHash: sha256Canonical(currentText), editMode: "replace", actorId, originFindingId: randomUUID() });
const applyCandidate = await service.continueSession({ sessionId: applySession.sessionId, instruction: "简洁改写" });
assert.equal(applyCandidate.candidate.safetyState, "passed");
const applied = await service.applyActiveCandidate({ sessionId: applySession.sessionId, candidateId: applyCandidate.candidate.candidateId, actorId });
assert.equal(applied.session.status, "applied");
assert.equal(applied.revisionId, appliedRevisionId);
await service.applyActiveCandidate({ sessionId: applySession.sessionId, candidateId: applyCandidate.candidate.candidateId, actorId });
assert.equal(acceptedCount, 1);

const evidenceCardId = randomUUID();
const bound = evaluateGrantAiEditFactSafety({
  oldText: "保持稳定。", newText: "循环100次后保持稳定。",
  proposedBindings: [{ claimRef: "C1", evidenceCardId }], authorizedEvidenceCardIds: [evidenceCardId],
});
assert.equal(bound.state, "passed");
assert.equal(bound.claims[0]?.kind, "numeric_assertion");
const unauthorized = evaluateGrantAiEditFactSafety({
  oldText: "保持稳定。", newText: "循环100次后保持稳定。",
  proposedBindings: [{ claimRef: "C1", evidenceCardId }], authorizedEvidenceCardIds: [],
});
assert.equal(unauthorized.state, "blocked");
assert.ok(unauthorized.issues.some((issue) => issue.code === "claim_source_unauthorized"));
const reference = evaluateGrantAiEditFactSafety({ oldText: "正文。", newText: "正文。[1]\n参考文献：[1] Example" });
assert.equal(reference.state, "blocked");
assert.ok(reference.issues.some((issue) => issue.code === "new_reference_forbidden"));
console.log("Grant AI edit session contracts verified.");
