import type {
  REVIEW_AUDIENCE_OPTIONS,
  REVIEW_LANGUAGE_OPTIONS,
  REVIEW_LENGTH_OPTIONS,
  REVIEW_OUTPUT_TYPE_OPTIONS,
  REVIEW_PERSPECTIVE_OPTIONS,
  REVIEW_SECTION_OPTIONS,
  REVIEW_MODEL_OPTIONS,
} from "@/lib/literature/review/constants";

export type ReviewPerspective = (typeof REVIEW_PERSPECTIVE_OPTIONS)[number];
export type ReviewAudience = (typeof REVIEW_AUDIENCE_OPTIONS)[number];
export type ReviewSection = (typeof REVIEW_SECTION_OPTIONS)[number];
export type ReviewOutputType = (typeof REVIEW_OUTPUT_TYPE_OPTIONS)[number];
export type ReviewLanguage = (typeof REVIEW_LANGUAGE_OPTIONS)[number];
export type ReviewLength = (typeof REVIEW_LENGTH_OPTIONS)[number];
export type ReviewModel = (typeof REVIEW_MODEL_OPTIONS)[number]["id"];

export type ReviewGenerationPhase = "matrix" | "themes" | "outline" | "ppt";
export type ReviewWorkflowMode = "quick_outline" | "academic_review";

export type LiteratureMatrixRow = {
  paperId: string;
  citation: string;
  researchTopic: string;
  researchProblem: string;
  researchObject: string;
  researchMethod: string;
  keyResults: string;
  conclusion: string;
  coreIdea: string;
  limitations: string;
  reviewRelation: string;
  evidenceLevel: "full_text" | "abstract_only";
};

export type LiteratureReviewRequest = {
  phase: ReviewGenerationPhase;
  workflowMode: ReviewWorkflowMode;
  model: ReviewModel;
  folderId: string;
  topic: string;
  perspective: ReviewPerspective;
  customPerspective?: string;
  targetAudience: ReviewAudience;
  requiredSections: ReviewSection[];
  outputType: ReviewOutputType;
  language: ReviewLanguage;
  length: ReviewLength;
  customWordCount?: number;
  additionalInstructions?: string;
  confirmedThemes?: string;
  confirmedOutline?: string;
  /** Display name of the selected folder (logging / name-to-id resolution). */
  folderName?: string;
  /** Client-side folder paper count from GET /api/literature/library (for mismatch logging). */
  uiPaperCount?: number;
};

export type LiteratureReviewResponse = {
  phase: ReviewGenerationPhase;
  paperCount: number;
  usedPaperTitles: string[];
  matrix?: LiteratureMatrixRow[];
  themes?: string;
  outline?: string;
  pptOutline?: string;
};

export type LiteratureReviewExportRequest = {
  format: "docx" | "pptx";
  title: string;
  content: string;
};
