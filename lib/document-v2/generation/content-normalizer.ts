import { createHash } from "node:crypto";
import type { GeneratedComponentPayload } from "../orchestration/contracts";
import { joinCitationSegmentTexts } from "../citations/segments";

export const CONTENT_NORMALIZER_VERSION = "content-v2" as const;

const FIGURE_CAPTION_PREFIX =
  /^\s*(?:(?:fig(?:ure)?\.?)\s*\d+|图\s*\d+)(?![\p{L}\p{N}-])\s*(?:[.:：\-–—|]\s*)?/iu;
const TABLE_CAPTION_PREFIX =
  /^\s*(?:table\s*\d+|表\s*\d+)(?![\p{L}\p{N}-])\s*(?:[.:：\-–—|]\s*)?/iu;
const UNSUPPORTED_FIGURE_CAPTION_PREFIX =
  /^\s*(?:(?:fig(?:ure)?\.?)\s*(?:s\d+|\d+\p{L})|图\s*\d+\p{L})/iu;
const UNSUPPORTED_TABLE_CAPTION_PREFIX =
  /^\s*(?:table\s*\d+-\d+|表\s*\d+-\d+)/iu;

export type ContentNormalizationRecord = {
  fieldPath: string;
  rawValueHash: string;
  rawPreview: string;
  normalizedValue: string;
  rulesApplied: string[];
  normalizerVersion: string;
};

export type ContentNormalizationIssue = {
  code:
    | "figure_caption_empty"
    | "table_caption_empty"
    | "caption_prefix_unsupported"
    | "citation_marker_unbound";
  fieldPath: string;
  message: string;
};

type CaptionKind = "figure" | "table";

const STRUCTURED_CITATION_MARKER =
  /\[(?:(?:citation|evidence|reference)\s*:[^\]]+)\]/gi;

function markerCitationIds(marker: string): string[] {
  return marker
    .slice(1, -1)
    .split(",")
    .map((token) => token.trim().replace(/^(?:citation|evidence|reference)\s*:/i, ""))
    .filter(Boolean);
}

function normalizeVisibleCitationMarkers(input: {
  text: string;
  citationIds: ReadonlyArray<string>;
  fieldPath: string;
}): {
  value: string;
  records: ContentNormalizationRecord[];
  issues: ContentNormalizationIssue[];
} {
  const allowed = new Set(input.citationIds);
  const records: ContentNormalizationRecord[] = [];
  const issues: ContentNormalizationIssue[] = [];
  let value = input.text;
  const cleanVisibleText = (text: string) =>
    text
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;:!?。；，！？])/gu, "$1")
      .trim();
  const markers = [...input.text.matchAll(STRUCTURED_CITATION_MARKER)];
  for (const match of markers) {
    const marker = match[0];
    const markerIds = markerCitationIds(marker);
    if (markerIds.length === 0 || markerIds.some((id) => !allowed.has(id))) {
      issues.push({
        code: "citation_marker_unbound",
        fieldPath: input.fieldPath,
        message:
          "Visible citation marker contains an ID that is not bound to this segment.",
      });
      continue;
    }
    value = value.replace(marker, "");
    records.push({
      fieldPath: input.fieldPath,
      rawValueHash: createHash("sha256").update(input.text).digest("hex"),
      rawPreview: input.text.trim().slice(0, 240),
      normalizedValue: cleanVisibleText(value),
      rulesApplied: ["strip_bound_internal_citation_marker"],
      normalizerVersion: CONTENT_NORMALIZER_VERSION,
    });
  }
  return {
    value: cleanVisibleText(value),
    records,
    issues,
  };
}

function normalizeCaption(
  kind: CaptionKind,
  caption: string,
  fieldPath: string,
): { value: string; record?: ContentNormalizationRecord } {
  const pattern =
    kind === "figure" ? FIGURE_CAPTION_PREFIX : TABLE_CAPTION_PREFIX;
  const normalized = caption.replace(pattern, "").trim();
  const trimmed = caption.trim();
  if (normalized === trimmed) return { value: trimmed };

  return {
    value: normalized,
    record: {
      fieldPath,
      rawValueHash: createHash("sha256").update(caption).digest("hex"),
      rawPreview: trimmed.slice(0, 240),
      normalizedValue: normalized,
      rulesApplied: [
        kind === "figure"
          ? "strip_figure_number_prefix"
          : "strip_table_number_prefix",
      ],
      normalizerVersion: CONTENT_NORMALIZER_VERSION,
    },
  };
}

export function normalizeGeneratedComponentContent(
  payload: GeneratedComponentPayload,
): {
  payload: GeneratedComponentPayload;
  records: ContentNormalizationRecord[];
  issues: ContentNormalizationIssue[];
} {
  if (payload.kind !== "blocks") return { payload, records: [], issues: [] };

  const records: ContentNormalizationRecord[] = [];
  const issues: ContentNormalizationIssue[] = [];
  const blocks = payload.blocks.map((block, index) => {
    if (block.type === "paragraph") {
      if (block.citationGranularity !== "segment") return block;
      const segments = block.segments.map((segment, segmentIndex) => {
        const result = normalizeVisibleCitationMarkers({
          text: segment.text,
          citationIds: segment.citationIds,
          fieldPath: `blocks[${index}].segments[${segmentIndex}].text`,
        });
        records.push(...result.records);
        issues.push(...result.issues);
        return { ...segment, text: result.value };
      });
      return {
        ...block,
        segments,
        text: joinCitationSegmentTexts(segments),
      };
    }
    if (block.type !== "table") return block;
    const fieldPath = `blocks[${index}].caption`;
    const result = normalizeCaption(
      "table",
      block.caption,
      fieldPath,
    );
    if (result.record) records.push(result.record);
    if (result.record && !result.value) {
      issues.push({
        code: "table_caption_empty",
        fieldPath,
        message: "The table caption is empty after removing its manual number.",
      });
    } else if (UNSUPPORTED_TABLE_CAPTION_PREFIX.test(result.value)) {
      issues.push({
        code: "caption_prefix_unsupported",
        fieldPath,
        message:
          "The table caption uses a manual number format that the renderer does not support.",
      });
    }
    return { ...block, caption: result.value };
  });
  const figureRequests = payload.figureRequests.map((request, index) => {
    const fieldPath = `figureRequests[${index}].caption`;
    const result = normalizeCaption(
      "figure",
      request.caption,
      fieldPath,
    );
    if (result.record) records.push(result.record);
    if (result.record && !result.value) {
      issues.push({
        code: "figure_caption_empty",
        fieldPath,
        message: "The figure caption is empty after removing its manual number.",
      });
    } else if (UNSUPPORTED_FIGURE_CAPTION_PREFIX.test(result.value)) {
      issues.push({
        code: "caption_prefix_unsupported",
        fieldPath,
        message:
          "The figure caption uses a manual number format that the renderer does not support.",
      });
    }
    return { ...request, caption: result.value };
  });

  return {
    payload: { ...payload, blocks, figureRequests },
    records,
    issues,
  };
}
