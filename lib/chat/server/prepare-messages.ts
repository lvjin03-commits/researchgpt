// Server-only module. Used by /api/chat/attachments only — not /api/chat.

import { AIProviderError } from "@/lib/ai/errors";
import type { ChatMessage } from "@/lib/ai/types";
import { getTextFromMessageContent } from "@/lib/ai/types";
import { withExportGuidance } from "@/lib/chat/export-guidance";
import { withResponseStyle } from "@/lib/chat/response-style";

import type { AttachmentInput } from "@/lib/uploads/types";

export async function prepareChatMessages(
  messages: ChatMessage[],
  files: AttachmentInput[],
): Promise<ChatMessage[]> {
  let prepared = messages;

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

    prepared = await injectAttachmentsIntoMessages(
      messages,
      userMessage,
      files,
    );
  }

  return withResponseStyle(withExportGuidance(prepared));
}
