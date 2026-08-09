import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { GrantDiagnosticService } from "../lib/grants/application/diagnostic-service.ts";
import { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { GrantStructuralCompletenessChecker } from "../lib/grants/diagnostics/structural-completeness-checker.ts";
import { InMemoryGrantDiagnosticRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-diagnostic-repository.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";
import { DeterministicGrantDocxRenderer } from "../lib/grants/infrastructure/documents/deterministic-grant-docx-renderer.ts";

function sequentialIds() {
  let value = 0;
  return () => `82000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

const createId = sequentialIds();
const actorId = "82000000-0000-4000-8000-000000000999";
const revisionRepository = new InMemoryGrantRevisionRepository();
const revisions = new GrantRevisionService({ repository: revisionRepository, createId, now: () => "2026-08-09T12:00:00.000Z" });
const created = await revisions.createDocument({
  ownerId: actorId,
  actorId,
  draft: {
    title: "国家自然科学基金申请书",
    sections: [
      {
        localKey: "basis",
        semanticRole: "project_basis",
        title: "1 立项依据",
        order: 0,
        nodes: [{ localKey: "basis-body", nodeType: "paragraph", content: { text: "待补充" } }],
      },
      {
        localKey: "content",
        semanticRole: "research_content",
        title: "2 研究内容",
        order: 1,
        nodes: [
          { localKey: "content-body", nodeType: "paragraph", content: { text: "围绕关键科学问题建立可验证的研究方案。" } },
          { localKey: "steps", nodeType: "list", content: { ordered: true, items: ["建立实验体系", "验证关键机制"] } },
          { localKey: "matrix", nodeType: "table", content: { rows: [["研究任务", "预期结果"], ["机制验证", "形成证据链"]] } },
        ],
      },
      {
        localKey: "innovation",
        semanticRole: "innovation",
        title: "3 创新点",
        order: 2,
        nodes: [],
      },
    ],
  },
  template: { templateKey: "nsfc", templateVersion: "1", rules: { language: "zh", pageSize: "A4" } },
});

const diagnosticRepository = new InMemoryGrantDiagnosticRepository();
const diagnostics = new GrantDiagnosticService({
  revisionService: revisions,
  repository: diagnosticRepository,
  checkers: [new GrantStructuralCompletenessChecker()],
  createId,
  incrementalEnabled: true,
  now: () => "2026-08-09T12:00:01.000Z",
});

const baseline = await diagnostics.run(created.document.documentId, actorId);
assert.equal(baseline.runs[0]?.inputMode, "full_document");
assert.equal(baseline.findings.some((finding) => finding.code === "placeholder_content"), true);

const fixedSnapshot = structuredClone(created.currentRevision.snapshot);
const target = fixedSnapshot.nodes.find((node) => node.nodeType === "paragraph" && node.content.text === "待补充");
assert(target && target.nodeType === "paragraph");
target.content.text = "本项目针对跨尺度结构调控缺乏可验证机制的问题，提出分层实验与模型联合验证方案。";
const committed = await revisions.commitRevision({
  documentId: created.document.documentId,
  expectedRevisionId: created.currentRevision.revisionId,
  actorId,
  actorKind: "user",
  snapshot: fixedSnapshot,
  reason: "verify_incremental_recheck",
});

const rechecked = await diagnostics.run(created.document.documentId, actorId, { incremental: true });
assert.equal(rechecked.runs[0]?.inputMode, "section_bundle");
assert.equal(rechecked.recheck.checkedSectionCount, 1);
assert.equal(rechecked.recheck.state, "resolved");
assert.equal(rechecked.recheck.resolvedCount, 1);
const reused = await diagnostics.run(created.document.documentId, actorId, { incremental: true });
assert.equal(reused.recheck.reusedExecution, true);
const currentProjection = await diagnostics.list(created.document.documentId);
assert.equal(currentProjection.findings.length, 1);
assert.equal(currentProjection.findings[0]?.finding.code, "empty_section");

const renderer = new DeterministicGrantDocxRenderer();
const artifact = await renderer.render({
  documentId: created.document.documentId,
  revisionId: committed.currentRevision.revisionId,
  snapshot: committed.currentRevision.snapshot,
  templateSnapshot: committed.templateSnapshot,
});
assert.equal(artifact.buffer.subarray(0, 2).toString(), "PK");
assert.equal(artifact.warnings.length, 0);
assert.match(artifact.fileName, /\.docx$/);
const archive = new AdmZip(artifact.buffer);
const documentXml = archive.readAsText("word/document.xml");
const stylesXml = archive.readAsText("word/styles.xml");
const numberingXml = archive.readAsText("word/numbering.xml");
assert.match(documentXml, /国家自然科学基金申请书/);
assert.match(documentXml, /形成证据链/);
assert.match(documentXml, /<w:tblGrid>/);
assert.match(documentXml, /<w:tblInd w:type="dxa" w:w="120"/);
assert.match(documentXml, /<w:tcW w:type="dxa"/);
assert.doesNotMatch(documentXml, /82000000-0000-4000/);
assert.match(stylesXml, /GrantHeading1/);
assert.match(stylesXml, /GrantBody/);
assert.match(numberingXml, /%1\./);

const outputIndex = process.argv.indexOf("--out");
if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
  await writeFile(path.resolve(process.argv[outputIndex + 1]!), artifact.buffer);
}

const migration = await readFile(new URL("../supabase/migrations/042_grant_incremental_recheck.sql", import.meta.url), "utf8");
assert.match(migration, /list_grant_diagnostic_runs/);
assert.doesNotMatch(migration, /GRANT EXECUTE .* authenticated/);

console.log("Grant PR8 incremental recheck and DOCX export contracts passed.");
