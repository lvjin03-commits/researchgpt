import type { ExportFormat } from "@/lib/export/types";

export type ExportVisualSpec = {
  kind: string;
  title: string;
  caption: string;
  source: string;
  raw: string;
};

export type ArtifactChannelResult = {
  content: string;
  visualSpecs: ExportVisualSpec[];
};

const DOCUMENT_BODY_FORMATS = new Set<ExportFormat>(["docx", "pdf", "md", "txt"]);
const VISUAL_FENCE_LANGUAGES = /^(json|visual|diagram|chart|figure)$/i;
const STRUCTURED_VISUAL_KEYS =
  /"(?:type|title|steps|caption|source|evidenceType|nodes|edges|series|data|labels|values)"\s*:/i;
const VISUAL_TAG_PATTERN =
  /<researchgpt-visual>\s*([\s\S]*?)\s*<\/researchgpt-visual>/gi;

function cleanJsonLikeBlock(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/^```(?:json|chart|figure|visual|diagram)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .replace(/^>\s?/gm, "")
    .trim();
}

function firstJsonStringField(value: string, field: string): string {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, "i");
  return pattern.exec(value)?.[1]?.trim() ?? "";
}

export function parseStructuredVisualSpec(value: string): ExportVisualSpec | null {
  const raw = cleanJsonLikeBlock(value);
  if (!raw || (!raw.startsWith("{") && !raw.startsWith("["))) return null;
  if (!STRUCTURED_VISUAL_KEYS.test(raw)) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!record || typeof record !== "object") return null;

    const object = record as Record<string, unknown>;
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
    const kind = String(object.type ?? object.evidenceType ?? "figure");

    if (
      !hasVisualPayload &&
      !/figure|visual|diagram|process|timeline|taxonomy|framework|comparison|chart|structure/i.test(
        kind,
      )
    ) {
      return null;
    }

    return {
      kind,
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
      raw,
    };
  } catch {
    return {
      kind: firstJsonStringField(raw, "type") || firstJsonStringField(raw, "evidenceType") || "figure",
      title: firstJsonStringField(raw, "title") || "Structured figure",
      caption: firstJsonStringField(raw, "caption"),
      source: firstJsonStringField(raw, "source"),
      raw,
    };
  }
}

function visualPlaceholder(spec: ExportVisualSpec): string {
  return [
    `> Figure placeholder: ${spec.title}`,
    spec.caption ? `> Caption: ${spec.caption}` : "",
    spec.source ? `> Source: ${spec.source}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function splitParagraphs(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split(/\n{2,}/);
}

function legacyVisualSpec(value: string): ExportVisualSpec | null {
  if (/^>\s*Figure placeholder:/i.test(value.trim())) return null;
  const normalized = value.replace(/^>\s?/gm, "").replace(/\s+/g, " ").trim();
  const match =
    /^(?:图|figure)\s*(\d+)?\s*(?:占位符|placeholder)\s*[:：]\s*(.+)$/i.exec(
      normalized,
    );
  if (!match) return null;

  const body = match[2]?.trim() ?? "";
  const sentenceBoundary = body.search(/[。.!！?？]/);
  const title =
    (sentenceBoundary >= 0 ? body.slice(0, sentenceBoundary) : body).trim() ||
    `Figure ${match[1] || ""}`.trim();
  const description =
    sentenceBoundary >= 0 ? body.slice(sentenceBoundary + 1).trim() : "";
  const itemSource = description
    .replace(/^图中(?:建议|应|可)?(?:展示|呈现|包括)\s*/i, "")
    .replace(/[。.!！?？]+$/, "");
  const itemTitles = itemSource
    .split(/[、；;]|(?:，|,)\s*|和(?=[^，。]{2,})/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 40)
    .slice(0, 6);
  const steps =
    itemTitles.length >= 2
      ? itemTitles.map((item) => ({ title: item, description: "" }))
      : [
          {
            title,
            description:
              description || "根据文档内容生成的概念结构示意。",
          },
        ];
  const raw = JSON.stringify({
    type: "process",
    title,
    steps,
    caption: description,
    source: "作者根据文档内容进行的概念性归纳",
    evidenceType: "ai_structure",
  });

  return {
    kind: "process",
    title,
    caption: description,
    source: "作者根据文档内容进行的概念性归纳",
    raw,
  };
}

function isLegacyFigureMetadata(value: string): boolean {
  const normalized = value.replace(/^>\s?/gm, "").replace(/\s+/g, " ").trim();
  return /^(?:图\s*\d+\s*)?图注\s*[:：]|^(?:来源与证据类型|evidenceType)\s*[:：=]/i.test(
    normalized,
  );
}

export function separateArtifactChannels(
  format: ExportFormat,
  content: string,
): ArtifactChannelResult {
  if (!DOCUMENT_BODY_FORMATS.has(format)) {
    return { content, visualSpecs: [] };
  }

  const visualSpecs: ExportVisualSpec[] = [];
  let separated = content.replace(VISUAL_TAG_PATTERN, (_full, body: string) => {
    const spec = parseStructuredVisualSpec(body);
    if (!spec) return "";
    visualSpecs.push(spec);
    return visualPlaceholder(spec);
  });

  separated = separated.replace(
    /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g,
    (full, language: string, body: string) => {
      if (!VISUAL_FENCE_LANGUAGES.test(language.trim())) return full;
      const spec = parseStructuredVisualSpec(body);
      if (!spec) return full;
      visualSpecs.push(spec);
      return visualPlaceholder(spec);
    },
  );

  separated = splitParagraphs(separated)
    .map((paragraph) => {
      const legacySpec = legacyVisualSpec(paragraph);
      if (legacySpec) {
        visualSpecs.push(legacySpec);
        return visualPlaceholder(legacySpec);
      }
      if (isLegacyFigureMetadata(paragraph)) return "";
      const spec = parseStructuredVisualSpec(paragraph);
      if (!spec) return paragraph;
      visualSpecs.push(spec);
      return visualPlaceholder(spec);
    })
    .join("\n\n");

  return {
    content: separated.replace(/\n{3,}/g, "\n\n").trim(),
    visualSpecs,
  };
}
