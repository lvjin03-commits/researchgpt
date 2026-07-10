// Server-only module.

import { LiteratureError } from "@/lib/literature/errors";
import {
  REVIEW_AUDIENCE_OPTIONS,
  REVIEW_LANGUAGE_OPTIONS,
  REVIEW_LENGTH_OPTIONS,
  REVIEW_OUTPUT_TYPE_OPTIONS,
  REVIEW_PERSPECTIVE_OPTIONS,
  REVIEW_SECTION_OPTIONS,
  REVIEW_MODEL_IDS,
} from "@/lib/literature/review/constants";
import type {
  LiteratureReviewRequest,
  ReviewGenerationPhase,
  ReviewWorkflowMode,
} from "@/lib/literature/review/types";

const PHASES = new Set<ReviewGenerationPhase>(["outline", "full", "ppt"]);
const WORKFLOW_MODES = new Set<ReviewWorkflowMode>([
  "quick_outline",
  "academic_review",
]);

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickOption<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  const normalized = cleanString(value);
  if (!allowed.includes(normalized as T)) {
    throw new LiteratureError(`${field} 无效。`, 400);
  }
  return normalized as T;
}

function parseSections(value: unknown): LiteratureReviewRequest["requiredSections"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new LiteratureError("请至少选择一个必需结构章节。", 400);
  }

  const sections = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  const invalid = sections.find(
    (section) =>
      !REVIEW_SECTION_OPTIONS.includes(
        section as (typeof REVIEW_SECTION_OPTIONS)[number],
      ),
  );

  if (invalid) {
    throw new LiteratureError(`无效章节：${invalid}`, 400);
  }

  return sections as LiteratureReviewRequest["requiredSections"];
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return Math.round(numeric);
}

export function parseLiteratureReviewRequest(
  body: unknown,
): LiteratureReviewRequest {
  if (typeof body !== "object" || body === null) {
    throw new LiteratureError("请求体无效。", 400);
  }

  const record = body as Record<string, unknown>;
  const phase = cleanString(record.phase) as ReviewGenerationPhase;
  const workflowMode = cleanString(record.workflowMode) as ReviewWorkflowMode;

  if (!PHASES.has(phase)) {
    throw new LiteratureError('phase 必须是 "outline"、"full" 或 "ppt"。', 400);
  }

  if (!WORKFLOW_MODES.has(workflowMode)) {
    throw new LiteratureError("请选择有效的综述生成模式。", 400);
  }

  const folderId = cleanString(record.folderId);
  const topic = cleanString(record.topic);

  if (!folderId) {
    throw new LiteratureError("请选择文献文件夹。", 400);
  }

  if (!topic) {
    throw new LiteratureError("请填写综述主题。", 400);
  }

  const request: LiteratureReviewRequest = {
    phase,
    workflowMode,
    model: pickOption(record.model, REVIEW_MODEL_IDS, "model"),
    folderId,
    topic,
    perspective: pickOption(
      record.perspective,
      REVIEW_PERSPECTIVE_OPTIONS,
      "perspective",
    ),
    customPerspective: cleanString(record.customPerspective) || undefined,
    targetAudience: pickOption(
      record.targetAudience,
      REVIEW_AUDIENCE_OPTIONS,
      "targetAudience",
    ),
    requiredSections: parseSections(record.requiredSections),
    outputType: pickOption(
      record.outputType,
      REVIEW_OUTPUT_TYPE_OPTIONS,
      "outputType",
    ),
    language: pickOption(record.language, REVIEW_LANGUAGE_OPTIONS, "language"),
    length: pickOption(record.length, REVIEW_LENGTH_OPTIONS, "length"),
    customWordCount: parseOptionalNumber(record.customWordCount),
    additionalInstructions:
      cleanString(record.additionalInstructions) || undefined,
    confirmedOutline: cleanString(record.confirmedOutline) || undefined,
    reviewContent: cleanString(record.reviewContent) || undefined,
  };

  if (request.perspective === "自定义" && !request.customPerspective) {
    throw new LiteratureError("请填写自定义写作视角。", 400);
  }

  if (request.length === "自定义字数" && !request.customWordCount) {
    throw new LiteratureError("请填写自定义字数。", 400);
  }

  if (phase === "full" && !request.confirmedOutline) {
    throw new LiteratureError("请确认或编辑大纲后再生成正文。", 400);
  }
  if (phase === "ppt" && !request.reviewContent) {
    throw new LiteratureError("请先生成综述正文。", 400);
  }

  return request;
}
