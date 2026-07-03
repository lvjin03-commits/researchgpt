export const LITERATURE_DATE_RANGE_DAYS = 30;

export const LITERATURE_MAX_ARXIV_RESULTS = 50;

export const LITERATURE_MAX_ANALYSIS_PAPERS = 25;

/** Default provider pipeline stored with literature settings for backward compatibility. */
export const DEFAULT_LITERATURE_PIPELINE_SOURCES = [
  "openalex",
  "arxiv",
  "pubmed",
] as const;

export const LITERATURE_DATE_RANGE_OPTIONS = [
  { value: 30, label: "1 个月" },
  { value: 365, label: "1 年" },
  { value: 1825, label: "5 年" },
  { value: 3650, label: "10 年" },
  { value: 0, label: "全部时间" },
] as const;

export const ALLOWED_LITERATURE_DATE_RANGE_DAYS =
  LITERATURE_DATE_RANGE_OPTIONS.map((option) => option.value);

export type LiteratureDateRangeDays =
  (typeof LITERATURE_DATE_RANGE_OPTIONS)[number]["value"];

export function normalizeDateRangeDays(value: unknown): LiteratureDateRangeDays {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return LITERATURE_DATE_RANGE_DAYS;
  }

  const rounded = Math.round(value);

  if (rounded === 7) {
    return LITERATURE_DATE_RANGE_DAYS;
  }

  if (
    ALLOWED_LITERATURE_DATE_RANGE_DAYS.includes(
      rounded as LiteratureDateRangeDays,
    )
  ) {
    return rounded as LiteratureDateRangeDays;
  }

  return LITERATURE_DATE_RANGE_DAYS;
}

export const LITERATURE_ANALYSIS_BATCH_SIZE = 5;

export const LITERATURE_PRIORITY_LABELS = {
  recommended: "推荐",
  skim: "略读",
  skip: "可忽略",
} as const;
