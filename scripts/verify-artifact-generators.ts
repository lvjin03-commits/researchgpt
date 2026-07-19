import JSZip from "jszip";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateExportBuffer } from "@/lib/export/generators/generate-buffer";
import type { ExportFormat } from "@/lib/export/types";

const title = "锂离子电池工艺风险分析";
const content = `# 锂离子电池工艺风险分析

自动装配工序需要同时控制洁净度、定位精度和设备稳定性。

## 核心结论

- 残液主要来自注液参数、擦拭机构和环境控制。
- 应优先验证可量化的过程窗口。

## 风险矩阵

| 风险来源 | 影响 | 建议措施 |
|---|---|---|
| 注液参数 | 残液波动 | 建立参数窗口 |
| 擦拭机构 | 清洁不稳定 | 校准压力与轨迹 |
`;

const formats: ExportFormat[] = [
  "docx",
  "xlsx",
  "pptx",
  "pdf",
  "svg",
  "png",
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  for (const format of formats) {
    const buffer = await generateExportBuffer(format, {
      title,
      content,
      metadata: { verification: true },
    });
    assert(buffer.length > 500, `${format} output is unexpectedly small`);

    if (format === "docx" || format === "xlsx" || format === "pptx") {
      const archive = await JSZip.loadAsync(buffer);
      const required =
        format === "docx"
          ? "word/document.xml"
          : format === "xlsx"
            ? "xl/workbook.xml"
            : "ppt/presentation.xml";
      assert(archive.file(required), `${format} is missing ${required}`);
    }

    if (format === "pdf") {
      assert(buffer.subarray(0, 4).toString("ascii") === "%PDF", "invalid PDF");
    }
    if (format === "png") {
      assert(
        buffer.subarray(1, 4).toString("ascii") === "PNG",
        "invalid PNG signature",
      );
    }
    if (format === "svg") {
      assert(buffer.toString("utf8").includes("<svg"), "invalid SVG");
    }
    if (format === "png") {
      await fs.writeFile(
        path.join(os.tmpdir(), "researchgpt-artifact-verification.png"),
        buffer,
      );
    }

    console.log(`${format}: ${buffer.length.toLocaleString()} bytes`);
  }
}

void main();
