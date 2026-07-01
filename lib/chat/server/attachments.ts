// Server-only module. Do not import from client components or /api/chat route entry.

import type { ChatMessage } from "@/lib/ai/types";
import { UploadError } from "@/lib/uploads/errors";
import type { AttachmentInput } from "@/lib/uploads/types";

export async function injectAttachmentsIntoMessages(
  messages: ChatMessage[],
  userMessage: string,
  files: AttachmentInput[],
): Promise<ChatMessage[]> {
  if (messages.length === 0) {
    throw new UploadError("messages must be a non-empty array");
  }

  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.role !== "user") {
    throw new UploadError("The last message must be from the user");
  }

  if (files.length === 0) {
    return messages;
  }

  const { createDefaultAnalysisEngine } = await import("@/lib/analysis/engine");
  const engine = createDefaultAnalysisEngine();
  const { messages: updated } = await engine.analyze({
    messages,
    userMessage,
    files,
  });

  return updated;
}
