// Server-only module. Do not import from client components or /api/chat route entry.

import type { ChatMessage } from "@/lib/ai/types";
import { UploadError } from "@/lib/uploads/errors";
import type { AttachmentInput } from "@/lib/uploads/types";
import type { AnalysisResult } from "@/lib/analysis/types";

export async function injectAttachmentsIntoMessages(
  messages: ChatMessage[],
  userMessage: string,
  files: AttachmentInput[],
): Promise<AnalysisResult> {
  if (messages.length === 0) {
    throw new UploadError("messages must be a non-empty array");
  }

  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.role !== "user") {
    throw new UploadError("The last message must be from the user");
  }

  if (files.length === 0) {
    return {
      messages,
      evidence: { documents: [], images: [] },
      fileResults: [],
    };
  }

  const { createDefaultAnalysisEngine } = await import("@/lib/analysis/engine");
  const engine = createDefaultAnalysisEngine();
  return engine.analyze({
    messages,
    userMessage,
    files,
  });
}
