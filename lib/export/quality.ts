import { ExportError } from "@/lib/export/errors";
import type { ExportFormat } from "@/lib/export/types";
import AdmZip from "adm-zip";

export type ExportQualityIssue = {
  code: string;
  message: string;
};

export type ExportQualityReport = {
  passed: boolean;
  issues: ExportQualityIssue[];
};

const ZIP_FORMATS = new Set<ExportFormat>(["docx", "pptx", "xlsx"]);

function startsWith(buffer: Buffer, signature: string): boolean {
  return buffer.subarray(0, signature.length).toString("latin1") === signature;
}

function includesText(buffer: Buffer, text: string): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 2048)).toString("utf8").includes(text);
}

function extractOfficeXmlText(buffer: Buffer, entryName: string): string {
  try {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry(entryName);
    return entry?.getData().toString("utf8") ?? "";
  } catch {
    return "";
  }
}

function inspectDocxContent(buffer: Buffer, issues: ExportQualityIssue[]): void {
  const documentXml = extractOfficeXmlText(buffer, "word/document.xml");
  if (!documentXml) {
    issues.push({
      code: "missing_docx_document_xml",
      message: "Generated Word file is missing its main document content.",
    });
    return;
  }

  const text = documentXml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    /generate\s+file|copy\s+and\s+paste|select\s+.+format|download\s+link/i.test(
      text,
    ) ||
    /生成文件|复制.*粘贴|选择.*格式|下载链接/.test(text)
  ) {
    issues.push({
      code: "docx_instruction_pollution",
      message:
        "Generated Word content still contains export instructions instead of document body.",
    });
  }

  if (/\|\s*-{3,}\s*\||```/.test(text)) {
    issues.push({
      code: "docx_markdown_residue",
      message:
        "Generated Word content still contains raw Markdown residue.",
    });
  }
}

export function inspectExportBuffer(
  format: ExportFormat,
  buffer: Buffer,
): ExportQualityReport {
  const issues: ExportQualityIssue[] = [];

  if (buffer.length === 0) {
    issues.push({ code: "empty_file", message: "生成文件为空。" });
    return { passed: false, issues };
  }

  if (ZIP_FORMATS.has(format) && !startsWith(buffer, "PK")) {
    issues.push({
      code: "invalid_office_package",
      message: "生成的 Office 文件结构无效，打开时可能损坏。",
    });
  }

  if (format === "docx" && startsWith(buffer, "PK")) {
    inspectDocxContent(buffer, issues);
  }

  if (format === "pdf" && !startsWith(buffer, "%PDF")) {
    issues.push({
      code: "invalid_pdf",
      message: "生成的 PDF 文件结构无效，打开时可能乱码或损坏。",
    });
  }

  if (format === "png") {
    const pngSignature = buffer.subarray(0, 8).toString("hex");
    if (pngSignature !== "89504e470d0a1a0a") {
      issues.push({
        code: "invalid_png",
        message: "生成的 PNG 文件结构无效。",
      });
    }
  }

  if (format === "svg" && !includesText(buffer, "<svg")) {
    issues.push({
      code: "invalid_svg",
      message: "生成的 SVG 文件结构无效。",
    });
  }

  if ((format === "txt" || format === "md" || format === "json") && buffer.length < 4) {
    issues.push({
      code: "too_short",
      message: "生成的文本内容过短，可能没有成功输出。",
    });
  }

  return { passed: issues.length === 0, issues };
}

export function assertExportQuality(
  format: ExportFormat,
  buffer: Buffer,
): void {
  const report = inspectExportBuffer(format, buffer);
  if (report.passed) return;
  throw new ExportError(
    `文件质量检查失败：${report.issues.map((issue) => issue.message).join("；")}`,
    500,
  );
}
