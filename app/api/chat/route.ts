import { validateChatMessages } from "@/lib/ai/provider";
import { openResponsesChatStream } from "@/lib/ai/openai";
import type { ChatMessage } from "@/lib/ai/types";
import {
  DEFAULT_CHAT_MODEL_TIER,
  getChatModelOption,
  isChatModelTier,
} from "@/lib/ai/chat-models";
import { withExportGuidance } from "@/lib/chat/export-guidance";
import { withModelIdentity } from "@/lib/chat/model-identity";
import { sanitizeIncomingChatMessages } from "@/lib/chat/message-normalize";
import { withResponseStyle } from "@/lib/chat/response-style";
import { routeChatTask } from "@/lib/chat/task-router";
import { withScientificVisualPolicy } from "@/lib/chat/visual-policy";
import {
  requireChatUser,
  toChatApiErrorResponse,
} from "@/lib/chat/server/errors";
import { buildLiteratureLibraryContext } from "@/lib/chat/server/library-context";
import { encodeChatStreamEvent } from "@/lib/chat/stream-protocol";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ChatRequestBody = {
  messages?: unknown;
  modelTier?: unknown;
  webSearch?: unknown;
  useLibrary?: unknown;
  memory?: unknown;
};

export async function POST(request: Request) {
  try {
    const user = await requireChatUser();
    const body = (await request.json()) as ChatRequestBody;
    const modelTier = isChatModelTier(body.modelTier)
      ? body.modelTier
      : DEFAULT_CHAT_MODEL_TIER;
    const modelOption = getChatModelOption(modelTier);
    const webSearch = body.webSearch === true;
    const useLibrary = body.useLibrary === true;
    const memory =
      typeof body.memory === "string" ? body.memory.trim().slice(0, 2000) : "";
    const sanitized = sanitizeIncomingChatMessages(body.messages);

    let messages = withResponseStyle(
      withModelIdentity(
        withExportGuidance(validateChatMessages(sanitized as ChatMessage[])),
        modelOption.model,
      ),
    );

    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const query =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : lastUserMessage?.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n") ?? "";
    const taskRoute = routeChatTask(messages);
    const effectiveWebSearch = webSearch || taskRoute.autoWebSearch;
    messages = withScientificVisualPolicy(
      [
        { role: "system", content: taskRoute.systemInstruction },
        ...messages,
      ],
      modelOption,
    );

    let libraryStatus = "";
    if (useLibrary) {
      const supabase = await createClient();
      const library = await buildLiteratureLibraryContext(supabase, user.id, query);
      libraryStatus = `已从文献库匹配 ${library.paperCount} 篇相关文献`;
      messages = [
        {
          role: "system",
          content: [
            "回答时优先使用以下用户文献库证据。必须区分PDF全文与摘要证据。",
            "引用文献库内容时使用格式：[文献题目，文献ID]。不要编造页码。",
            library.context || "没有匹配到相关文献。",
          ].join("\n\n"),
        },
        ...messages,
      ];
    }

    if (memory) {
      messages = [
        {
          role: "system",
          content: `用户明确保存的偏好（仅用于调整回答方式，不可视为事实证据）：${memory}`,
        },
        ...messages,
      ];
    }

    console.log("[api/chat] request", {
      model: modelOption.model,
      messageCount: messages.length,
      webSearch: effectiveWebSearch,
      useLibrary,
      task: taskRoute.kind,
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (useLibrary) {
            controller.enqueue(
              encodeChatStreamEvent({ type: "status", message: libraryStatus }),
            );
          }
          controller.enqueue(
            encodeChatStreamEvent({
              type: "status",
              message: taskRoute.status,
            }),
          );

          for await (const event of openResponsesChatStream({
            messages,
            signal: request.signal,
            model: modelOption.model,
            reasoningEffort: modelOption.reasoningEffort,
            webSearch: effectiveWebSearch,
            codeInterpreter: taskRoute.useCodeInterpreter,
            maxOutputTokens: modelOption.maxOutputTokens,
          })) {
            controller.enqueue(encodeChatStreamEvent(event));
          }
          controller.close();
        } catch (error) {
          const mapped = toChatApiErrorResponse(error);
          controller.enqueue(
            encodeChatStreamEvent({
              type: "error",
              message: mapped.body.error,
              code: mapped.body.code,
            }),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
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
