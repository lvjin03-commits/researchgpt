export type InlineSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; inlines: InlineSpan[] }
  | { type: "paragraph"; inlines: InlineSpan[] }
  | { type: "bullet"; items: InlineSpan[][] }
  | { type: "numbered"; items: InlineSpan[][] }
  | { type: "code"; content: string }
  | { type: "blockquote"; inlines: InlineSpan[] };

const HEADING_PATTERN = /^(#{1,3})\s+(.+)$/;
const BULLET_PATTERN = /^[-*+]\s+(.+)$/;
const NUMBERED_PATTERN = /^\d+\.\s+(.+)$/;
const BLOCKQUOTE_PATTERN = /^>\s?(.+)$/;

export function parseInlineMarkdown(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const pattern =
    /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\)|[^*`_\[]+)/g;

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    if (!token) continue;

    if (token.startsWith("**") && token.endsWith("**")) {
      spans.push({ text: token.slice(2, -2), bold: true });
      continue;
    }

    if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      spans.push({ text: token.slice(1, -1), italic: true });
      continue;
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      spans.push({ text: token.slice(1, -1), code: true });
      continue;
    }

    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
    if (linkMatch) {
      spans.push({ text: `${linkMatch[1]} (${linkMatch[2]})` });
      continue;
    }

    spans.push({ text: token });
  }

  if (spans.length === 0 && text) {
    spans.push({ text });
  }

  return spans;
}

export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const fenceLanguage = line.slice(3).trim();
      index += 1;
      const codeLines: string[] = [];

      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length && lines[index].startsWith("```")) {
        index += 1;
      }

      blocks.push({
        type: "code",
        content: codeLines.join("\n"),
      });

      if (fenceLanguage && codeLines.length === 0) {
        blocks[blocks.length - 1] = {
          type: "code",
          content: "",
        };
      }

      continue;
    }

    const headingMatch = HEADING_PATTERN.exec(line);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        inlines: parseInlineMarkdown(headingMatch[2]),
      });
      index += 1;
      continue;
    }

    const blockquoteMatch = BLOCKQUOTE_PATTERN.exec(line);
    if (blockquoteMatch) {
      blocks.push({
        type: "blockquote",
        inlines: parseInlineMarkdown(blockquoteMatch[1]),
      });
      index += 1;
      continue;
    }

    if (BULLET_PATTERN.test(line)) {
      const items: InlineSpan[][] = [];

      while (index < lines.length) {
        const bulletMatch = BULLET_PATTERN.exec(lines[index]);
        if (!bulletMatch) break;
        items.push(parseInlineMarkdown(bulletMatch[1]));
        index += 1;
      }

      blocks.push({ type: "bullet", items });
      continue;
    }

    if (NUMBERED_PATTERN.test(line)) {
      const items: InlineSpan[][] = [];

      while (index < lines.length) {
        const numberedMatch = NUMBERED_PATTERN.exec(lines[index]);
        if (!numberedMatch) break;
        items.push(parseInlineMarkdown(numberedMatch[1]));
        index += 1;
      }

      blocks.push({ type: "numbered", items });
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;

    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].startsWith("```") &&
      !HEADING_PATTERN.test(lines[index]) &&
      !BULLET_PATTERN.test(lines[index]) &&
      !NUMBERED_PATTERN.test(lines[index]) &&
      !BLOCKQUOTE_PATTERN.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push({
      type: "paragraph",
      inlines: parseInlineMarkdown(paragraphLines.join("\n")),
    });
  }

  return blocks;
}

export function inlineSpansToPlainText(inlines: InlineSpan[]): string {
  return inlines.map((span) => span.text).join("");
}
