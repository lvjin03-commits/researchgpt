import {
  inlineSpansToPlainText,
  parseInlineMarkdown,
  parseMarkdownBlocks,
  type InlineSpan,
  type MarkdownBlock,
} from "@/lib/export/markdown-blocks";

export type WordDocumentKind =
  | "sci_review"
  | "paper_reading"
  | "research_report"
  | "translation"
  | "meeting_notes"
  | "general";

export type WordParagraphBlock = {
  type: "paragraph";
  inlines: InlineSpan[];
};

export type WordListBlock = {
  type: "list";
  ordered: boolean;
  items: InlineSpan[][];
};

export type WordTableBlock = {
  type: "table";
  caption: string;
  headers: InlineSpan[][];
  rows: InlineSpan[][][];
};

export type WordCalloutBlock = {
  type: "callout";
  inlines: InlineSpan[];
};

export type WordContentBlock =
  | WordParagraphBlock
  | WordListBlock
  | WordTableBlock
  | WordCalloutBlock;

export type WordSection = {
  title: string;
  level: 1 | 2 | 3;
  blocks: WordContentBlock[];
};

export type WordDocumentSpec = {
  title: string;
  kind: WordDocumentKind;
  abstract?: string;
  keywords: string[];
  sections: WordSection[];
  references: string[];
  warnings: string[];
};

const DEFAULT_TITLE = "ResearchGPT Generated Document";

const COMMAND_LINE_PATTERNS: RegExp[] = [
  /generate\s+file/i,
  /copy\s+and\s+paste/i,
  /select\s+.+format/i,
  /download\s+link/i,
  /click\s+generate/i,
  /output\s+only/i,
  /return\s+only/i,
  /生成.*(?:文件|文档|word|docx|excel|xlsx|pdf|ppt)/i,
  /输出.*(?:文件|文档|word|docx|excel|xlsx|pdf|ppt)/i,
  /导出.*(?:文件|文档|word|docx|excel|xlsx|pdf|ppt)/i,
  /下载.*(?:文件|文档|word|docx|excel|xlsx|pdf|ppt)/i,
  /复制.*(?:markdown|内容|粘贴)/i,
  /点击.*(?:生成|下载)/i,
  /生成文件/,
  /点击.*生成/,
  /复制.*粘贴/,
  /选择.*格式/,
  /下载链接/,
  /输出.*(?:word|docx|excel|xlsx|pdf|pptx?)/i,
  /生成.*(?:word|docx|excel|xlsx|pdf|pptx?|文档|文件)/i,
];

function plain(inlines: InlineSpan[]): string {
  return inlineSpansToPlainText(inlines).replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
}

function normalizeTitle(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*["'“”]+|["'“”]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string): string {
  return normalizeTitle(value).replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function stripHeadingNumber(value: string): string {
  return normalizeTitle(value)
    .replace(/^\d+(?:\.\d+)*[.)、]?\s*/, "")
    .replace(/^section\s+\d+(?:\.\d+)*[.)]?\s*/i, "")
    .trim();
}

function compactHeading(value: string): string {
  return compact(stripHeadingNumber(value));
}

function lineLooksLikeCommand(line: string): boolean {
  const normalized = normalizeTitle(line);
  if (!normalized) return true;
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(normalized)) return true;
  return COMMAND_LINE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isGenericDocumentHeading(value: string): boolean {
  return /^(content|contents|正文|目录|abstract|keywords?|references?|bibliography)$/i.test(
    stripHeadingNumber(value),
  );
}

function isBadTitleCandidate(value: string): boolean {
  const title = normalizeTitle(value);
  if (!title) return true;
  if (title.length > 140) return true;
  if (lineLooksLikeCommand(title)) return true;
  if (isGenericDocumentHeading(title)) return true;
  if (/^(word|excel|pdf|ppt|docx|xlsx|markdown|csv)\b/i.test(title)) return true;
  return false;
}

function inferDocumentKind(input: string): WordDocumentKind {
  const text = input.toLowerCase();
  if (/sci|review|综述|literature review/.test(text)) return "sci_review";
  if (/精读|单篇|paper reading|文献解读|文献分析/.test(text)) return "paper_reading";
  if (/翻译|translate|translation/.test(text)) return "translation";
  if (/会议|纪要|minutes/.test(text)) return "meeting_notes";
  if (/报告|调研|research report|summary report/.test(text)) {
    return "research_report";
  }
  return "general";
}

