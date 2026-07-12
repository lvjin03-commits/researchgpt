import type {
  SourceLanguage,
  TargetLanguage,
  TranslationStyle,
} from "@/lib/translation/types";

const STYLE_INSTRUCTIONS: Record<TranslationStyle, string> = {
  academic:
    "Use formal academic language, precise terminology, and neutral tone suitable for scholarly writing.",
  "sci-paper":
    "Use concise SCI journal style: clear, objective, and suitable for scientific publication.",
  technical:
    "Use precise technical terminology and maintain clarity for professional documentation.",
  general:
    "Use natural, readable language while preserving the original meaning.",
};

function resolveSourceLanguage(sourceLanguage: SourceLanguage): string {
  if (sourceLanguage === "auto") {
    return "Detect the source language automatically.";
  }

  if (sourceLanguage === "chinese") {
    return "The source language is Chinese.";
  }

  return "The source language is English.";
}

function resolveTargetLanguage(targetLanguage: TargetLanguage): string {
  return targetLanguage === "chinese"
    ? "Translate into Simplified Chinese."
    : "Translate into English.";
}

export function buildTranslationSystemPrompt(
  options: {
    sourceLanguage: SourceLanguage;
    targetLanguage: TargetLanguage;
    style: TranslationStyle;
  },
): string {
  return [
    "You are a professional document translator.",
    resolveSourceLanguage(options.sourceLanguage),
    resolveTargetLanguage(options.targetLanguage),
    STYLE_INSTRUCTIONS[options.style],
    "Rules:",
    "- Translate faithfully into polished academic English without adding, deleting, or strengthening any scientific claim.",
    "- Preserve uncertainty, limitations, logical relationships, and the strength of the original statement.",
    "- Keep author names, chemical formulas, gene names, material names, model names, dataset names, and standard technical abbreviations in their conventional original form.",
    "- Use one consistent English translation for the same technical term throughout the document.",
    "- Preserve numbers, URLs, emails, DOI strings, figure/table labels, and citation markers exactly as provided when they appear inside a segment.",
    "- Do not add commentary or explanations.",
    "- Return ONLY valid JSON: an array of objects with keys id and translation.",
  ].join("\n");
}

export function buildTranslationUserPrompt(
  items: { id: string; text: string }[],
): string {
  return JSON.stringify(items, null, 2);
}
