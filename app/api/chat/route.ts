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
import {
  chatRouteFromIntent,
  type IntentPlan,
  intentRequestsGptImage,
  routeIntent,
} from "@/lib/chat/intent-router";
import {
  executeToolPlan,
  sanitizeExecutableProjectContext,
} from "@/lib/chat/tool-executor";
import { buildToolPlan, type ToolPlan } from "@/lib/chat/tool-planner";
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
import {
  generateResearchImage,
  isGptImageRequest,
} from "@/lib/ai/image-generation";
import type { WorkspaceContextMode } from "@/lib/chat/workspace";
import { createClient } from "@/lib/supabase/server";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/uploads/storage-constants";

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
  projectContext?: unknown;
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

function createGeneratedImagePath(userId: string): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${userId}/generated-images/${id}.png`;
}

function generatedImageUrl(path: string): string {
  return `/api/chat/generated-images?path=${encodeURIComponent(path)}`;
}

const INTENT_LABELS: Record<IntentPlan["intent"], string> = {
  conversation: "普通问答",
  web_research: "联网检索",
  generate_image: "高质量图片生成",
  visualization: "可编辑科研图表",
  create_artifact: "文件生成",
  translate_document: "文档翻译",
  single_paper_reading: "单篇精读",
  literature_matrix: "文献矩阵",
  presentation_generation: "PPT 生成",
  file_analysis: "文件分析",
  data_analysis: "数据分析",
  literature_library_operation: "文献库操作",
  project_operation: "项目操作",
  local_file_operation: "本机文件操作",
};

const SCOPE_LABELS: Record<IntentPlan["inputScope"], string> = {
  current_message: "只读取当前问题",
  uploaded_files: "读取本次上传文件",
  selected_files: "读取本次选中文件",
  current_project: "读取当前项目资料",
  selected_folders: "读取选中文献文件夹",
  literature_library: "读取文献库",
  web: "联网检索",
};

const OUTPUT_LABELS: Record<IntentPlan["outputType"], string> = {
  chat_answer: "聊天回答",
  polished_image: "高质量图片",
  editable_visual: "可编辑图表",
  word: "Word 文档",
  excel: "Excel 文件",
  ppt: "PPT 文件",
  pdf: "PDF 文件",
  translated_document: "翻译后的文档",
  literature_matrix: "文献矩阵",
  workspace_operation: "工作区操作",
};

const TOOL_LABELS: Record<IntentPlan["tools"][number], string> = {
  chat_model: "语言模型",
  web_search: "联网搜索",
  gpt_image: "GPT Image",
  svg_visual_renderer: "结构化图表",
  document_pipeline: "文档生成工具",
  translation_pipeline: "翻译工具",
  literature_pipeline: "文献分析工具",
  presentation_pipeline: "PPT 工具",
  spreadsheet_pipeline: "表格工具",
  literature_library: "文献库工具",
  project_workspace: "项目工作区",
  local_connector: "本机连接器",
  quality_checker: "质量检查",
};

function formatTokenEstimate(plan: IntentPlan): string {
  const estimate = plan.tokenEstimate;
  const pieces = [
    `预计 token：输入约 ${estimate.inputTokens.toLocaleString("zh-CN")}`,
    `输出约 ${estimate.expectedOutputTokens.toLocaleString("zh-CN")}`,
    `合计约 ${estimate.totalTokens.toLocaleString("zh-CN")}`,
  ];
  if (estimate.toolCalls > 0) {
    pieces.push(`额外工具调用 ${estimate.toolCalls} 个`);
  }
  if (estimate.notes.length > 0) {
    pieces.push(estimate.notes[0]);
  }
  return pieces.join("；");
}

function formatIntentPlanCard(plan: IntentPlan): string {
  const estimate = plan.tokenEstimate;
  const tools = plan.tools
    .map((tool) => TOOL_LABELS[tool] ?? tool)
    .join("、");
  const notes = estimate.notes.length
    ? `\n> ${estimate.notes.join(" ")}`
    : "";

  return [
    "### 本次任务执行计划",
    "",
    `- **识别任务**：${INTENT_LABELS[plan.intent]}（置信度 ${Math.round(plan.confidence * 100)}%）`,
    `- **读取范围**：${SCOPE_LABELS[plan.inputScope]}`,
    `- **输出结果**：${OUTPUT_LABELS[plan.outputType]}`,
    `- **调用工具**：${tools || "语言模型"}`,
    `- **预计 token**：输入约 ${estimate.inputTokens.toLocaleString("zh-CN")}，输出约 ${estimate.expectedOutputTokens.toLocaleString("zh-CN")}，合计约 ${estimate.totalTokens.toLocaleString("zh-CN")}`,
    notes,
    "",
    "---",
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function formatToolPlanCard(plan: ToolPlan): string {
  const steps = plan.steps
    .slice(0, 8)
    .map((item, index) => {
      const tools = item.tools.length ? `（${item.tools.join(", ")}）` : "";
      return `${index + 1}. **${item.title}**${tools}：${item.detail}`;
    })
    .join("\n");
  const warnings = plan.warnings.length
    ? `\n\n> ${plan.warnings.join(" ")}`
    : "";
  const blockers = plan.blockers.length
    ? `\n\n**需要先补充/确认**：${plan.blockers.join(" ")}`
    : "";

  return [
    "### 工具执行规划",
    "",
    steps,
    warnings,
    blockers,
    "",
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");
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
    const projectContext = sanitizeExecutableProjectContext(
      body.projectContext,
    );
    const effectiveProjectName = projectName || projectContext?.name || "";
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
    const intentPlan = await routeIntent(
      {
        messages,
        selectedFolderIds,
        contextMode,
        projectName: effectiveProjectName,
        webSearchRequested: webSearch,
        libraryRequested: useLibrary,
      },
      request.signal,
    );
    const toolPlan = buildToolPlan(intentPlan, {
      messages,
      selectedFolderIds,
      contextMode,
      projectName: effectiveProjectName,
      webSearchRequested: webSearch,
      libraryRequested: useLibrary,
    });
    const toolExecution = await executeToolPlan({
      intentPlan,
      toolPlan,
      projectContext,
      selectedFolderIds,
      contextMode,
      projectName: effectiveProjectName,
    });
    const taskRoute = chatRouteFromIntent(intentPlan);
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

    for (const contextMessage of toolExecution.contextMessages) {
      messages = insertContextBeforeLastUser(messages, contextMessage);
    }

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

    const shouldGenerateImage =
      intentRequestsGptImage(intentPlan) || isGptImageRequest(query);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (const status of toolExecution.statuses) {
            controller.enqueue(
              encodeChatStreamEvent({ type: "status", message: status }),
            );
          }
          if (effectiveUseLibrary) {
            controller.enqueue(
              encodeChatStreamEvent({ type: "status", message: libraryStatus }),
            );
          }
          controller.enqueue(
            encodeChatStreamEvent({
              type: "status",
              message: `任务调度：${intentPlan.summary}`,
            }),
          );
          controller.enqueue(
            encodeChatStreamEvent({
              type: "status",
              message: formatTokenEstimate(intentPlan),
            }),
          );
          if (toolExecution.blockingMessage) {
            controller.enqueue(
              encodeChatStreamEvent({
                type: "text",
                delta: [
                  "工具执行层已暂停任务，避免读取错误资料：",
                  "",
                  toolExecution.blockingMessage,
                ].join("\n"),
              }),
            );
            controller.close();
            return;
          }
          if (toolPlan.needsUserDecision && toolPlan.confirmationQuestion) {
            controller.enqueue(
              encodeChatStreamEvent({
                type: "text",
                delta: [
                  "我需要先确认一下，避免调用错工具：",
                  "",
                  toolPlan.confirmationQuestion,
                ].join("\n"),
              }),
            );
            controller.close();
            return;
          }
          controller.enqueue(
            encodeChatStreamEvent({
              type: "status",
              message: shouldGenerateImage
                ? "正在调用 GPT Image 生成高质量科研图片"
                : taskRoute.status,
            }),
          );

          if (shouldGenerateImage) {
            const image = await generateResearchImage(
              messages,
              user.id,
              request.signal,
            );
            const imagePath = createGeneratedImagePath(user.id);
            const { error: uploadError } = await supabase.storage
              .from(CHAT_ATTACHMENTS_BUCKET)
              .upload(imagePath, image.buffer, {
                contentType: image.mimeType,
                upsert: false,
              });

            if (uploadError) {
              throw new Error(`图片保存失败：${uploadError.message}`);
            }

            const imageUrl = generatedImageUrl(imagePath);
            controller.enqueue(
              encodeChatStreamEvent({
                type: "text",
                delta:
                  "已生成一张 GPT Image 科研图片。你可以直接预览，也可以下载 PNG 后放入 PPT 或 Word。\n\n",
              }),
            );
            controller.enqueue(
              encodeChatStreamEvent({
                type: "generated_image",
                image: {
                  title: "ResearchGPT AI 生成图片",
                  imageUrl,
                  downloadUrl: `${imageUrl}&download=1`,
                  model: image.model,
                },
              }),
            );
            controller.enqueue(
              encodeChatStreamEvent({
                type: "usage",
                model: image.model,
                inputTokens: 0,
                cachedInputTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0,
                totalTokens: 0,
                webSearchCalls: 0,
                codeInterpreterCalls: 0,
                estimatedCostUsd: 0,
              }),
            );
            controller.close();
            return;
          }

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
                projectName: effectiveProjectName,
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
