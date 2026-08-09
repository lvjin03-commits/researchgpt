import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { importGrantDocx, GrantDocxImportError } from "../lib/grants/imports/docx-importer.ts";
import { CanonicalGrantSnapshotSchema } from "../lib/grants/domain/contracts.ts";
import { projectGrantSectionSubtree, projectGrantSectionTree } from "../lib/grants/presentation/document-tree.ts";
import { createGrantOriginalObjectPath } from "../lib/grants/infrastructure/supabase/grant-import-object-path.ts";
import { SupabaseGrantImportStorage } from "../lib/grants/infrastructure/supabase/supabase-grant-import-storage.ts";
import { GrantImportStorageError } from "../lib/grants/ports/grant-import-storage.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const ownerId = "6433882a-ac04-4710-9839-45cd529291d8";
const importId = "e0a4935c-c803-475d-9def-45a9ebb95bdc";
const objectPath = createGrantOriginalObjectPath(ownerId, importId);
assert.equal(objectPath, `${ownerId}/grant-imports/${importId}/original.docx`);
assert.match(objectPath, /^[A-Za-z0-9/_\-.]+$/);
assert.ok(!objectPath.includes("季铵盐"));
assert.throws(
  () => createGrantOriginalObjectPath("用户", importId),
  (error: unknown) => error instanceof GrantImportStorageError
    && error.code === "grant_storage_key_contract_invalid",
);

let uploadedPath = "";
let uploadedMetadata: Record<string, unknown> | undefined;
const storageClient = {
  storage: {
    from(bucket: string) {
      assert.equal(bucket, "chat-attachments");
      return {
        async upload(path: string, _buffer: Buffer, options: { metadata?: Record<string, unknown> }) {
          uploadedPath = path;
          uploadedMetadata = options.metadata;
          return { error: null };
        },
      };
    },
  },
} as unknown as SupabaseClient;
const storage = new SupabaseGrantImportStorage(storageClient);
const stored = await storage.storeOriginal({
  ownerId,
  buffer: Buffer.from("docx-fixture"),
  checksum: "a".repeat(64),
});
assert.equal(stored.path, uploadedPath);
assert.match(uploadedPath, new RegExp(`^${ownerId}/grant-imports/[a-f0-9-]+/original\\.docx$`));
assert.ok(!uploadedPath.includes("季铵盐"));
assert.deepEqual(uploadedMetadata, {
  checksum: "a".repeat(64),
  source: "grant-docx-import",
});

