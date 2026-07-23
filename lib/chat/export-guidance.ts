// Shared chat helper safe for /api/chat. Contains no document/export/PDF imports.

import type { ChatMessage } from "@/lib/ai/types";

export const EXPORT_GUIDANCE_SYSTEM_MESSAGE: ChatMessage = {
  role: "system",
  content: [
    "When the user asks for Word, Excel, PowerPoint, PDF, Markdown, text, JSON, SVG, PNG, or another downloadable artifact, produce clean artifact-ready content that can be rendered by the server export pipeline.",
    "Do not tell the user to manually use the Generate file menu as the primary path.",
    "The server may automatically create real download links after your answer when the requested output format is supported.",
    "If multiple file formats are requested, structure the content so it can be reused across those formats.",
    "Never provide sandbox:, file:, blob:, or fake download links.",
    "Use explicit headings, concise conclusions, valid Markdown tables where useful, and verified source notes.",
  ].join(" "),
};

export function withExportGuidance(messages: ChatMessage[]): ChatMessage[] {
  const hasExportGuidance = messages.some(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.includes("server export pipeline"),
  );

  if (hasExportGuidance) {
    return messages;
  }

  return [EXPORT_GUIDANCE_SYSTEM_MESSAGE, ...messages];
}
