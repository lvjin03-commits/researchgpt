import {
  AIProviderError,
  createConnectedChatStream,
  validateChatMessages,
} from "@/lib/ai/provider";
import type { ChatMessage, MessageContent } from "@/lib/ai/types";
import { withExportGuidance } from "@/lib/chat/export-guidance";
import { withModelIdentity } from "@/lib/chat/model-identity";
import { sanitizeIncomingChatMessages } from "@/lib/chat/message-normalize";
import {
  requireChatUser,
  toChatApiErrorResponse,
} from "@/lib/chat/server/errors";

export const runtime = "nodejs";

type ChatRequestBody = {
  messages?: unknown;
};

function summarizeContentForDebug(content: MessageContent): unknown {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }

    const url = part.image_url.url;
    const preview =
      url.length > 80 ? `${url.slice(0, 80)}… (${url.length} chars)` : url;

    return {
      type: "image_url",
      image_url: { url: preview, detail: part.image_url.detail },
    };
  });
}

function summarizeMessagesForDebug(messages: unknown): unknown {
  if (!Array.isArray(messages)) {
    return messages;
  }

  return messages.map((message) => {
    if (typeof message !== "object" || message === null) {
      return message;
    }

    const record = message as Record<string, unknown>;
    return {
      role: record.role,
      content: summarizeContentForDebug(record.content as MessageContent),
    };
  });
}

export async function POST(request: Request) {
  try {
    await requireChatUser();

    const body = (await request.json()) as ChatRequestBody;

    console.log(
      "[api/chat] before sanitize:",
      JSON.stringify(summarizeMessagesForDebug(body.messages)),
    );

    const sanitized = sanitizeIncomingChatMessages(body.messages);

    console.log(
      "[api/chat] after sanitize:",
      JSON.stringify(summarizeMessagesForDebug(sanitized)),
    );

    const messages = withModelIdentity(
      withExportGuidance(validateChatMessages(sanitized as ChatMessage[])),
    );

    console.log(
      "[api/chat] before OpenAI call:",
      JSON.stringify(summarizeMessagesForDebug(messages)),
    );

    const stream = await createConnectedChatStream({
      messages,
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
