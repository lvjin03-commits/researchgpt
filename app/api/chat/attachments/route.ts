import { AIProviderError, validateChatMessages } from "@/lib/ai/provider";
import type { ChatMessage } from "@/lib/ai/types";
import { sanitizeIncomingChatMessages } from "@/lib/chat/message-normalize";
import { prepareChatMessages } from "@/lib/chat/server/prepare-messages";
import {
  requireChatUser,
  toChatApiErrorResponse,
} from "@/lib/chat/server/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireChatUser();

    const formData = await request.formData();
    const messagesField = formData.get("messages");

    if (typeof messagesField !== "string") {
      throw new AIProviderError("messages field is required", {
        statusCode: 400,
      });
    }

    let parsedMessages: unknown;

    try {
      parsedMessages = JSON.parse(messagesField);
    } catch {
      throw new AIProviderError("messages must be valid JSON", {
        statusCode: 400,
      });
    }

    const messages = validateChatMessages(
      sanitizeIncomingChatMessages(parsedMessages) as ChatMessage[],
    );

    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (files.length === 0) {
      throw new AIProviderError("At least one file is required", {
        statusCode: 400,
      });
    }

    const preparedMessages = await prepareChatMessages(messages, files);

    return Response.json({ messages: preparedMessages });
  } catch (error) {
    const { body, status } = toChatApiErrorResponse(error);
    return Response.json(body, { status });
  }
}
