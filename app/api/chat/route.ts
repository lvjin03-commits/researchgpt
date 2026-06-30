import {
  AIProviderError,
  createConnectedChatStream,
  validateChatMessages,
} from "@/lib/ai/provider";
import { injectAttachmentsIntoMessages } from "@/lib/attachments/prepare";
import { getTextFromMessageContent } from "@/lib/ai/types";
import type { ChatMessage } from "@/lib/ai/types";
import { sanitizeIncomingChatMessages } from "@/lib/chat/message-normalize";
import { withExportGuidance } from "@/lib/export/chat-guidance";
import { createClient } from "@/lib/supabase/server";
import { UploadError } from "@/lib/uploads/errors";

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

    console.error("[api/chat] Raw multipart messages payload:", parsedMessages);

    const messages = validateChatMessages(
      sanitizeIncomingChatMessages(parsedMessages) as ChatMessage[],
    );
    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    return { messages, files };
  }

  const body = (await request.json()) as ChatRequestBody;

  console.error("[api/chat] Raw JSON messages payload:", body.messages);

  return {
    messages: validateChatMessages(
      sanitizeIncomingChatMessages(body.messages) as ChatMessage[],
    ),
    files: [],
  };
}

async function prepareMessages(
  messages: ChatMessage[],
  files: File[],
): Promise<ChatMessage[]> {
  if (files.length === 0) {
    return messages;
  }

  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== "user") {
    throw new AIProviderError("The last message must be from the user", {
      statusCode: 400,
    });
  }

  const userMessage = getTextFromMessageContent(lastMessage.content);
  return injectAttachmentsIntoMessages(messages, userMessage, files);
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AIProviderError("Unauthorized", { statusCode: 401 });
  }

  return user;
}

export async function POST(request: Request) {
  try {
    await requireUser();

    const { messages, files } = await parseChatRequest(request);

    console.error("[api/chat] Request payload summary:", {
      messageCount: messages.length,
      fileCount: files.length,
      roles: messages.map((message) => message.role),
      contentLengths: messages.map((message) => message.content.length),
    });

    const preparedMessages = withExportGuidance(
      await prepareMessages(messages, files),
    );
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
    if (error instanceof AIProviderError) {
      return Response.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    if (error instanceof UploadError) {
      return Response.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    if (error instanceof SyntaxError) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    console.error("[api/chat] Unexpected error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
