import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { GrantDiagnosticService } from "../lib/grants/application/diagnostic-service.ts";
import { GrantModelDataGateway } from "../lib/grants/application/grant-model-data-gateway.ts";
import { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { GrantSemanticDiagnosticChecker } from "../lib/grants/application/semantic-diagnostic-checker.ts";
import { GrantStructuralCompletenessChecker } from "../lib/grants/diagnostics/structural-completeness-checker.ts";
import { InMemoryGrantDiagnosticRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-diagnostic-repository.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";
import type { GrantDiagnosticModel } from "../lib/grants/ports/grant-diagnostic-model.ts";
import {
  GRANT_DIAGNOSTIC_POLICY_VERSION,
  GRANT_DIAGNOSTIC_PROMPT_VERSION,
  GRANT_DIAGNOSTIC_SCHEMA_VERSION,
  GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION,
  GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
  GRANT_DIAGNOSTIC_V3_PROMPT_VERSION,
  GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION,
} from "../lib/grants/ports/grant-diagnostic-model.ts";
import type { GrantPatchModel } from "../lib/grants/ports/grant-patch-model.ts";

const ownerId = randomUUID();
const revisions = new GrantRevisionService({ repository: new InMemoryGrantRevisionRepository() });
const aggregate = await revisions.createDocument({
  ownerId,
  actorId: ownerId,
  draft: {
    title: "青年科学基金申请书",
    sections: [{
      localKey: "basis",
      semanticRole: "rationale",
      title: "立项依据",
      order: 0,
      nodes: [
        { localKey: "early", nodeType: "paragraph", content: { text: "本项目提出一个需要验证的科学问题。" } },
        { localKey: "late", nodeType: "paragraph", content: { text: "研究路线尚未说明如何回答该问题。" } },
      ],
    }],
  },
  template: { templateKey: "nsfc-youth", templateVersion: "1", rules: { fundingCategory: "青年科学基金项目" } },
});
const documentId = aggregate.document.documentId;
const sectionId = aggregate.currentRevision.snapshot.sections[0]!.sectionId;
const [earlyNode, lateNode] = aggregate.currentRevision.snapshot.nodes;
assert.ok(earlyNode && lateNode);

let v2Calls = 0;
let v3Calls = 0;
const model: GrantPatchModel & GrantDiagnosticModel = {
  async generate() {
    return { replacementText: "replacement", provider: "openai", modelId: "gpt-5.5", usedEvidenceCardIds: [] };
  },
  async diagnose() {
    v2Calls += 1;
    return {
      findings: [{
        category: "scientific_question_gap",
        message: "旧版语义诊断",
        recommendation: "旧版建议",
        assessment: { scope: "section", confidence: 0.8, actionability: "requires_expert_judgment" },
        sectionId,
        nodeId: earlyNode.nodeId,
      }],
      provider: "openai",
      modelId: "gpt-5.5",
      usage: { inputTokens: 10, outputTokens: 10, reasoningTokens: 0 },
      execution: {
        operation: "diagnostic.semantic",
        policyVersion: GRANT_DIAGNOSTIC_POLICY_VERSION,
        schemaVersion: GRANT_DIAGNOSTIC_SCHEMA_VERSION,
        promptVersion: GRANT_DIAGNOSTIC_PROMPT_VERSION,
        provider: "openai",
        modelId: "gpt-5.5",
        finishReason: "stop",
        attemptCount: 1,
        attemptPurpose: "initial",
        inputTokens: 10,
        outputTokens: 10,
        reasoningTokens: 0,
      },
    };
  },
  async diagnoseV3(prepared) {
    v3Calls += 1;
    assert.equal(prepared.request.fundingCategory, "青年科学基金项目");
    assert.equal(prepared.request.priorFindings.length, 1);
    return {
      findings: [
        {
          category: "objective_content_route_gap",
          title: "后文路线与问题缺少对应关系",
          diagnosticFact: "技术路线没有说明如何回答前文科学问题。",
          reason: "目标、内容与路线之间缺少可追踪的验证关系。",
          recommendation: "明确每项研究内容对应的科学问题与验证输出。",
          possibleConsequence: "评审可能追问各项实验如何共同回答核心问题。",
          assessment: { scope: "cross_section", confidence: 0.9, actionability: "directly_actionable" },
          primaryLocation: { sectionId, nodeId: lateNode.nodeId },
          relatedLocations: [{ sectionId, nodeId: earlyNode.nodeId, role: "upstream_dependency", quote: "本项目提出一个需要验证的科学问题。" }],
          usedEvidenceCardIds: [],
        },
        {
          category: "scientific_question_gap",
          title: "科学问题尚未形成可验证命题",
          diagnosticFact: "科学问题没有明确关键变量之间的预期关系。",
          reason: "当前表述难以据此判断后续实验能否证实或证伪。",
          recommendation: "补充关键变量、作用方向与可验证预期。",
          possibleConsequence: null,
          assessment: { scope: "paragraph", confidence: 0.85, actionability: "requires_expert_judgment" },
          primaryLocation: { sectionId, nodeId: earlyNode.nodeId },
          relatedLocations: [],
          usedEvidenceCardIds: [],
        },
      ],
      provider: "openai",
      modelId: "gpt-5.5",
      usage: { inputTokens: 20, outputTokens: 30, reasoningTokens: 5 },
      execution: {
        operation: "diagnostic.semantic",
        policyVersion: GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
        schemaVersion: GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION,
        promptVersion: GRANT_DIAGNOSTIC_V3_PROMPT_VERSION,
        provider: "openai",
        modelId: "gpt-5.5",
        finishReason: "stop",
        attemptCount: 1,
        attemptPurpose: "initial",
        inputTokens: 20,
        outputTokens: 30,
        reasoningTokens: 5,
      },
    };
  },
};

const repository = new InMemoryGrantDiagnosticRepository();
const persistedRunIds = new Set<string>();
const saveExecution = repository.saveExecution.bind(repository);
repository.saveExecution = async (input) => {
  for (const run of input.runs) {
    assert.equal(persistedRunIds.has(run.runId), false, `A reused diagnostic run must not be inserted again: ${run.runId}`);
  }
  const saved = await saveExecution(input);
  input.runs.forEach((run) => persistedRunIds.add(run.runId));
  return saved;
};
const saveSemanticV3Execution = repository.saveSemanticV3Execution.bind(repository);
repository.saveSemanticV3Execution = async (input) => {
  assert.equal(persistedRunIds.has(input.run.runId), false, `A reused semantic run must not be inserted again: ${input.run.runId}`);
  const saved = await saveSemanticV3Execution(input);
  persistedRunIds.add(input.run.runId);
  return saved;
};
const v2Service = new GrantDiagnosticService({
  revisionService: revisions,
  repository,
  checkers: [new GrantStructuralCompletenessChecker(), new GrantSemanticDiagnosticChecker(new GrantModelDataGateway(model), "gpt-5.5", "v2")],
  incrementalEnabled: true,
});
await v2Service.run(documentId, ownerId);
assert.equal(v2Calls, 1);

const v3Service = new GrantDiagnosticService({
  revisionService: revisions,
  repository,
  checkers: [new GrantStructuralCompletenessChecker(), new GrantSemanticDiagnosticChecker(new GrantModelDataGateway(model), "gpt-5.5", "v3")],
  incrementalEnabled: true,
});
const v3Checker = new GrantSemanticDiagnosticChecker(new GrantModelDataGateway(model), "gpt-5.5", "v3");
assert.equal(v3Checker.contractVersion, GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION);
const appliedPersistenceMigration = readFileSync(
  new URL("../supabase/migrations/046_grant_semantic_atomic_location_refs.sql", import.meta.url),
  "utf8",
);
assert.equal(
  appliedPersistenceMigration.includes(`'${v3Checker.contractVersion}'`),
  true,
  "The production Checker contract must match the applied PostgreSQL persistence contract.",
);
assert.equal(v3Checker.configurationFingerprint, new GrantSemanticDiagnosticChecker(
  new GrantModelDataGateway(model), "gpt-5.5", "v3",
).configurationFingerprint, "V3 version metadata must produce a stable configuration fingerprint.");
const execution = await v3Service.run(documentId, ownerId);
assert.equal(v2Calls, 1, "V3 rollout must not call the V2 semantic operation.");
assert.equal(v3Calls, 1);
assert.equal(execution.findings.filter((finding) => finding.checkerId === "grant-semantic-argument-diagnostic").length, 2);

const projection = await v3Service.list(documentId);
const semantic = projection.findings.filter((item) => item.finding.checkerId === "grant-semantic-argument-diagnostic");
assert.equal(semantic.length, 2, "The latest successful V3 run must supersede V2 in the active projection.");
assert.equal(semantic.every((item) => item.finding.schemaVersion === "grant-semantic-finding-v3"), true);
assert.equal(semantic[0]?.finding.sourceAnchor.nodeId, earlyNode.nodeId, "UI order must follow the canonical document, not model order or actionability.");
assert.equal(semantic[1]?.finding.reason, "目标、内容与路线之间缺少可追踪的验证关系。");
assert.equal(semantic[1]?.finding.relatedLocations[0]?.role, "upstream_dependency");
assert.equal(projection.coverage.semantic, "complete");

const allNormalized = await repository.listNormalizedFindings(documentId);
assert.equal(allNormalized.some((finding) => finding.schemaVersion === "grant-finding-v2" && finding.checkerId === "grant-semantic-argument-diagnostic"), true,
  "Historical V2 audit data must remain readable after V3 activation.");

console.log("Grant semantic diagnostic V3 rollout verification passed.");