function isReferencesHeading(value: string): boolean {
  return /^(references|reference|bibliography|参考文献|引用文献)$/i.test(
    normalizeTitle(value),
  );
}

function isAbstractHeading(value: string): boolean {
  return /^(abstract|摘要)$/i.test(normalizeTitle(value));
}

function isKeywordsLine(value: string): boolean {
  return /^(keywords?|关键词)\s*[:：]/i.test(normalizeTitle(value));
}

function extractKeywords(value: string): string[] {
  return normalizeTitle(value)
    .replace(/^(keywords?|关键词)\s*[:：]/i, "")
    .split(/[;,，；、]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function isReferencesHeadingStrict(value: string): boolean {
  return /^(references|reference|bibliography|参考文献|引用文献)$/i.test(
    stripHeadingNumber(value),
  );
}

function isAbstractHeadingStrict(value: string): boolean {
  return /^(abstract|摘要)$/i.test(stripHeadingNumber(value));
}

function isKeywordsLineStrict(value: string): boolean {
  return /^(keywords?|关键词)\s*[:：]/i.test(normalizeTitle(value));
}

function extractKeywordsStrict(value: string): string[] {
  return normalizeTitle(value)
    .replace(/^(keywords?|关键词)\s*[:：]/i, "")
    .split(/[;,，；、]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function flattenListText(block: MarkdownBlock): string[] {
  if (block.type !== "bullet" && block.type !== "numbered") return [];
  return block.items.map(plain).filter(Boolean);
}

function blockToParagraphText(block: MarkdownBlock): string {
  switch (block.type) {
    case "paragraph":
    case "blockquote":
      return plain(block.inlines);
    case "bullet":
    case "numbered":
      return flattenListText(block).join("; ");
    case "code":
      return block.content.trim();
    case "heading":
      return plain(block.inlines);
    case "table":
      return "";
  }
}

function createSection(title: string, level: 1 | 2 | 3): WordSection {
  return {
    title: normalizeTitle(title),
    level,
    blocks: [],
  };
}

function tableCaptionFor(section: WordSection, tableIndex: number): string {
  const base = section.title || "Table";
  return `Table ${tableIndex}. ${base}`;
}

type StructuredVisualSpec = {
  title: string;
  caption: string;
  source: string;
};

const STRUCTURED_VISUAL_KEYS =
  /"(?:type|title|steps|caption|source|evidenceType|nodes|edges|series|data|labels|values)"\s*:/i;

function cleanJsonLikeBlock(value: string): string {
  return normalizeText(value)
    .replace(/^```(?:json|chart|figure|visual|diagram)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/^>\s?/gm, "")
    .trim();
}

function firstJsonStringField(value: string, field: string): string {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, "i");
  return pattern.exec(value)?.[1]?.trim() ?? "";
}

function maybeStructuredVisualSpec(value: string): StructuredVisualSpec | null {
  const raw = cleanJsonLikeBlock(value);
  if (!raw || (!raw.startsWith("{") && !raw.startsWith("["))) return null;
  if (!STRUCTURED_VISUAL_KEYS.test(raw)) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!record || typeof record !== "object") return null;

    const object = record as Record<string, unknown>;
    const searchable = `${object.type ?? ""} ${object.evidenceType ?? ""}`;
    const hasVisualPayload = [
      "steps",
      "nodes",
      "edges",
      "series",
      "data",
      "labels",
      "values",
      "caption",
      "source",
    ].some((key) => key in object);
    if (
      !hasVisualPayload &&
      !/figure|visual|diagram|process|timeline|taxonomy|framework|comparison|chart|structure/i.test(
        searchable,
      )
    ) {
      return null;
    }

    return {
      title:
        typeof object.title === "string" && object.title.trim()
          ? object.title.trim()
          : "Structured figure",
      caption:
        typeof object.caption === "string" && object.caption.trim()
          ? object.caption.trim()
          : "",
      source:
        typeof object.source === "string" && object.source.trim()
          ? object.source.trim()
          : "",
    };
  } catch {
    return {
      title: firstJsonStringField(raw, "title") || "Structured figure",
      caption: firstJsonStringField(raw, "caption"),
      source: firstJsonStringField(raw, "source"),
    };
  }
}

function structuredVisualToInlines(spec: StructuredVisualSpec): InlineSpan[] {
  const text = [
    `[Figure placeholder: ${spec.title}]`,
    spec.caption ? `Caption: ${spec.caption}` : "",
    spec.source ? `Source: ${spec.source}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return parseInlineMarkdown(text);
}

function shouldKeepCodeBlock(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (maybeStructuredVisualSpec(trimmed)) return false;
  if (/^\|.+\|\s*\n\|[-:\s|]+\|/m.test(trimmed)) return false;
  if (/^(json|csv|markdown|md|text)$/i.test(trimmed.split(/\s+/)[0] ?? "")) {
    return false;
  }
  if (/^[{[]/.test(trimmed) && STRUCTURED_VISUAL_KEYS.test(trimmed)) return false;
  return trimmed.length < 1200;
}

function appendBlock(
  section: WordSection,
  block: MarkdownBlock,
  tableIndex: number,
): number {
  switch (block.type) {
    case "paragraph": {
      const text = plain(block.inlines);
      if (!text || lineLooksLikeCommand(text)) return tableIndex;
      const structuredVisual = maybeStructuredVisualSpec(text);
      if (structuredVisual) {
        section.blocks.push({
          type: "callout",
          inlines: structuredVisualToInlines(structuredVisual),
        });
        return tableIndex;
      }
      section.blocks.push({ type: "paragraph", inlines: block.inlines });
      return tableIndex;
    }
    case "blockquote": {
      const text = plain(block.inlines);
      const structuredVisual = maybeStructuredVisualSpec(text);
      section.blocks.push({
        type: "callout",
        inlines: structuredVisual
          ? structuredVisualToInlines(structuredVisual)
          : block.inlines,
      });
      return tableIndex;
    }
    case "bullet":
    case "numbered":
      section.blocks.push({
        type: "list",
        ordered: block.type === "numbered",
        items: block.items,
      });
      return tableIndex;
    case "table": {
      const nextIndex = tableIndex + 1;
      section.blocks.push({
        type: "table",
        caption: tableCaptionFor(section, nextIndex),
        headers: block.headers,
        rows: block.rows,
      });
      return nextIndex;
    }
    case "code": {
      const structuredVisual = maybeStructuredVisualSpec(block.content);
      if (structuredVisual) {
        section.blocks.push({
          type: "callout",
          inlines: structuredVisualToInlines(structuredVisual),
        });
      } else if (shouldKeepCodeBlock(block.content)) {
        section.blocks.push({
          type: "callout",
          inlines: parseInlineMarkdown(block.content.trim()),
        });
      }
      return tableIndex;
    }
    case "heading":
      return tableIndex;
  }
}

function removeEmptySections(sections: WordSection[]): WordSection[] {
  return sections.filter(
    (section) => section.title && section.blocks.length > 0,
  );
}

function collectReferencesFromSection(section: WordSection): string[] {
  const references: string[] = [];
  for (const block of section.blocks) {
    if (block.type === "paragraph" || block.type === "callout") {
      const text = plain(block.inlines);
      if (text) references.push(text);
    } else if (block.type === "list") {
      references.push(...block.items.map(plain).filter(Boolean));
    }
  }
  return references;
}

function ensureSciReviewShape(spec: WordDocumentSpec): WordDocumentSpec {
  if (spec.kind !== "sci_review") return spec;

  const sections = spec.sections.filter(
    (section) => compactHeading(section.title) !== "content",
  );
  const firstTitle = compactHeading(sections[0]?.title ?? "");
  if (firstTitle !== "introduction" && firstTitle !== "引言") {
    sections.unshift(
      createSection("1. Introduction", 1),
    );
    sections[0].blocks.push({
      type: "paragraph",
      inlines: parseInlineMarkdown(
        "This section introduces the research background, scope, and the main scientific questions addressed in this review.",
      ),
    });
  }

  return { ...spec, sections };
}

function titleFromContent(
  requestedTitle: string,
  blocks: MarkdownBlock[],
): string {
  if (!isBadTitleCandidate(requestedTitle)) {
    return normalizeTitle(requestedTitle);
  }

  for (const block of blocks) {
    if (block.type !== "heading") continue;
    const candidate = plain(block.inlines);
    if (!isBadTitleCandidate(candidate)) return normalizeTitle(candidate);
  }

  for (const block of blocks) {
    const candidate = blockToParagraphText(block);
    if (!isBadTitleCandidate(candidate)) return normalizeTitle(candidate);
  }

  return isBadTitleCandidate(requestedTitle)
    ? DEFAULT_TITLE
    : normalizeTitle(requestedTitle);
}

export function buildWordDocumentSpec(input: {
  title: string;
  content: string;
}): WordDocumentSpec {
  const content = normalizeText(input.content);
  const blocks = parseMarkdownBlocks(content);
  const kind = inferDocumentKind(`${input.title}\n${content}`);
  const title = titleFromContent(input.title, blocks);
  const warnings: string[] = [];
  const keywords: string[] = [];
  const references: string[] = [];
  let abstract: string | undefined;
  let current = createSection("Content", 1);
  const sections: WordSection[] = [current];
  let tableIndex = 0;
  let captureReferences = false;
  let captureAbstract = false;

  for (const block of blocks) {
    if (block.type === "heading") {
      const heading = plain(block.inlines);
      if (!heading || compactHeading(heading) === compactHeading(title)) continue;

      captureReferences =
        isReferencesHeadingStrict(heading) || isReferencesHeading(heading);
      captureAbstract =
        isAbstractHeadingStrict(heading) || isAbstractHeading(heading);

      if (captureReferences || captureAbstract) {
        continue;
      }

      if (lineLooksLikeCommand(heading)) continue;
      current = createSection(heading, block.level);
      sections.push(current);
      continue;
    }

    if (captureReferences) {
      const refs =
        block.type === "bullet" || block.type === "numbered"
          ? flattenListText(block)
          : [blockToParagraphText(block)].filter(Boolean);
      references.push(...refs);
      continue;
    }

    const text = blockToParagraphText(block);
    if (isKeywordsLineStrict(text) || isKeywordsLine(text)) {
      keywords.push(
        ...(isKeywordsLineStrict(text)
          ? extractKeywordsStrict(text)
          : extractKeywords(text)),
      );
      continue;
    }

    if (captureAbstract) {
      if (!abstract && text) {
        abstract = text;
      }
      continue;
    }

    tableIndex = appendBlock(current, block, tableIndex);
  }

  let meaningfulSections = removeEmptySections(sections).filter(
    (section) =>
      !isReferencesHeadingStrict(section.title) &&
      !isReferencesHeading(section.title) &&
      !isAbstractHeadingStrict(section.title) &&
      !isAbstractHeading(section.title) &&
      compactHeading(section.title) !== "keywords",
  );

  if (!abstract) {
    const firstParagraph = meaningfulSections
      .flatMap((section) =>
        section.blocks.flatMap((block) =>
          block.type === "paragraph" ? [plain(block.inlines)] : [],
        ),
      )
      .find((value) => value.length >= 60);
    if (firstParagraph && kind === "sci_review") {
      abstract =
        firstParagraph.length > 900
          ? `${firstParagraph.slice(0, 897).trim()}...`
          : firstParagraph;
    }
  }

  if (meaningfulSections.length === 0) {
    meaningfulSections = [
      {
        title: kind === "sci_review" ? "1. Introduction" : "Content",
        level: 1,
        blocks: [
          {
            type: "paragraph",
            inlines: parseInlineMarkdown(content || "No content provided."),
          },
        ],
      },
    ];
    warnings.push("The source content had no clear document structure.");
  }

  for (const section of meaningfulSections) {
    if (isReferencesHeadingStrict(section.title) || isReferencesHeading(section.title)) {
      references.push(...collectReferencesFromSection(section));
    }
  }

  const spec = ensureSciReviewShape({
    title,
    kind,
    abstract,
    keywords: [...new Set(keywords)],
    sections: meaningfulSections.filter(
      (section) =>
        !isReferencesHeadingStrict(section.title) &&
        !isReferencesHeading(section.title) &&
        !isAbstractHeadingStrict(section.title) &&
        !isAbstractHeading(section.title),
    ),
    references: [...new Set(references)].slice(0, 80),
    warnings,
  });

  return spec;
}
