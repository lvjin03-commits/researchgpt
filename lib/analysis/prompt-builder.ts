// Server-only module. Do not import from client components or /api/chat route entry.

import type { ChatMessage, MessageContentPart } from "@/lib/ai/types";
import {
  augmentUserMessageWithDocuments,
  toDocumentContext,
} from "@/lib/documents/prompt";

import type { AnalysisEvidence } from "./types";

const ANALYSIS_GUIDANCE_MARKER =
  "Prefer expert analysis over generic overview";

export const ANALYSIS_SYSTEM_MESSAGE: ChatMessage = {
  role: "system",
  content: [
    "You are an expert analyst reviewing user-provided documents and images.",
    "Do not merely summarize.",
    "First identify the document type and the user's intent.",
    "Analyze structure, evidence, assumptions, strengths, weaknesses, and implications.",
    "When answering about documents, cite or reference specific sections, headings, or passages when possible.",
    "Prefer expert analysis over generic overview.",
    "If the user asks a broad question, produce a structured analytical report.",
    "Keep responses concise unless the user explicitly asks for detail.",
    "",
    "When the document appears to be a research paper, include where relevant:",
    "Core thesis; Problem addressed; Method/strategy; Key evidence; Novelty; Limitations; Practical value; Critical evaluation; One-sentence takeaway.",
    "",
    "When the document appears to be an SOP or procedure, include where relevant:",
    "Purpose; Scope; Process flow; Responsibilities; Risks; Missing controls; Improvement suggestions.",
  ].join("\n"),
};

export function withAnalysisGuidance(
  messages: ChatMessage[],
  evidence: AnalysisEvidence,
): ChatMessage[] {
  const hasAttachments =
    evidence.documents.length > 0 || evidence.images.length > 0;

  if (!hasAttachments) {
    return messages;
  }

  const hasAnalysisGuidance = messages.some(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.includes(ANALYSIS_GUIDANCE_MARKER),
  );

  if (hasAnalysisGuidance) {
    return messages;
  }

  return [ANALYSIS_SYSTEM_MESSAGE, ...messages];
}

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
  const withGuidance = withAnalysisGuidance(messages, evidence);
  const textBody = buildUserMessageWithEvidence(userMessage, evidence);
  const updated = [...withGuidance];
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
