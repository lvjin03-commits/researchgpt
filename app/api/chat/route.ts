import {
  AIProviderError,
  createConnectedChatStream,
  validateChatMessages,
} from "@/lib/ai/provider";
import type { ChatMessage } from "@/lib/ai/types";
import { withExportGuidance } from "@/lib/chat/export-guidance";
import { sanitizeIncomingChatMessages } from "@/lib/chat/message-normalize";
import {
  requireChatUser,
  toChatApiErrorResponse,
} from "@/lib/chat/server/errors";

export const runtime = "nodejs";

type ChatRequestBody = {
  messages?: unknown;
};

export async function POST(request: Request) {
  try {
    await requireChatUser();

    const body = (await request.json()) as ChatRequestBody;
    const messages = withExportGuidance(
      validateChatMessages(
        sanitizeIncomingChatMessages(body.messages) as ChatMessage[],
      ),
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
