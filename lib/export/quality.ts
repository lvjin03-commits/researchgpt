import { ExportError } from "@/lib/export/errors";
import type { ExportFormat } from "@/lib/export/types";
import { detectMojibake } from "@/lib/text/mojibake";
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

function extractOfficeXmlTexts(buffer: Buffer, entryPattern: RegExp): string {
  try {
    const zip = new AdmZip(buffer);
    return zip
      .getEntries()
      .filter((entry) => entryPattern.test(entry.entryName))
      .map((entry) => entry.getData().toString("utf8"))
      .join("\n");
  } catch {
    return "";
  }
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inspectTextForMojibake(
  text: string,
  issues: ExportQualityIssue[],
  codePrefix: string,
): void {
  const findings = detectMojibake(text);
  if (findings.length === 0) return;

  issues.push({
    code: `${codePrefix}_mojibake`,
    message: `Generated content contains mojibake-like text (${findings
      .map((finding) => finding.pattern)
      .join(", ")}).`,
  });
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

  const text = xmlToText(documentXml);
  inspectTextForMojibake(text, issues, "docx");

  if (
    /generate\s+file|copy\s+and\s+paste|select\s+.+format|download\s+link/i.test(text) ||
    /生成文件|复制.*粘贴|选择.*格式|下载链接/.test(text)
  ) {
    issues.push({
      code: "docx_instruction_pollution",
      message: "Generated Word content still contains export instructions instead of document body.",
    });
  }

  if (/\|\s*-{3,}\s*\||```/.test(text)) {
    issues.push({
      code: "docx_markdown_residue",
      message: "Generated Word content still contains raw Markdown residue.",
    });
  }
}

function inspectPptxContent(buffer: Buffer, issues: ExportQualityIssue[]): void {
  const slideXml = extractOfficeXmlTexts(buffer, /^ppt\/slides\/slide\d+\.xml$/);
  if (!slideXml) return;
  inspectTextForMojibake(xmlToText(slideXml), issues, "pptx");
}

function inspectXlsxContent(buffer: Buffer, issues: ExportQualityIssue[]): void {
  const sharedStringsXml = extractOfficeXmlText(buffer, "xl/sharedStrings.xml");
  const sheetXml = extractOfficeXmlTexts(buffer, /^xl\/worksheets\/sheet\d+\.xml$/);
  const text = xmlToText(`${sharedStringsXml}\n${sheetXml}`);
  if (!text) return;
  inspectTextForMojibake(text, issues, "xlsx");
}

export function inspectExportBuffer(
  format: ExportFormat,
  buffer: Buffer,
): ExportQualityReport {
  const issues: ExportQualityIssue[] = [];

  if (buffer.length === 0) {
    issues.push({ code: "empty_file", message: "Generated file is empty." });
    return { passed: false, issues };
  }

  if (ZIP_FORMATS.has(format) && !startsWith(buffer, "PK")) {
    issues.push({
      code: "invalid_office_package",
      message: "Generated Office file is not a valid Office package.",
    });
  }

  if (format === "docx" && startsWith(buffer, "PK")) {
    inspectDocxContent(buffer, issues);
  }

  if (format === "pptx" && startsWith(buffer, "PK")) {
    inspectPptxContent(buffer, issues);
  }

  if (format === "xlsx" && startsWith(buffer, "PK")) {
    inspectXlsxContent(buffer, issues);
  }

  if (format === "pdf" && !startsWith(buffer, "%PDF")) {
    issues.push({
      code: "invalid_pdf",
      message: "Generated PDF is not a valid PDF file.",
    });
  }

  if (format === "png") {
    const pngSignature = buffer.subarray(0, 8).toString("hex");
    if (pngSignature !== "89504e470d0a1a0a") {
      issues.push({
        code: "invalid_png",
        message: "Generated PNG is not a valid PNG file.",
      });
    }
  }

  if (format === "svg" && !includesText(buffer, "<svg")) {
    issues.push({
      code: "invalid_svg",
      message: "Generated SVG is not a valid SVG file.",
    });
  }

  if (format === "svg" || format === "txt" || format === "md" || format === "json") {
    const text = buffer.toString("utf8");
    inspectTextForMojibake(text, issues, format);

    if ((format === "txt" || format === "md" || format === "json") && text.trim().length < 4) {
      issues.push({
        code: "too_short",
        message: "Generated text content is too short.",
      });
    }
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
    `Export quality check failed: ${report.issues.map((issue) => issue.message).join("; ")}`,
    500,
  );
}
