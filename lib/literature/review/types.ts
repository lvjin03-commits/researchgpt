import type {
  REVIEW_AUDIENCE_OPTIONS,
  REVIEW_LANGUAGE_OPTIONS,
  REVIEW_LENGTH_OPTIONS,
  REVIEW_OUTPUT_TYPE_OPTIONS,
  REVIEW_PERSPECTIVE_OPTIONS,
  REVIEW_SECTION_OPTIONS,
  REVIEW_TIME_RANGE_OPTIONS,
} from "@/lib/literature/review/constants";

export type ReviewPerspective = (typeof REVIEW_PERSPECTIVE_OPTIONS)[number];
export type ReviewAudience = (typeof REVIEW_AUDIENCE_OPTIONS)[number];
export type ReviewTimeRange = (typeof REVIEW_TIME_RANGE_OPTIONS)[number];
export type ReviewSection = (typeof REVIEW_SECTION_OPTIONS)[number];
export type ReviewOutputType = (typeof REVIEW_OUTPUT_TYPE_OPTIONS)[number];
export type ReviewLanguage = (typeof REVIEW_LANGUAGE_OPTIONS)[number];
export type ReviewLength = (typeof REVIEW_LENGTH_OPTIONS)[number];

export type ReviewGenerationPhase = "outline" | "full" | "ppt";

export type LiteratureReviewRequest = {
  phase: ReviewGenerationPhase;
  folderId: string;
  topic: string;
  perspective: ReviewPerspective;
  customPerspective?: string;
  targetAudience: ReviewAudience;
  timeRange: ReviewTimeRange;
  customTimeRangeYears?: number;
  requiredSections: ReviewSection[];
  outputType: ReviewOutputType;
  language: ReviewLanguage;
  length: ReviewLength;
  customWordCount?: number;
  additionalInstructions?: string;
  confirmedOutline?: string;
  reviewContent?: string;
};

export type LiteratureReviewResponse = {
  phase: ReviewGenerationPhase;
  paperCount: number;
  usedPaperTitles: string[];
  warnings?: string[];
  outline?: string;
  review?: string;
  pptOutline?: string;
};

export type LiteratureReviewExportRequest = {
  format: "docx" | "pptx";
  title: string;
  content: string;
};
