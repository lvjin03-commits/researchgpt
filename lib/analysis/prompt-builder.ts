// Server-only module. Do not import from client components or /api/chat route entry.

import type { ChatMessage, MessageContentPart } from "@/lib/ai/types";
import {
  augmentUserMessageWithDocuments,
  toDocumentContext,
} from "@/lib/documents/prompt";

import type { AnalysisEvidence } from "./types";

export function buildDefaultUserMessage(
  userMessage: string,
  imageCount: number,
  documentCount: number,
): string {
  const trimmed = userMessage.trim();

  if (trimmed) {
    return trimmed;
  }

  if (imageCount > 0 && documentCount > 0) {
    return "Please analyze the attached files.";
  }

  if (imageCount > 1) {
    return "Please analyze the attached images.";
  }

  if (imageCount === 1) {
    return "Please analyze the attached image.";
  }

  if (documentCount > 1) {
    return "Please analyze the attached documents.";
  }

  if (documentCount === 1) {
    return "Please analyze the attached document.";
  }

  return trimmed;
}

export function buildUserMessageWithEvidence(
  userMessage: string,
  evidence: AnalysisEvidence,
): string {
  const messageBody = buildDefaultUserMessage(
    userMessage,
    evidence.images.length,
    evidence.documents.length,
  );

  return augmentUserMessageWithDocuments(
    messageBody,
    evidence.documents.map((document) =>
      toDocumentContext(document.fileName, {
        text: document.text,
        truncated: document.truncated,
        originalLength: document.originalLength,
      }),
    ),
  );
}

export function applyEvidenceToMessages(
  messages: ChatMessage[],
  userMessage: string,
  evidence: AnalysisEvidence,
): ChatMessage[] {
  const textBody = buildUserMessageWithEvidence(userMessage, evidence);
  const updated = [...messages];
  const lastIndex = updated.length - 1;

  if (evidence.images.length === 0) {
    updated[lastIndex] = {
      role: "user",
      content: textBody,
    };
    return updated;
  }

  const content: MessageContentPart[] = [{ type: "text", text: textBody }];

  for (const image of evidence.images) {
    content.push({
      type: "image_url",
      image_url: {
        url: image.dataUrl,
        detail: "auto",
      },
    });
  }

  updated[lastIndex] = {
    role: "user",
    content,
  };

  return updated;
}
