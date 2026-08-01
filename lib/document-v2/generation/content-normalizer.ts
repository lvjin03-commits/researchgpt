import { createHash } from "node:crypto";
import type { GeneratedComponentPayload } from "../orchestration/contracts";

export const CONTENT_NORMALIZER_VERSION = "caption-v1" as const;

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
  normalizerVersion: typeof CONTENT_NORMALIZER_VERSION;
};

export type ContentNormalizationIssue = {
  code:
    | "figure_caption_empty"
    | "table_caption_empty"
    | "caption_prefix_unsupported";
  fieldPath: string;
  message: string;
};

type CaptionKind = "figure" | "table";

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
