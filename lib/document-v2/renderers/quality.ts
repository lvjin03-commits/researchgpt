import JSZip from "jszip";
import type { FinalDocumentSpec } from "../contracts";
import type { DocumentAssemblyManifest } from "../assembly/manifest";

export type RenderQualityIssue = {
  code: string;
  message: string;
};

export type RenderQualityReport = {
  passed: boolean;
  issues: RenderQualityIssue[];
  metrics: {
    byteSize: number;
    tableCount: number;
    figureCount: number;
    captionCount: number;
    visibleTextLength: number;
  };
};

const VISIBLE_INTERNAL_TOKEN =
  /(?:\b(?:citation|evidence|reference|figure|table)-[a-f0-9]{8,}\b|\[(?:citation|evidence|reference):[^\]]+\]|<researchgpt-|```)/i;

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function visibleText(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join("");
}

function occurrences(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

export async function auditRenderedDocument(input: {
  buffer: Buffer;
  spec?: FinalDocumentSpec;
  assembly?: DocumentAssemblyManifest;
}): Promise<RenderQualityReport> {
  const issues: RenderQualityIssue[] = [];
  let documentXml = "";
  let stylesXml = "";
  try {
    const zip = await JSZip.loadAsync(input.buffer);
    const documentEntry = zip.file("word/document.xml");
    const stylesEntry = zip.file("word/styles.xml");
    if (!documentEntry) {
      issues.push({ code: "docx_document_xml_missing", message: "DOCX缺少word/document.xml。" });
    } else {
      documentXml = await documentEntry.async("string");
    }
    if (!stylesEntry) {
      issues.push({ code: "docx_styles_xml_missing", message: "DOCX缺少word/styles.xml。" });
    } else {
      stylesXml = await stylesEntry.async("string");
    }
  } catch (error) {
    issues.push({
      code: "docx_package_invalid",
      message: `DOCX包无法打开：${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const text = documentXml ? visibleText(documentXml) : "";
  const tableCount = occurrences(documentXml, /<w:tbl(?:\s|>)/g);
  const figureCount = occurrences(documentXml, /<wp:inline(?:\s|>)/g);
  const captionCount = input.spec
    ? occurrences(
        documentXml,
        new RegExp(`<w:pStyle\\s+w:val="${input.spec.templateSnapshot.typography.captionStyle}"`, "g"),
      )
    : 0;

  if (input.spec && documentXml) {
    const expectedTables = input.spec.blocks.filter((block) => block.type === "table").length;
    const expectedFigures = input.spec.blocks.filter((block) => block.type === "figure").length;
    if (tableCount !== expectedTables) {
      issues.push({
        code: "rendered_table_count_mismatch",
        message: `表格数量不一致：应为${expectedTables}，实际为${tableCount}。`,
      });
    }
    if (figureCount !== expectedFigures) {
      issues.push({
        code: "rendered_figure_count_mismatch",
        message: `图片数量不一致：应为${expectedFigures}，实际为${figureCount}。`,
      });
    }
    const expectedCaptions = expectedTables + expectedFigures;
    if (captionCount !== expectedCaptions) {
      issues.push({
        code: "rendered_caption_count_mismatch",
        message: `图表标题数量不一致：应为${expectedCaptions}，实际为${captionCount}。`,
      });
    }
    if (/<wp:anchor(?:\s|>)/.test(documentXml)) {
      issues.push({
        code: "floating_figure_detected",
        message: "检测到浮动图片；自动化文档必须使用行内图片以避免跨渲染器漂移。",
      });
    }
    if (!/<w:pgSz\b[^>]*w:w="11906"[^>]*w:h="16838"/.test(documentXml)) {
      issues.push({ code: "page_geometry_invalid", message: "A4页面尺寸未写入成品。" });
    }
    const styleIds = Object.values(input.spec.templateSnapshot.typography);
    for (const styleId of styleIds) {
      if (!stylesXml.includes(`w:styleId="${styleId}"`)) {
        issues.push({
          code: "required_style_missing",
          message: `成品缺少模板要求的Word样式${styleId}。`,
        });
      }
    }
  }

  if (VISIBLE_INTERNAL_TOKEN.test(text)) {
    issues.push({
      code: "visible_internal_token_detected",
      message: "成品可见文本包含内部ID、占位符或Markdown代码围栏。",
    });
  }
  if (/\uFFFD/.test(text)) {
    issues.push({
      code: "replacement_character_detected",
      message: "成品可见文本包含Unicode替换字符，可能存在乱码。",
    });
  }
  if (input.assembly && input.spec) {
    const renderedCaptionLabels = input.assembly.captions.filter((caption) =>
      text.includes(caption.label),
    ).length;
    if (renderedCaptionLabels !== input.assembly.captions.length) {
      issues.push({
        code: "caption_manifest_not_rendered",
        message: "Caption Manifest中的编号未全部进入成品。",
      });
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    metrics: {
      byteSize: input.buffer.byteLength,
      tableCount,
      figureCount,
      captionCount,
      visibleTextLength: text.length,
    },
  };
}

export async function assertRenderedDocumentQuality(input: {
  buffer: Buffer;
  spec?: FinalDocumentSpec;
  assembly?: DocumentAssemblyManifest;
}): Promise<RenderQualityReport> {
  const report = await auditRenderedDocument(input);
  if (!report.passed) {
    throw new Error(
      `document_render_quality_failed: ${report.issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return report;
}
