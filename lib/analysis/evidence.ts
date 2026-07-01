// Server-only module. Do not import from client components or /api/chat route entry.

import type { ParsedDocument } from "@/lib/documents/types";
import type { ParsedImage } from "@/lib/images/image";

import type { AnalysisEvidence, ImageEvidence, StructuredDocument } from "./types";

export function structuredDocumentFromParsed(
  document: ParsedDocument,
): StructuredDocument {
  return {
    fileName: document.fileName,
    text: document.text,
    truncated: document.truncated,
    originalLength: document.originalLength,
  };
}

export function imageEvidenceFromParsed(image: ParsedImage): ImageEvidence {
  return {
    fileName: image.fileName,
    dataUrl: image.dataUrl,
    mimeType: image.mimeType,
  };
}

export function buildAnalysisEvidence(
  documents: StructuredDocument[],
  images: ImageEvidence[],
): AnalysisEvidence {
  return { documents, images };
}

export function emptyAnalysisEvidence(): AnalysisEvidence {
  return { documents: [], images: [] };
}
