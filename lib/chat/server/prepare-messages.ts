// Server-only module. Used by /api/chat/attachments only — not /api/chat.

import { AIProviderError } from "@/lib/ai/errors";
import type { ChatMessage } from "@/lib/ai/types";
import { getTextFromMessageContent } from "@/lib/ai/types";
import { withExportGuidance } from "@/lib/chat/export-guidance";
import { withResponseStyle } from "@/lib/chat/response-style";

import type { AttachmentInput } from "@/lib/uploads/types";
import type { AttachmentProcessingResult } from "@/lib/analysis/types";

export async function prepareChatMessages(
  messages: ChatMessage[],
  files: AttachmentInput[],
): Promise<{
  messages: ChatMessage[];
  fileResults: AttachmentProcessingResult[];
}> {
  let prepared = messages;
  let fileResults: AttachmentProcessingResult[] = [];

  if (files.length > 0) {
    const lastMessage = messages.at(-1);

    if (lastMessage?.role !== "user") {
      throw new AIProviderError("The last message must be from the user", {
        statusCode: 400,
      });
    }

    const userMessage = getTextFromMessageContent(lastMessage.content);
    const { injectAttachmentsIntoMessages } = await import(
      "@/lib/chat/server/attachments"
    );

    const result = await injectAttachmentsIntoMessages(
      messages,
      userMessage,
      files,
    );
    prepared = result.messages;
    fileResults = result.fileResults;
  }

  return {
    messages: withResponseStyle(withExportGuidance(prepared)),
    fileResults,
  };
}
