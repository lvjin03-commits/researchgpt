import {
  inlineSpansToPlainText,
  parseMarkdownBlocks,
  type MarkdownBlock,
} from "@/lib/export/markdown-blocks";

export type ArtifactTable = {
  title: string;
  headers: string[];
  rows: string[][];
};

export type ArtifactSection = {
  title: string;
  level: 1 | 2 | 3;
  paragraphs: string[];
  bullets: string[];
};

export type ArtifactSpec = {
  title: string;
  summary: string;
  sections: ArtifactSection[];
  tables: ArtifactTable[];
};

function blockText(block: MarkdownBlock): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "blockquote":
      return inlineSpansToPlainText(block.inlines).trim();
    case "bullet":
    case "numbered":
      return block.items.map(inlineSpansToPlainText).join("；").trim();
    case "code":
      return block.content.trim();
    case "table":
      return "";
  }
}

export function buildArtifactSpec(title: string, content: string): ArtifactSpec {
  const blocks = parseMarkdownBlocks(content);
  const sections: ArtifactSection[] = [];
  const tables: ArtifactTable[] = [];
  let current: ArtifactSection = {
    title: "内容摘要",
    level: 1,
    paragraphs: [],
    bullets: [],
  };
  sections.push(current);

  for (const block of blocks) {
    if (block.type === "heading") {
      current = {
        title: inlineSpansToPlainText(block.inlines).trim(),
        level: block.level,
        paragraphs: [],
        bullets: [],
      };
      sections.push(current);
      continue;
    }

    if (block.type === "table") {
      tables.push({
        title: current.title || `表格 ${tables.length + 1}`,
        headers: block.headers.map(inlineSpansToPlainText),
        rows: block.rows.map((row) => row.map(inlineSpansToPlainText)),
      });
      continue;
    }

    if (block.type === "bullet" || block.type === "numbered") {
      current.bullets.push(
        ...block.items.map((item) => inlineSpansToPlainText(item).trim()),
      );
      continue;
    }

    const text = blockText(block);
    if (text) current.paragraphs.push(text);
  }

  const meaningfulSections = sections.filter(
    (section) => section.paragraphs.length > 0 || section.bullets.length > 0,
  );
  const summarySource =
    meaningfulSections
      .flatMap((section) => [...section.paragraphs, ...section.bullets])
      .find(Boolean) ?? content.replace(/\s+/g, " ").trim();

  return {
    title,
    summary:
      summarySource.length > 240
        ? `${summarySource.slice(0, 239)}…`
        : summarySource,
    sections: meaningfulSections,
    tables,
  };
}
