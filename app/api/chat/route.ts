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
import {
  applyChatContextBudget,
  insertContextBeforeLastUser,
} from "@/lib/chat/context-budget";
import {
  assertDailyAiBudgetAvailable,
  recordAiUsage,
} from "@/lib/ai/usage-ledger";
import type { WorkspaceContextMode } from "@/lib/chat/workspace";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ChatRequestBody = {
  messages?: unknown;
  modelTier?: unknown;
  webSearch?: unknown;
  useLibrary?: unknown;
  memory?: unknown;
  selectedFolderIds?: unknown;
  contextMode?: unknown;
  projectName?: unknown;
};

function isContextMode(value: unknown): value is WorkspaceContextMode {
  return value === "auto" || value === "project" || value === "temporary";
}

function sanitizeFolderIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 20);
}

export async function POST(request: Request) {
  try {
    const user = await requireChatUser();
    const supabase = await createClient();
    await assertDailyAiBudgetAvailable(supabase, user.id);
    const body = (await request.json()) as ChatRequestBody;
    const modelTier = isChatModelTier(body.modelTier)
      ? body.modelTier
      : DEFAULT_CHAT_MODEL_TIER;
    const modelOption = getChatModelOption(modelTier);
    const webSearch = body.webSearch === true;
    const useLibrary = body.useLibrary === true;
    const selectedFolderIds = sanitizeFolderIds(body.selectedFolderIds);
    const contextMode = isContextMode(body.contextMode)
      ? body.contextMode
      : "auto";
    const projectName =
      typeof body.projectName === "string"
        ? body.projectName.trim().slice(0, 120)
        : "";
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
    const projectReferencePattern =
      /(这些|上述|本项目|当前项目|文件夹|文献|论文|数据|实验|分析|比较|矩阵|大纲|汇报|PPT|综述|this project|these papers|folder|literature|paper|dataset|analysis)/i;
    const shouldUseProjectContext =
      contextMode === "project" ||
      (contextMode === "auto" &&
        selectedFolderIds.length > 0 &&
        projectReferencePattern.test(query));
    const effectiveUseLibrary =
      contextMode !== "temporary" &&
      (useLibrary || shouldUseProjectContext);
    const effectiveWebSearch = webSearch || taskRoute.autoWebSearch;

    messages = withScientificVisualPolicy(
      [
        {
          role: "system",
          content: [
            taskRoute.systemInstruction,
            "你不能声称已经新建、重命名、删除或移动文献库中的任何对象。文献库变更必须由界面的文献库操作工具实际执行并返回成功结果；如果用户的指令没有被工具识别，请要求用户明确文件夹和文献名称。",
          ].join("\n\n"),
        },
        ...messages,
      ],
      modelOption,
    );

    let libraryStatus = "";
    if (effectiveUseLibrary) {
      const library = await buildLiteratureLibraryContext(
        supabase,
        user.id,
        query,
        selectedFolderIds,
      );
      libraryStatus = selectedFolderIds.length
        ? `已从选中文件夹匹配 ${library.paperCount} 篇相关文献`
        : `已从文献库匹配 ${library.paperCount} 篇相关文献`;
      const libraryContextMessage: ChatMessage = {
          role: "user",
          content: [
            projectName ? `当前科研项目：${projectName}` : "",
            selectedFolderIds.length
              ? "只使用用户本次选中文件夹内的文献证据，不要扩展到文献库其他文件夹。"
              : "回答时优先使用以下用户文献库证据。",
            "必须明确区分 PDF 全文证据与摘要证据。引用文献库内容时使用格式：[文献题目，文献 ID]，不要编造页码。",
            library.context || "没有匹配到相关文献。",
          ]
            .filter(Boolean)
            .join("\n\n"),
        };
      messages = insertContextBeforeLastUser(messages, libraryContextMessage);
    }

    if (contextMode === "temporary") {
      messages = [
        {
          role: "system",
          content:
            "这是一个临时问题。不要引用或推断当前科研项目、已选文件夹或先前项目任务中的事实；只根据本条问题和用户本次明确上传的文件回答。",
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

    messages = applyChatContextBudget(messages, modelTier);

    console.log("[api/chat] request", {
      model: modelOption.model,
      messageCount: messages.length,
      webSearch: effectiveWebSearch,
      useLibrary: effectiveUseLibrary,
      contextMode,
      selectedFolderCount: selectedFolderIds.length,
      task: taskRoute.kind,
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (effectiveUseLibrary) {
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
            provider: modelOption.provider,
            reasoningEffort: modelOption.reasoningEffort,
            webSearch:
              modelOption.provider === "openai" ? effectiveWebSearch : false,
            codeInterpreter:
              modelOption.provider === "openai"
                ? taskRoute.useCodeInterpreter
                : false,
            maxOutputTokens: modelOption.maxOutputTokens,
            promptCacheKey: `chat:${user.id}:${modelTier}`,
          })) {
            if (event.type === "usage") {
              await recordAiUsage(supabase, {
                userId: user.id,
                feature: "chat",
                taskKind: taskRoute.kind,
                projectName,
                modelTier,
                usage: event,
              });
            }
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
