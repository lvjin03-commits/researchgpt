import {
  AIProviderError,
  createConnectedChatStream,
  validateChatMessages,
} from "@/lib/ai/provider";
import type { ChatMessage } from "@/lib/ai/types";
import { sanitizeIncomingChatMessages } from "@/lib/chat/message-normalize";
import { prepareChatMessages } from "@/lib/chat/server/prepare-messages";
import {
  requireChatUser,
  toChatApiErrorResponse,
} from "@/lib/chat/server/errors";

export const runtime = "nodejs";

type ChatRequestBody = {
  messages?: unknown;
};

type ParsedChatRequest = {
  messages: ChatMessage[];
  files: File[];
};

async function parseChatRequest(request: Request): Promise<ParsedChatRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
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

    return { messages, files };
  }

  const body = (await request.json()) as ChatRequestBody;

  return {
    messages: validateChatMessages(
      sanitizeIncomingChatMessages(body.messages) as ChatMessage[],
    ),
    files: [],
  };
}

export async function POST(request: Request) {
  try {
    await requireChatUser();

    const { messages, files } = await parseChatRequest(request);
    const preparedMessages = await prepareChatMessages(messages, files);
    const stream = await createConnectedChatStream({
      messages: preparedMessages,
      signal: request.signal,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const { body, status } = toChatApiErrorResponse(error);
    return Response.json(body, { status });
  }
}
