// Server-only module. Do not import from client components or /api/chat route entry.

import type { TruncateResult } from "@/lib/documents/truncate";

export type DocumentContext = {
  fileName: string;
  text: string;
  truncated: boolean;
  originalLength: number;
};

export function buildDocumentContext({
  fileName,
  text,
  truncated,
  originalLength,
}: DocumentContext): string {
  const lines = [`--- Document: ${fileName} ---`];

  if (truncated) {
    lines.push(
      `[Note: The document text was truncated from ${originalLength.toLocaleString()} characters due to length limits. Only the beginning of the document is included below.]`,
    );
  }

  lines.push(text, "--- End Document ---");
  return lines.join("\n");
}

export function augmentUserMessageWithDocuments(
  userMessage: string,
  documents: DocumentContext[],
): string {
  const trimmedMessage = userMessage.trim();
  const documentBlocks = documents.map(buildDocumentContext).join("\n\n");

  let message = trimmedMessage;

  if (!message) {
    if (documents.length > 1) {
      message = "请分析附件文档。";
    } else if (documents.length === 1) {
      message = "请分析附件文档。";
    }
  }

  if (!documentBlocks) {
    return message;
  }

  if (!message) {
    return documentBlocks;
  }

  return `${message}\n\n${documentBlocks}`;
}

export function augmentUserMessageWithDocument(
  userMessage: string,
  document: DocumentContext,
): string {
  return augmentUserMessageWithDocuments(userMessage, [document]);
}

export function toDocumentContext(
  fileName: string,
  truncateResult: TruncateResult,
): DocumentContext {
  return {
    fileName,
    text: truncateResult.text,
    truncated: truncateResult.truncated,
    originalLength: truncateResult.originalLength,
  };
}
