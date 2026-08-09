import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
