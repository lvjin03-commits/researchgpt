export const LITERATURE_DATE_RANGE_DAYS = 7;

export const LITERATURE_MAX_ARXIV_RESULTS = 25;

export const LITERATURE_ANALYSIS_BATCH_SIZE = 5;

export const LITERATURE_SOURCE_OPTIONS = [
  { value: "arxiv" as const, label: "arXiv" },
] as const;

export const LITERATURE_PRIORITY_LABELS = {
  recommended: "Recommended",
  skim: "Skim",
  skip: "Skip",
} as const;
