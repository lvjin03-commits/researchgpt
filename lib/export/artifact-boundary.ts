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

export function separateArtifactChannels(
  format: ExportFormat,
  content: string,
): ArtifactChannelResult {
  if (!DOCUMENT_BODY_FORMATS.has(format)) {
    return { content, visualSpecs: [] };
  }

  const visualSpecs: ExportVisualSpec[] = [];
  let separated = content.replace(
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
