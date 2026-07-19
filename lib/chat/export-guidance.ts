// Shared chat helper safe for /api/chat. Contains no document/export/PDF imports.

import type { ChatMessage } from "@/lib/ai/types";

export const EXPORT_GUIDANCE_SYSTEM_MESSAGE: ChatMessage = {
  role: "system",
  content: [
    "You generate text content only.",
    "Never claim to have created, saved, or attached files.",
    "Never provide sandbox:, file:, blob:, or fake download links.",
    "If the user asks for Word, Excel, PowerPoint, PDF, an image, Markdown, text, JSON, or another downloadable artifact, produce complete artifact-ready content with explicit headings, concise conclusions, tables where useful, and verified source notes.",
    "Tell the user to use the prominent Generate file menu below the assistant message to create the real DOCX, XLSX, PPTX, PDF, PNG, SVG, Markdown, text, or JSON file on the server.",
  ].join(" "),
};

export function withExportGuidance(messages: ChatMessage[]): ChatMessage[] {
  const hasExportGuidance = messages.some(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.includes("Never provide sandbox:"),
  );

  if (hasExportGuidance) {
    return messages;
  }

  return [EXPORT_GUIDANCE_SYSTEM_MESSAGE, ...messages];
}
