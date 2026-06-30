export const MAX_DOCX_TRANSLATION_BYTES = 20 * 1024 * 1024;

export const MAX_DOCX_TRANSLATION_MB = MAX_DOCX_TRANSLATION_BYTES / (1024 * 1024);

export const MAX_TRANSLATABLE_PARAGRAPHS = 800;

export const MAX_TRANSLATABLE_CHARS = 300_000;

export const BATCH_MAX_ITEMS = 10;

export const BATCH_MAX_CHARS = 6_000;

export const SOURCE_LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto detect" },
  { value: "chinese", label: "Chinese" },
  { value: "english", label: "English" },
] as const;

export const TARGET_LANGUAGE_OPTIONS = [
  { value: "chinese", label: "Chinese" },
  { value: "english", label: "English" },
] as const;

export const OUTPUT_MODE_OPTIONS = [
  {
    value: "replace",
    label: "Replace original text",
    description: "Replace each paragraph with the translation.",
  },
  {
    value: "bilingual",
    label: "Bilingual",
    description: "Keep the original paragraph and add the translation below it.",
  },
] as const;

export const STYLE_OPTIONS = [
  { value: "academic", label: "Academic" },
  { value: "sci-paper", label: "SCI paper" },
  { value: "technical", label: "Technical document" },
  { value: "general", label: "General" },
] as const;
