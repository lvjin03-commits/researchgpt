import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GrantDiagnosticService, grantFindingReviewState } from "../lib/grants/application/diagnostic-service.ts";
import { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { createGrantSourceAnchor, resolveGrantSourceAnchor } from "../lib/grants/diagnostics/anchors.ts";
import type { GrantChecker } from "../lib/grants/diagnostics/checker.ts";
import { GrantStructuralCompletenessChecker } from "../lib/grants/diagnostics/structural-completeness-checker.ts";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import { InMemoryGrantDiagnosticRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-diagnostic-repository.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";

function sequentialIds() {
  let value = 0;
  return () => `40000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

const ownerId = "50000000-0000-4000-8000-000000000001";
const createId = sequentialIds();
const revisionRepository = new InMemoryGrantRevisionRepository();
const revisionService = new GrantRevisionService({ repository: revisionRepository, createId, now: () => "2026-08-07T18:00:00.000Z" });
const created = await revisionService.createDocument({
  ownerId,
  actorId: ownerId,
  draft: {
    title: "Grant diagnostic verification",
    sections: [
      { localKey: "basis", semanticRole: "background", title: "研究背景", order: 0, nodes: [{ localKey: "placeholder", nodeType: "paragraph", content: { text: "待补充" } }] },
      { localKey: "question", semanticRole: "scientific_question", title: "科学问题", order: 1, nodes: [] },
    ],
  },
  template: { templateKey: "nsfc", templateVersion: "1", rules: {} },
});

const opposingChecker: GrantChecker = {
  checkerId: "test.opposing_checker",
  checkerVersion: "1.0.0",
  contractVersion: "grant-checker-v1",
  inputMode: "full_document",
  async check(input) {
    const node = input.snapshot.nodes[0]!;
    return { findings: [{
      code: "content_is_complete",
      message: "Synthetic opposing conclusion for conflict retention.",
      recommendation: "Retain both conclusions for review.",
      assessment: { scope: "paragraph", confidence: 0.5, actionability: "requires_expert_judgment" },
      subjectKey: `node:${node.nodeId}:content_maturity`,
      conclusion: "complete",
      sectionId: node.sectionId,
      nodeId: node.nodeId,
    }] };
  },
};

const diagnosticRepository = new InMemoryGrantDiagnosticRepository();
const service = new GrantDiagnosticService({
  revisionService,
  repository: diagnosticRepository,
  checkers: [new GrantStructuralCompletenessChecker(), opposingChecker],
  createId,
  now: () => "2026-08-07T18:00:01.000Z",
});
const execution = await service.run(created.document.documentId, ownerId);
assert.equal(execution.runs.length, 2);
assert.equal(execution.runs.every((run) => run.status === "succeeded"), true);
assert.equal(execution.findings.length, 3);
const placeholder = execution.findings.find((finding) => finding.code === "placeholder_content")!;
const emptySection = execution.findings.find((finding) => finding.code === "empty_section")!;
assert.equal(placeholder.sourceAnchor.locationStatus, "located");
assert.equal(emptySection.sourceAnchor.locationStatus, "unlocated");
assert.match(emptySection.sourceAnchor.unlocatedReason ?? "", /section without a source node/i);
assert.equal(execution.conflicts.length, 1);
assert.equal(new Set(execution.conflicts[0]!.findingIds).size, 2);

const listed = await service.list(created.document.documentId);
assert.equal(listed.findings.length, 3);
assert.equal(listed.findings.find((item) => item.finding.findingId === placeholder.findingId)?.resolution.status, "exact");
assert.equal(listed.findings.find((item) => item.finding.findingId === placeholder.findingId)?.reviewState, "current");

const sourceRevisionId = created.currentRevision.revisionId;
const sourceSnapshot = created.currentRevision.snapshot;
const sourceNode = sourceSnapshot.nodes[0]!;
const anchor = createGrantSourceAnchor({ snapshot: sourceSnapshot, sourceRevisionId, nodeId: sourceNode.nodeId });
const makeSnapshot = (options: { text: string; sectionRole?: string; heading?: string; nodeId?: string; nodeType?: "paragraph" | "table" }): CanonicalGrantSnapshot => {
  const sectionId = "60000000-0000-4000-8000-000000000001";
  const nodeId = options.nodeId ?? sourceNode.nodeId;
  const node = options.nodeType === "table"
    ? { nodeId, sectionId, order: 0, nodeType: "table" as const, content: { rows: [[options.text]] } }
    : { nodeId, sectionId, order: 0, nodeType: "paragraph" as const, content: { text: options.text } };
  return { schemaVersion: "grant-canonical-v1", title: "Anchor target", sections: [{ sectionId, semanticRole: options.sectionRole ?? "background", title: options.heading ?? "研究背景", order: 0, nodeIds: [nodeId] }], nodes: [node] };
};

const targetRevisionId = "60000000-0000-4000-8000-000000000010";
assert.equal(resolveGrantSourceAnchor(anchor, targetRevisionId, makeSnapshot({ text: anchor.text })).status, "exact");
assert.equal(grantFindingReviewState({ sourceRevisionId }, targetRevisionId, resolveGrantSourceAnchor(anchor, targetRevisionId, makeSnapshot({ text: anchor.text }))), "needs_recheck");
assert.equal(grantFindingReviewState({ sourceRevisionId }, targetRevisionId, resolveGrantSourceAnchor(anchor, targetRevisionId, makeSnapshot({ text: "changed beyond reliable matching" }))), "stale");
assert.equal(resolveGrantSourceAnchor(anchor, targetRevisionId, makeSnapshot({ text: anchor.text, nodeId: "60000000-0000-4000-8000-000000000011" })).status, "relocated");
assert.notEqual(resolveGrantSourceAnchor(anchor, targetRevisionId, makeSnapshot({ text: anchor.text, sectionRole: "scientific_question", heading: "关键科学问题" })).status, "exact");
assert.notEqual(resolveGrantSourceAnchor(anchor, targetRevisionId, makeSnapshot({ text: "替换后的不同表述" })).status, "relocated");
assert.notEqual(resolveGrantSourceAnchor(anchor, targetRevisionId, makeSnapshot({ text: anchor.text, nodeType: "table" })).status, "relocated");

const driftSectionId = "70000000-0000-4000-8000-000000000001";
const driftNodeId = "70000000-0000-4000-8000-000000000002";
const driftText = "现有研究尚未解释不同时间尺度之间的因果传递。";
const driftPrevious = "复杂生命过程由多尺度信号共同调控。";
const driftNext = "本项目拟建立可验证的跨尺度关联框架。";
const driftSource: CanonicalGrantSnapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "Anchor drift",
  sections: [{ sectionId: driftSectionId, semanticRole: "background", title: "1.1 研究背景", order: 0, nodeIds: [
    "70000000-0000-4000-8000-000000000003", driftNodeId, "70000000-0000-4000-8000-000000000004",
  ] }],
  nodes: [
    { nodeId: "70000000-0000-4000-8000-000000000003", sectionId: driftSectionId, order: 0, nodeType: "paragraph", content: { text: driftPrevious } },
    { nodeId: driftNodeId, sectionId: driftSectionId, order: 1, nodeType: "paragraph", content: { text: driftText } },
    { nodeId: "70000000-0000-4000-8000-000000000004", sectionId: driftSectionId, order: 2, nodeType: "paragraph", content: { text: driftNext } },
  ],
};
const driftAnchor = createGrantSourceAnchor({ snapshot: driftSource, sourceRevisionId, nodeId: driftNodeId });
const driftSnapshot = (input: { text: string; heading?: string; role?: string; nodeType?: "paragraph" | "table"; previous?: string; next?: string; addNoise?: boolean }): CanonicalGrantSnapshot => {
  const sectionId = "71000000-0000-4000-8000-000000000001";
  const targetId = "71000000-0000-4000-8000-000000000002";
  const previousId = "71000000-0000-4000-8000-000000000003";
  const nextId = "71000000-0000-4000-8000-000000000004";
  const noiseId = "71000000-0000-4000-8000-000000000005";
  const nodeIds = [previousId, ...(input.addNoise ? [noiseId] : []), targetId, nextId];
  const nodes: CanonicalGrantSnapshot["nodes"] = [
    { nodeId: previousId, sectionId, order: 0, nodeType: "paragraph", content: { text: input.previous ?? driftPrevious } },
    ...(input.addNoise ? [{ nodeId: noiseId, sectionId, order: 1, nodeType: "paragraph" as const, content: { text: "现有研究已经形成统一评价框架。" } }] : []),
    input.nodeType === "table"
      ? { nodeId: targetId, sectionId, order: input.addNoise ? 2 : 1, nodeType: "table" as const, content: { rows: [[input.text]] } }
      : { nodeId: targetId, sectionId, order: input.addNoise ? 2 : 1, nodeType: "paragraph" as const, content: { text: input.text } },
    { nodeId: nextId, sectionId, order: input.addNoise ? 3 : 2, nodeType: "paragraph", content: { text: input.next ?? driftNext } },
  ];
  return { schemaVersion: "grant-canonical-v1", title: "Drift target", sections: [{ sectionId, semanticRole: input.role ?? "background", title: input.heading ?? "1.1 研究背景", order: 0, nodeIds }], nodes };
};

const driftCases = {
  insert_unrelated: resolveGrantSourceAnchor(driftAnchor, targetRevisionId, driftSnapshot({ text: driftText, addNoise: true })).status,
  delete_unrelated: resolveGrantSourceAnchor(driftAnchor, targetRevisionId, driftSnapshot({ text: driftText })).status,
  split_paragraph: resolveGrantSourceAnchor(driftAnchor, targetRevisionId, driftSnapshot({ text: "现有研究尚未解释不同时间尺度之间", next: "的因果传递。" })).status,
  merge_paragraph: resolveGrantSourceAnchor(driftAnchor, targetRevisionId, driftSnapshot({ text: driftPrevious + driftText + driftNext, previous: "", next: "" })).status,
  move_section: resolveGrantSourceAnchor(driftAnchor, targetRevisionId, driftSnapshot({ text: driftText, heading: "3.2 关键科学问题", role: "scientific_question" })).status,
  rename_heading: resolveGrantSourceAnchor(driftAnchor, targetRevisionId, driftSnapshot({ text: driftText, heading: "1.1 研究基础与问题" })).status,
  paraphrase: resolveGrantSourceAnchor(driftAnchor, targetRevisionId, driftSnapshot({ text: "不同观测尺度间的因果链条仍缺乏机制解释。" })).status,
  table_change: resolveGrantSourceAnchor(driftAnchor, targetRevisionId, driftSnapshot({ text: driftText, nodeType: "table" })).status,
};
assert.equal(driftCases.insert_unrelated, "relocated");
assert.equal(driftCases.delete_unrelated, "relocated");
assert.notEqual(driftCases.split_paragraph, "relocated");
assert.notEqual(driftCases.merge_paragraph, "relocated");
assert.notEqual(driftCases.move_section, "relocated");
assert.equal(driftCases.rename_heading, "relocated");
assert.notEqual(driftCases.paraphrase, "relocated");
assert.notEqual(driftCases.table_change, "relocated");

const migration = await readFile(new URL("../supabase/migrations/036_grant_diagnostics.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.grant_diagnostic_runs/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.grant_findings/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.grant_diagnostic_conflicts/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.save_grant_diagnostic_execution/);
assert.doesNotMatch(migration, /GRANT EXECUTE .* authenticated/);

console.log("Grant diagnostic contracts passed.");
