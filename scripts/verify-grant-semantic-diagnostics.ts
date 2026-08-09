import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GrantDiagnosticService } from "../lib/grants/application/diagnostic-service.ts";
import { GrantModelDataGateway } from "../lib/grants/application/grant-model-data-gateway.ts";
import { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { GrantSemanticDiagnosticChecker } from "../lib/grants/application/semantic-diagnostic-checker.ts";
import { GrantStructuralCompletenessChecker } from "../lib/grants/diagnostics/structural-completeness-checker.ts";
import { InMemoryGrantDiagnosticRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-diagnostic-repository.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";
import type { GrantDiagnosticModel } from "../lib/grants/ports/grant-diagnostic-model.ts";
import type { GrantPatchModel } from "../lib/grants/ports/grant-patch-model.ts";

const ownerId = randomUUID();
const revisions = new GrantRevisionService({ repository: new InMemoryGrantRevisionRepository() });
const aggregate = await revisions.createDocument({
  ownerId,
  actorId: ownerId,
  draft: {
    title: "国自然申请书",
    sections: [{
      localKey: "basis",
      semanticRole: "rationale",
      title: "立项依据",
      order: 0,
      nodes: [{ localKey: "basis-p1", nodeType: "paragraph", content: { text: "研究问题尚未明确说明关键变量之间的因果关系。" } }],
    }],
  },
  template: { templateKey: "nsfc-general", templateVersion: "1", rules: {} },
});
const sectionId = aggregate.currentRevision.snapshot.sections[0]!.sectionId;
const nodeId = aggregate.currentRevision.snapshot.nodes[0]!.nodeId;

const requests: Parameters<GrantDiagnosticModel["diagnose"]>[0][] = [];
const model: GrantPatchModel & GrantDiagnosticModel = {
  async generate() {
    return { replacementText: "test", provider: "openai", modelId: "gpt-5.5", usedEvidenceCardIds: [] };
  },
  async diagnose(request) {
    requests.push(request);
    return {
      findings: [{
        category: "scientific_question_gap",
        message: "核心科学问题尚未形成可检验的因果命题。",
        recommendation: "明确关键变量、作用方向和可证伪的预期关系。",
        assessment: { scope: "section", confidence: 0.88, actionability: "requires_expert_judgment" },
        sectionId,
        nodeId,
      }],
      provider: "openai",
      modelId: "gpt-5.5",
      usage: { inputTokens: 120, outputTokens: 80, reasoningTokens: 24 },
    };
  },
};
const repository = new InMemoryGrantDiagnosticRepository();
const service = new GrantDiagnosticService({
  revisionService: revisions,
  repository,
  checkers: [
    new GrantStructuralCompletenessChecker(),
    new GrantSemanticDiagnosticChecker(new GrantModelDataGateway(model), "gpt-5.5"),
  ],
  incrementalEnabled: true,
});
const execution = await service.run(aggregate.document.documentId, ownerId);
assert.equal(requests.length, 1);
assert.equal(requests[0]!.sections[0]!.nodes[0]!.nodeId, nodeId);
assert.equal(execution.findings.some((finding) => finding.code === "scientific_question_gap"), true);
const semanticRun = execution.runs.find((run) => run.checkerId === "grant-semantic-argument-diagnostic");
assert.equal(semanticRun?.parsedOutput.metadata && (semanticRun.parsedOutput.metadata as Record<string, unknown>).modelId, "gpt-5.5");
assert.equal((await service.list(aggregate.document.documentId)).coverage.semantic, "complete");

const failingModel: GrantPatchModel & GrantDiagnosticModel = {
  ...model,
  async diagnose() { throw new Error("provider unavailable"); },
};
const failureRepository = new InMemoryGrantDiagnosticRepository();
const failureService = new GrantDiagnosticService({
  revisionService: revisions,
  repository: failureRepository,
  checkers: [
    new GrantStructuralCompletenessChecker(),
    new GrantSemanticDiagnosticChecker(new GrantModelDataGateway(failingModel), "gpt-5.5"),
  ],
  incrementalEnabled: true,
});
const partial = await failureService.run(aggregate.document.documentId, ownerId);
assert.equal(partial.runs.some((run) => run.checkerId === "grant.structural_completeness" && run.status === "succeeded"), true);
assert.equal(partial.runs.some((run) => run.checkerId === "grant-semantic-argument-diagnostic" && run.status === "failed"), true);
assert.equal((await failureService.list(aggregate.document.documentId)).coverage.semantic, "failed");

const invalidModel: GrantPatchModel & GrantDiagnosticModel = {
  ...model,
  async diagnose(request) {
    const result = await model.diagnose(request);
    return { ...result, findings: result.findings.map((finding) => ({ ...finding, nodeId: randomUUID() })) };
  },
};
await assert.rejects(new GrantModelDataGateway(invalidModel).diagnose({
  documentId: aggregate.document.documentId,
  taskId: randomUUID(),
  snapshot: aggregate.currentRevision.snapshot,
  inputMode: "full_document",
  inputSectionIds: [sectionId],
  inputNodeIds: [nodeId],
}), /未授权或不存在/);

const compositionSource = await readFile(new URL("../lib/grants/server/composition.ts", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../components/grants/grant-diagnostics-panel.tsx", import.meta.url), "utf8");
assert.doesNotMatch(compositionSource, /DEEPSEEK|GRANT_PATCH_PROVIDER|GRANT_PATCH_MODEL/);
assert.match(compositionSource, /GrantSemanticDiagnosticChecker/);
assert.match(panelSource, /AI诊断/);
assert.match(panelSource, /GPT 语义诊断未完成/);

console.log("Grant GPT semantic diagnostic contracts passed.");