const directory = await mkdtemp(join(tmpdir(), "researchgpt-grant-import-"));
try {
  const doc = new Document({
    sections: [{
      headers: { default: new Header({ children: [new Paragraph("2027 国自然申请书") ] }) },
      footers: { default: new Footer({ children: [new Paragraph("第 1 页") ] }) },
      children: [
        new Paragraph({ text: "1 立项依据", heading: HeadingLevel.HEADING_1 }),
        new Paragraph("本项目研究动态网络的结构与性能关系。"),
        new Paragraph({ text: "1.1 研究背景", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "已有研究基础", bullet: { level: 0 } }),
        new Paragraph({ text: "尚待解决的问题", bullet: { level: 0 } }),
        new Table({ rows: [
          new TableRow({ children: [new TableCell({ children: [new Paragraph("变量")] }), new TableCell({ children: [new Paragraph("作用")] })] }),
          new TableRow({ children: [new TableCell({ children: [new Paragraph("温度")] }), new TableCell({ children: [new Paragraph("调节动力学")] })] }),
        ] }),
        new Paragraph({ children: [new TextRun("结论性说明。") ] }),
      ],
    }],
  });
  const buffer = Buffer.from(await Packer.toBuffer(doc));
  if (process.env.GRANT_IMPORT_FIXTURE_PATH) await writeFile(process.env.GRANT_IMPORT_FIXTURE_PATH, buffer);
  const preview = await importGrantDocx({ fileName: "国自然初稿.docx", buffer });
  assert.equal(preview.draft.title, "国自然初稿");
  assert.equal(preview.summary.sectionCount, 2);
  assert.ok(preview.summary.paragraphCount >= 2);
  assert.equal(preview.summary.listCount, 1);
  assert.equal(preview.summary.tableCount, 1);
  assert.ok(preview.warnings.some((warning) => warning.code === "header_not_editable"));
  assert.ok(preview.warnings.some((warning) => warning.code === "footer_not_editable"));
  assert.equal(preview.draft.sections[1]?.parentLocalKey, preview.draft.sections[0]?.localKey);

  const realisticDoc = new Document({
    sections: [{
      children: [
        new Paragraph("申请代码 E0208"),
        new Paragraph("报告正文（2026版）"),
        new Paragraph("（一）立项依据"),
        new Paragraph("本部分导语应归属于一级章节。"),
        new Paragraph("1.1 研究意义"),
        new Paragraph("研究意义正文。"),
        new Paragraph("1.2 国内外研究现状分析"),
        new Paragraph("研究现状正文。"),
        new Paragraph("参考文献"),
        new Paragraph("[1] 真实文献。"),
        new Paragraph("（二）研究内容"),
        new Paragraph("2.1 研究目标"),
        new Paragraph("2.3.1 研究方案一"),
        new Paragraph("方案正文。"),
        new Paragraph("附件信息"),
        new Paragraph("（一）申请人诚信承诺"),
        new Paragraph("1.1 此处不是正文标题"),
      ],
    }],
  });
  const realisticBuffer = Buffer.from(await Packer.toBuffer(realisticDoc));
  const realisticPreview = await importGrantDocx({ fileName: "真实国自然模板.docx", buffer: realisticBuffer });
  assert.deepEqual(realisticPreview.draft.sections.map((section) => section.title), [
    "（一）立项依据",
    "1.1 研究意义",
    "1.2 国内外研究现状分析",
    "参考文献",
    "（二）研究内容",
    "2.1 研究目标",
    "2.3.1 研究方案一",
  ]);
  assert.equal(realisticPreview.draft.sections[1]?.parentLocalKey, realisticPreview.draft.sections[0]?.localKey);
  assert.equal(realisticPreview.draft.sections[6]?.parentLocalKey, realisticPreview.draft.sections[5]?.localKey);
  assert.ok(!realisticPreview.draft.sections.some((section) => section.title.includes("诚信承诺")));
  assert.equal(realisticPreview.draft.sections[0]?.nodes[0]?.nodeType, "paragraph");

  const rootId = "00000000-0000-4000-8000-000000000001";
  const childOneId = "00000000-0000-4000-8000-000000000002";
  const childTwoId = "00000000-0000-4000-8000-000000000003";
  const grandchildId = "00000000-0000-4000-8000-000000000004";
  const projectionSnapshot = CanonicalGrantSnapshotSchema.parse({
    schemaVersion: "grant-canonical-v1",
    title: "结构投影测试",
    sections: [
      { sectionId: childTwoId, semanticRole: "custom", title: "1.2", parentSectionId: rootId, order: 1, nodeIds: [] },
      { sectionId: grandchildId, semanticRole: "custom", title: "1.1.1", parentSectionId: childOneId, order: 0, nodeIds: [] },
      { sectionId: rootId, semanticRole: "custom", title: "（一）", order: 0, nodeIds: [] },
      { sectionId: childOneId, semanticRole: "custom", title: "1.1", parentSectionId: rootId, order: 0, nodeIds: [] },
    ],
    nodes: [],
  });
  assert.deepEqual(projectGrantSectionTree(projectionSnapshot).map(({ section, depth }) => [section.title, depth]), [
    ["（一）", 0], ["1.1", 1], ["1.1.1", 2], ["1.2", 1],
  ]);
  assert.deepEqual(projectGrantSectionSubtree(projectionSnapshot, childOneId).map(({ section, depth }) => [section.title, depth]), [
    ["1.1", 0], ["1.1.1", 1],
  ]);

  if (process.env.GRANT_REAL_DOCX_PATH) {
    const realBuffer = await readFile(process.env.GRANT_REAL_DOCX_PATH);
    const realPreview = await importGrantDocx({
      fileName: process.env.GRANT_REAL_DOCX_PATH.split(/[\\/]/).pop() ?? "real-grant.docx",
      buffer: realBuffer,
    });
    assert.ok(realPreview.draft.sections.length > 3, "Real NSFC draft should expose a section hierarchy.");
    assert.ok(realPreview.draft.sections.some((section) => section.parentLocalKey), "Real NSFC draft should include child sections.");
    assert.ok(!realPreview.draft.sections.some((section) => section.title.includes("诚信承诺")));
    console.log(JSON.stringify({
      realImport: true,
      summary: realPreview.summary,
      sectionTitles: realPreview.draft.sections.map((section) => section.title),
    }, null, 2));
  }

  await assert.rejects(
    importGrantDocx({ fileName: "危险宏.docm", buffer }),
    (error: unknown) => error instanceof GrantDocxImportError && error.code === "unsupported_file",
  );
  await assert.rejects(
    importGrantDocx({ fileName: "损坏.docx", buffer: Buffer.from("not a zip") }),
    (error: unknown) => error instanceof GrantDocxImportError && error.code === "invalid_file",
  );
  console.log(JSON.stringify({
    ok: true,
    fixtureDirectory: directory,
    summary: preview.summary,
    warningCodes: preview.warnings.map((warning) => warning.code),
    sectionTitles: preview.draft.sections.map((section) => section.title),
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
