import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  grantFindingTarget,
  indexGrantFindingsByNode,
  type GrantDiagnosticItem,
} from "../components/grants/grant-diagnostic-view-model.ts";
import { GrantFeedbackService } from "../lib/grants/application/feedback-service.ts";
import type { GrantFinding } from "../lib/grants/diagnostics/contracts.ts";
import { InMemoryGrantFeedbackRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-feedback-repository.ts";

const documentId = "81000000-0000-4000-8000-000000000001";
const findingId = "81000000-0000-4000-8000-000000000002";
const nodeId = "81000000-0000-4000-8000-000000000003";
const revisionId = "81000000-0000-4000-8000-000000000004";
const actorId = "81000000-0000-4000-8000-000000000005";

const finding: GrantFinding = {
  findingId,
  runId: "81000000-0000-4000-8000-000000000006",
  documentId,
  sourceRevisionId: revisionId,
  checkerId: "grant.structural_completeness",
  checkerVersion: "1.0.0",
  fingerprint: "a".repeat(64),
  code: "placeholder_content",
  message: "该段仍含占位内容。",
  recommendation: "补充与本项目直接相关的成熟论述。",
  assessment: { scope: "paragraph", confidence: 1, actionability: "directly_actionable" },
  sourceAnchor: {
    sourceRevisionId: revisionId,
    locationStatus: "located",
    sectionId: "81000000-0000-4000-8000-000000000007",
    nodeId,
    nodeType: "paragraph",
    sectionRole: "background",
    heading: "研究背景",
    text: "请输入正文",
    textHash: "b".repeat(64),
    previousText: "",
    nextText: "",
    startOffset: 0,
    endOffset: 5,
  },
  lifecycleStatus: "open",
  createdAt: "2026-08-07T22:00:00.000Z",
};

const exact: GrantDiagnosticItem = {
  finding,
  resolution: {
    status: "exact",
    targetRevisionId: revisionId,
    targetNodeId: nodeId,
    score: 1,
    margin: 1,
    candidates: [{ nodeId, score: 1 }],
    reason: "Stable node identity and text match.",
  },
};
assert.deepEqual(grantFindingTarget(exact), {
  findingId,
  sectionId: finding.sourceAnchor.sectionId,
  nodeId,
  navigable: true,
});
assert.deepEqual(indexGrantFindingsByNode([exact]).get(nodeId), [findingId]);

const unlocated: GrantDiagnosticItem = {
  finding: { ...finding, findingId: "81000000-0000-4000-8000-000000000008" },
  resolution: {
    status: "unable_to_match",
    targetRevisionId: revisionId,
    score: 0,
    margin: 0,
    candidates: [],
    reason: "No safe source match.",
  },
};
assert.equal(grantFindingTarget(unlocated).navigable, false);
assert.equal(indexGrantFindingsByNode([unlocated]).size, 0);

const feedbackService = new GrantFeedbackService(new InMemoryGrantFeedbackRepository());
const recorded = await feedbackService.setDisposition({ documentId, findingId, disposition: "deferred", actorId });
assert.equal(recorded.disposition, "deferred");
assert.equal((await feedbackService.list(documentId))[0]?.findingId, findingId);
assert.equal(finding.lifecycleStatus, "open", "User feedback must not rewrite the Finding conclusion or lifecycle.");

const panelSource = await readFile(new URL("../components/grants/grant-diagnostics-panel.tsx", import.meta.url), "utf8");
assert.match(panelSource, /建议默认收起/);
assert.match(panelSource, /isExpanded\s*&&/);
assert.doesNotMatch(panelSource, /严重性|高风险|中风险|低风险/);

const migration = await readFile(new URL("../supabase/migrations/038_grant_finding_feedback.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.grant_finding_feedback/);
assert.match(migration, /JOIN public\.grant_documents/);
assert.doesNotMatch(migration, /GRANT EXECUTE .* authenticated/);

console.log("Grant three-pane workspace contracts passed.");
