import type { ExportFormat } from "../export/types";

const AUTHORITATIVE_OUTPUT_FORMATS: Partial<Record<string, ExportFormat>> = {
  word: "docx",
  excel: "xlsx",
  ppt: "pptx",
  pdf: "pdf",
};

export function resolveRequestedExportFormats(input: {
  routedOutputType: string;
  fallbackFormats: ExportFormat[];
  explicitlyRequestsFileCreation: boolean;
}): ExportFormat[] {
  const authoritativeFormat =
    AUTHORITATIVE_OUTPUT_FORMATS[input.routedOutputType];

  if (authoritativeFormat) {
    return [authoritativeFormat];
  }

  const fallbackFormats = Array.from(new Set(input.fallbackFormats));
  if (fallbackFormats.length > 0) {
    return fallbackFormats;
  }

  return input.explicitlyRequestsFileCreation ? ["docx"] : [];
}
