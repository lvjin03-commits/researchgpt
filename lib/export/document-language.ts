export type DocumentLanguage = "zh-CN" | "en-US";

const CHINESE_LANGUAGE_REQUEST =
  /(?:使用|用|输出|写成|生成|全文|文章|文档).{0,12}(?:中文|简体中文)|(?:中文|简体中文).{0,12}(?:输出|写作|撰写|生成|全文)/i;
const ENGLISH_LANGUAGE_REQUEST =
  /(?:use|write|output|generate|entire|full).{0,12}english|english.{0,12}(?:only|output|document|article)|(?:使用|用|输出|写成|生成|全文).{0,12}(?:英文|英语)/i;

function normalizedLanguage(value: unknown): DocumentLanguage | null {
  if (value === "zh-CN" || value === "zh" || value === "Chinese") return "zh-CN";
  if (value === "en-US" || value === "en" || value === "English") return "en-US";
  return null;
}

function languageByScript(value: string): DocumentLanguage | null {
  const chineseCount = (value.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinCount = (value.match(/[A-Za-z]/g) ?? []).length;
  if (chineseCount === 0 && latinCount === 0) return null;
  return chineseCount >= Math.max(4, latinCount * 0.35) ? "zh-CN" : "en-US";
}

export function resolveDocumentLanguage(input: {
  requestedLanguage?: unknown;
  query?: string;
  title?: string;
  content?: string;
}): DocumentLanguage {
  const explicit = normalizedLanguage(input.requestedLanguage);
  if (explicit) return explicit;

  const query = input.query?.trim() ?? "";
  if (CHINESE_LANGUAGE_REQUEST.test(query)) return "zh-CN";
  if (ENGLISH_LANGUAGE_REQUEST.test(query)) return "en-US";

  return (
    languageByScript(query) ??
    languageByScript(input.title ?? "") ??
    languageByScript((input.content ?? "").slice(0, 6000)) ??
    "en-US"
  );
}

export function documentLanguageInstruction(language: DocumentLanguage): string {
  return language === "zh-CN"
    ? "Document language contract: write the entire visible document in Simplified Chinese. Localize the title, headings, abstract label, keywords label, table and figure captions, source labels, notes, and references heading. English technical terms may appear only when scientifically necessary; do not mix English template labels or fallback prose into Chinese sections."
    : "Document language contract: write the entire visible document in English. Use English consistently for the title, headings, labels, captions, source statements, notes, and references.";
}
