import type { DocumentRequest } from "../contracts";

export const DOCUMENT_LANGUAGE_CONTRACT_VERSION =
  "document-language-contract-v1" as const;

export type DocumentPlanningLanguageContract = Readonly<{
  documentLanguage: DocumentRequest["language"];
  documentLanguageName: "Simplified Chinese" | "English";
  languageContractVersion: typeof DOCUMENT_LANGUAGE_CONTRACT_VERSION;
  documentLanguageInstruction: string;
}>;

export function createDocumentPlanningLanguageContract(
  language: DocumentRequest["language"],
): DocumentPlanningLanguageContract {
  if (language === "zh") {
    return Object.freeze({
      documentLanguage: language,
      documentLanguageName: "Simplified Chinese",
      languageContractVersion: DOCUMENT_LANGUAGE_CONTRACT_VERSION,
      documentLanguageInstruction:
        "All user-visible titles, headings, research questions, section purposes, scope descriptions, and explanatory text must use Simplified Chinese. Standard English abbreviations and technical terms may be retained when necessary, but headings must not be English-only.",
    });
  }

  return Object.freeze({
    documentLanguage: language,
    documentLanguageName: "English",
    languageContractVersion: DOCUMENT_LANGUAGE_CONTRACT_VERSION,
    documentLanguageInstruction:
      "All user-visible titles, headings, research questions, section purposes, scope descriptions, and explanatory text must use English. Standard technical symbols and abbreviations may be retained, but headings must not be Chinese-only.",
  });
}

export function headingUsesDocumentLanguage(
  heading: string,
  language: DocumentRequest["language"],
) {
  const hanCount = heading.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinWordCount = heading.match(/[A-Za-z]+/g)?.length ?? 0;

  if (language === "zh") {
    if (hanCount >= 2) return true;
    if (hanCount === 0 && latinWordCount >= 2) return false;
    return hanCount > 0;
  }

  if (latinWordCount >= 2) return true;
  if (latinWordCount === 0 && hanCount >= 2) return false;
  return latinWordCount > 0;
}
