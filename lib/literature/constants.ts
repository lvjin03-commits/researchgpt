export const LITERATURE_DATE_RANGE_DAYS = 30;

export const LITERATURE_MAX_ARXIV_RESULTS = 50;

export const LITERATURE_DATE_RANGE_OPTIONS = [
  { value: 30, label: "1 month" },
  { value: 365, label: "1 year" },
  { value: 1825, label: "5 years" },
  { value: 3650, label: "10 years" },
  { value: 0, label: "All time" },
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
  recommended: "Recommended",
  skim: "Skim",
  skip: "Skip",
} as const;
