import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  grantFindingTarget,
  indexGrantFindingsByNode,
  type GrantDiagnosticItem,
} from "../components/grants/grant-diagnostic-view-model.ts";
import { GrantFeedbackService } from "../lib/grants/application/feedback-service.ts";
import type { GrantFinding } from "../lib/grants/diagnostics/contracts.ts";
import { normalizeGrantFindingV2 } from "../lib/grants/diagnostics/normalized-finding.ts";
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
  finding: normalizeGrantFindingV2(finding),
  reviewState: "current",
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
  finding: normalizeGrantFindingV2({ ...finding, findingId: "81000000-0000-4000-8000-000000000008" }),
  reviewState: "stale",
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
const editorSource = await readFile(new URL("../components/grants/grant-structured-editor.tsx", import.meta.url), "utf8");
const outlineSource = await readFile(new URL("../components/grants/grant-document-outline.tsx", import.meta.url), "utf8");
const canvasSource = await readFile(new URL("../components/grants/grant-document-canvas.tsx", import.meta.url), "utf8");
const wordToolbarSource = await readFile(new URL("../components/grants/grant-word-toolbar.tsx", import.meta.url), "utf8");
const resizableWorkspaceSource = await readFile(new URL("../components/grants/grant-resizable-workspace.tsx", import.meta.url), "utf8");
const globalStylesSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const evidenceSource = await readFile(new URL("../components/grants/grant-evidence-panel.tsx", import.meta.url), "utf8");
const aiPatchSource = await readFile(new URL("../components/grants/grant-ai-patch-panel.tsx", import.meta.url), "utf8");
const aiEditSessionSource = await readFile(new URL("../components/grants/grant-ai-edit-session-panel.tsx", import.meta.url), "utf8");
const diagnosticsRouteSource = await readFile(new URL("../app/api/grants/documents/[id]/diagnostics/route.ts", import.meta.url), "utf8");
assert.match(panelSource, /建议默认收起/);
assert.match(panelSource, /isExpanded\s*&&/);
assert.doesNotMatch(panelSource, /严重性|高风险|中风险|低风险/);
assert.match(editorSource, /GrantResizableWorkspace/);
assert.match(resizableWorkspaceSource, /role="separator"/);
assert.match(resizableWorkspaceSource, /aria-valuenow=\{Math\.round\(value\)\}/);
assert.match(resizableWorkspaceSource, /setPointerCapture/);
assert.match(resizableWorkspaceSource, /ArrowRight/);
assert.match(resizableWorkspaceSource, /--grant-panel-font-scale/);
assert.match(resizableWorkspaceSource, /xl:flex-1 xl:overflow-hidden/);
assert.match(resizableWorkspaceSource, /xl:overflow-y-auto/);
assert.match(outlineSource, /xl:h-full xl:min-h-0 xl:overflow-hidden/);
assert.match(panelSource, /xl:h-full xl:min-h-0 xl:w-full xl:flex-col xl:overflow-hidden/);
assert.match(wordToolbarSource, /xl:top-0/);
assert.match(editorSource, /xl:flex xl:h-dvh xl:flex-col xl:overflow-hidden/);
assert.match(globalStylesSource, /grid-template-columns:[\s\S]*--grant-left-panel-width[\s\S]*--grant-right-panel-width/);
assert.match(globalStylesSource, /\.grant-resizable-panel \.text-sm/);
assert.match(editorSource, />\s*\{saveStatus === "saving" \? "保存中…" : saveStatus === "offline" \? "重新保存" : "保存"\}\s*</);
assert.match(editorSource, /method: "PATCH"/);
assert.doesNotMatch(editorSource, /window\.setTimeout\(async \(\) =>[\s\S]*method: "PATCH"/);
assert.match(editorSource, /beforeunload/);
assert.match(panelSource, /whitespace-nowrap rounded-lg bg-\[#155eef\].*text-sm/);
assert.match(outlineSource, /cursor-pointer text-sm font-semibold text-slate-700/);
assert.doesNotMatch(evidenceSource, /text-\[(10|11)px\]/);
assert.doesNotMatch(aiPatchSource, /text-\[(10|11)px\]/);
for (const token of ["AI 多轮修改", "AI 修改对话", "应用到正文", "添加资料或图片", "figure-authorization", "sessionStorage", "/edit-sessions/"]) {
  assert.ok(aiEditSessionSource.includes(token), `Edit Session panel missing ${token}`);
}
assert.match(canvasSource, /min-h-\[1123px\]/);
assert.match(canvasSource, /连续编辑视图/);
assert.match(canvasSource, /projectGrantSectionSubtree/);
assert.match(wordToolbarSource, /格式由导出模板控制/);
assert.match(wordToolbarSource, /aria-label=\{label\}/);
assert.match(diagnosticsRouteSource, /executionStatus === "complete" \? 201/);
assert.match(diagnosticsRouteSource, /executionStatus === "partial" \? 207 : 502/);
assert.match(editorSource, /data\.executionStatus === "failed"/);

const migration = await readFile(new URL("../supabase/migrations/038_grant_finding_feedback.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.grant_finding_feedback/);
assert.match(migration, /JOIN public\.grant_documents/);
assert.doesNotMatch(migration, /GRANT EXECUTE .* authenticated/);

const chatPageSource = await readFile(new URL("../app/chat/page.tsx", import.meta.url), "utf8");
const chatShellSource = await readFile(new URL("../components/chat-shell.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("../components/sidebar.tsx", import.meta.url), "utf8");
assert.match(chatPageSource, /isGrantWorkspaceEnabled\(\)/);
assert.match(chatShellSource, /grantWorkspaceEnabled=\{grantWorkspaceEnabled\}/);
assert.match(sidebarSource, /grantWorkspaceEnabled\s*&&/);
assert.match(sidebarSource, /href="\/grants"/);
assert.match(sidebarSource, /国自然申请书/);

const documentListSource = await readFile(new URL("../components/grants/grant-document-list.tsx", import.meta.url), "utf8");
const previewRouteSource = await readFile(new URL("../app/api/grants/imports/preview/route.ts", import.meta.url), "utf8");
const confirmRouteSource = await readFile(new URL("../app/api/grants/imports/confirm/route.ts", import.meta.url), "utf8");
assert.match(documentListSource, /上传 Word 初稿/);
assert.match(documentListSource, /先解析并核对章节和表格，确认后才创建正式申请书/);
assert.match(documentListSource, /确认导入并开始编辑/);
assert.match(documentListSource, /确定删除申请书/);
assert.match(documentListSource, /expectedRevisionId: document\.currentRevisionId/);
assert.match(documentListSource, /aria-label=\{`删除申请书/);
assert.match(previewRouteSource, /docxImporter\.preview/);
assert.doesNotMatch(previewRouteSource, /createDocument|importDocument/);
assert.match(confirmRouteSource, /docxImporter\.confirm/);

console.log("Grant three-pane workspace contracts passed.");

const root = path.resolve(import.meta.dirname, "..");
const freeAiEditorSource = fs.readFileSync(path.join(root, "components/grants/grant-structured-editor.tsx"), "utf8");
const freeAiCanvasSource = fs.readFileSync(path.join(root, "components/grants/grant-document-canvas.tsx"), "utf8");
const freeAiPatchPanelSource = fs.readFileSync(path.join(root, "components/grants/grant-ai-patch-panel.tsx"), "utf8");
assert.match(panelSource, /xl:min-h-0 xl:flex-1 xl:max-h-none xl:overscroll-contain/);
assert.match(resizableWorkspaceSource, /xl:h-full xl:min-h-0 xl:flex-1 xl:overflow-hidden/);
assert.match(globalStylesSource, /grid-template-rows: minmax\(0, 1fr\)/);
assert.match(freeAiCanvasSource, /onNodeAiEdit/);
assert.match(freeAiCanvasSource, /textareaSelectionAnchor/);
assert.match(freeAiCanvasSource, /aria-label="用 AI 修改选中文字"/);
assert.match(freeAiCanvasSource, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
assert.match(freeAiCanvasSource, /aiEditPanel: ReactNode/);
assert.match(freeAiCanvasSource, /xl:left-\[calc\(100%\+1rem\)\]/);
assert.match(freeAiCanvasSource, />AI 修改<\/button>/);
assert.match(freeAiEditorSource, /自由 AI 修改/);
assert.match(freeAiEditorSource, /mode="free"/);
assert.match(freeAiEditorSource, /aiEditPanel=\{selectedAiNodeId/);
assert.match(freeAiEditorSource, /right=\{<GrantDiagnosticsPanel/);
assert.match(freeAiEditorSource, /canGenerate=\{saveStatus === "saved"\}/);
assert.match(freeAiEditorSource, /evidencePatchEnabled=\{evidencePatchEnabled && evidenceEnabled\}/);
assert.match(freeAiPatchPanelSource, /findingId\?: string/);
assert.match(freeAiPatchPanelSource, /findingId: props\.findingId/);
assert.match(freeAiPatchPanelSource, /在后面补充一段/);
assert.match(freeAiPatchPanelSource, /editMode/);
