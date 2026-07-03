export const MAX_DOCX_TRANSLATION_BYTES = 20 * 1024 * 1024;

export const MAX_DOCX_TRANSLATION_MB = MAX_DOCX_TRANSLATION_BYTES / (1024 * 1024);

export const MAX_TRANSLATABLE_PARAGRAPHS = 800;

export const MAX_TRANSLATABLE_CHARS = 300_000;

export const BATCH_MAX_ITEMS = 10;

export const BATCH_MAX_CHARS = 6_000;

export const SOURCE_LANGUAGE_OPTIONS = [
  { value: "auto", label: "自动检测" },
  { value: "chinese", label: "中文" },
  { value: "english", label: "英文" },
] as const;

export const TARGET_LANGUAGE_OPTIONS = [
  { value: "chinese", label: "中文" },
  { value: "english", label: "英文" },
] as const;

export const OUTPUT_MODE_OPTIONS = [
  {
    value: "replace",
    label: "替换原文",
    description: "用译文替换每个段落。",
  },
  {
    value: "bilingual",
    label: "双语对照",
    description: "保留原文，并在下方添加译文。",
  },
] as const;

export const STYLE_OPTIONS = [
  { value: "academic", label: "学术" },
  { value: "sci-paper", label: "SCI 论文" },
  { value: "technical", label: "技术文档" },
  { value: "general", label: "通用" },
] as const;
