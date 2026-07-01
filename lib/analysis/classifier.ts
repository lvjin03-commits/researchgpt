// Server-only module. Do not import from client components or /api/chat route entry.

import {
  getFileExtension,
  isDocumentExtension,
  isImageExtension,
} from "@/lib/uploads/constants";

export type AttachmentClassification =
  | "image"
  | "pdf"
  | "document"
  | "unsupported";

export function classifyAttachment(fileName: string): AttachmentClassification {
  const extension = getFileExtension(fileName);

  if (isImageExtension(extension)) {
    return "image";
  }

  if (extension === ".pdf") {
    return "pdf";
  }

  if (isDocumentExtension(extension)) {
    return "document";
  }

  return "unsupported";
}

export function describeParser(
  classification: AttachmentClassification,
  fileName: string,
): string {
  if (classification === "image") {
    return "image";
  }

  if (classification === "pdf") {
    return "document.pdf";
  }

  if (classification === "document") {
    const extension = getFileExtension(fileName);
    return `document${extension}`;
  }

  return "unsupported";
}

export function parseStageForClassification(
  classification: AttachmentClassification,
  fileName: string,
): string {
  const extension = getFileExtension(fileName);

  switch (classification) {
    case "image":
      return "parse_image";
    case "pdf":
      return "parse_document.pdf";
    case "document":
      return `parse_document${extension}`;
    case "unsupported":
      return "unsupported";
  }
}
