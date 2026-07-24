// Server-only module. Converts natural language into an auditable tool plan.

import OpenAI from "openai";
import type { ChatMessage } from "@/lib/ai/types";
import { getTextFromMessageContent } from "@/lib/ai/types";
import type { ChatTaskKind, ChatTaskRoute } from "@/lib/chat/task-router";
import { routeChatTask } from "@/lib/chat/task-router";
import { isGptImageRequest } from "@/lib/ai/image-generation";
import {
  CHAT_TOOL_NAMES,
  defaultToolsForIntent,
  summarizeToolDefinitions,
} from "@/lib/chat/tool-registry";
import type { ContextBundle } from "@/lib/chat/context-bundle";

export type IntentKind =
  | "conversation"
  | "web_research"
  | "generate_image"
  | "visualization"
  | "create_artifact"
  | "translate_document"
  | "single_paper_reading"
  | "literature_matrix"
  | "presentation_generation"
  | "file_analysis"
  | "data_analysis"
  | "literature_library_operation"
  | "project_operation"
  | "local_file_operation";

export type ToolName =
  | "chat_model"
  | "web_search"
  | "gpt_image"
  | "svg_visual_renderer"
  | "document_pipeline"
  | "translation_pipeline"
  | "literature_pipeline"
  | "presentation_pipeline"
  | "spreadsheet_pipeline"
  | "literature_library"
  | "project_workspace"
  | "local_connector"
  | "quality_checker";

export type InputScope =
  | "current_message"
  | "uploaded_files"
  | "selected_files"
  | "current_project"
  | "selected_folders"
  | "literature_library"
  | "web";

export type IntentPlan = {
  intent: IntentKind;
  confidence: number;
  summary: string;
  inputScope: InputScope;
  outputType:
    | "chat_answer"
    | "polished_image"
    | "editable_visual"
    | "word"
    | "excel"
    | "ppt"
    | "pdf"
    | "translated_document"
    | "literature_matrix"
    | "workspace_operation";
  tools: ToolName[];
  needsConfirmation: boolean;
  confirmationQuestion?: string;
  constraints: {
    avoid?: string[];
    style?: string;
    language?: string;
    requireProjectIsolation?: boolean;
  };
  steps: string[];
  tokenEstimate: {
    inputTokens: number;
    expectedOutputTokens: number;
    totalTokens: number;
    toolCalls: number;
    notes: string[];
  };
  planner: "model" | "local_fast_path" | "local_fallback";
};

export type IntentRouterInput = {
  messages: ChatMessage[];
  selectedFolderIds: string[];
  contextMode: "auto" | "project" | "temporary";
  projectName?: string;
  webSearchRequested: boolean;
  libraryRequested: boolean;
  contextBundle?: ContextBundle;
};

function lastUserText(messages: ChatMessage[]): string {
  const message = [...messages].reverse().find((item) => item.role === "user");
  return message ? getTextFromMessageContent(message.content) : "";
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function isIntentKind(value: unknown): value is IntentKind {
  return (
    value === "conversation" ||
    value === "web_research" ||
    value === "generate_image" ||
    value === "visualization" ||
    value === "create_artifact" ||
    value === "translate_document" ||
    value === "single_paper_reading" ||
    value === "literature_matrix" ||
    value === "presentation_generation" ||
    value === "file_analysis" ||
    value === "data_analysis" ||
    value === "literature_library_operation" ||
    value === "project_operation" ||
    value === "local_file_operation"
  );
}

function normalizeTools(value: unknown, intent: IntentKind): ToolName[] {
  const allowed = new Set<ToolName>(CHAT_TOOL_NAMES);
  const tools = Array.isArray(value)
    ? value.filter((item): item is ToolName => allowed.has(item as ToolName))
    : [];

  if (tools.length > 0) return Array.from(new Set(tools));
  return defaultToolsForIntent(intent);
}

function normalizeScope(value: unknown, input: IntentRouterInput): InputScope {
  const scopes: InputScope[] = [
    "current_message",
    "uploaded_files",
    "selected_files",
    "current_project",
    "selected_folders",
    "literature_library",
    "web",
  ];
  if (scopes.includes(value as InputScope)) return value as InputScope;
  if (input.contextMode === "project" || input.selectedFolderIds.length > 0) {
    return "current_project";
  }
  return "current_message";
}

function normalizeOutputType(
  value: unknown,
  intent: IntentKind,
): IntentPlan["outputType"] {
  const outputs: IntentPlan["outputType"][] = [
    "chat_answer",
    "polished_image",
    "editable_visual",
    "word",
    "excel",
    "ppt",
    "pdf",
    "translated_document",
    "literature_matrix",
    "workspace_operation",
  ];
  if (outputs.includes(value as IntentPlan["outputType"])) {
    return value as IntentPlan["outputType"];
  }
  if (intent === "generate_image") return "polished_image";
  if (intent === "visualization") return "editable_visual";
  if (intent === "translate_document") return "translated_document";
  if (intent === "literature_matrix") return "literature_matrix";
  if (intent === "presentation_generation") return "ppt";
  if (
    intent === "literature_library_operation" ||
    intent === "project_operation" ||
    intent === "local_file_operation"
  ) {
    return "workspace_operation";
  }
  return "chat_answer";
}

function estimateTokensFromText(value: string): number {
  const compacted = value.replace(/\s+/g, "");
  if (!compacted) return 0;

  const cjkChars = (compacted.match(/[\u3400-\u9fff]/g) ?? []).length;
  const otherChars = Math.max(0, compacted.length - cjkChars);
  return Math.max(1, Math.ceil(cjkChars / 1.6 + otherChars / 4));
}

function expectedOutputTokensForIntent(intent: IntentKind): number {
  switch (intent) {
    case "generate_image":
      return 450;
    case "visualization":
      return 1_200;
    case "create_artifact":
      return 1_800;
    case "translate_document":
      return 1_600;
    case "single_paper_reading":
      return 2_200;
    case "literature_matrix":
      return 2_600;
    case "presentation_generation":
      return 2_800;
    case "file_analysis":
      return 2_200;
    case "data_analysis":
      return 1_800;
    case "web_research":
      return 1_400;
    case "literature_library_operation":
    case "project_operation":
    case "local_file_operation":
      return 550;
    default:
      return 900;
  }
}

function buildTokenEstimate(
  input: IntentRouterInput,
  intent: IntentKind,
  tools: ToolName[],
): IntentPlan["tokenEstimate"] {
  const messageTokens = input.messages.reduce(
    (total, message) =>
      total + estimateTokensFromText(getTextFromMessageContent(message.content)),
    0,
  );
  const projectTokens =
    input.projectName || input.selectedFolderIds.length > 0 ? 120 : 0;
  const routingTokens = 260;
  const inputTokens = Math.max(1, messageTokens + projectTokens + routingTokens);
  const expectedOutputTokens = expectedOutputTokensForIntent(intent);
  const toolCalls = tools.filter((tool) => tool !== "chat_model").length;
  const notes: string[] = [];

  if (tools.includes("gpt_image")) {
    notes.push("图片生成会额外产生图片模型费用，token 只统计文字规划部分。");
  }
  if (
    tools.includes("local_connector") ||
    tools.includes("literature_pipeline")
  ) {
    notes.push("如果读取全文，实际输入 token 会随文件数量和正文长度增加。");
  }
  if (tools.includes("web_search")) {
    notes.push("联网检索会增加搜索调用和引用整理成本。");
  }

  return {
    inputTokens,
    expectedOutputTokens,
    totalTokens: inputTokens + expectedOutputTokens,
    toolCalls,
    notes,
  };
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function createLocalPlan(
  input: IntentRouterInput,
  intent: IntentKind,
  summary: string,
  options: {
    confidence?: number;
    inputScope?: InputScope;
    outputType?: IntentPlan["outputType"];
    tools?: ToolName[];
    steps?: string[];
    planner?: IntentPlan["planner"];
  } = {},
): IntentPlan {
  const tools = options.tools ?? normalizeTools(undefined, intent);
  const inputScope =
    options.inputScope ??
    (input.contextMode === "project" || input.selectedFolderIds.length > 0
      ? "current_project"
      : "current_message");

  return {
    intent,
    confidence: options.confidence ?? 0.88,
    summary,
    inputScope,
    outputType: options.outputType ?? normalizeOutputType(undefined, intent),
    tools,
    needsConfirmation: false,
    constraints: {
      requireProjectIsolation:
        inputScope === "current_project" ||
        inputScope === "selected_files" ||
        inputScope === "selected_folders",
    },
    steps: options.steps ?? [],
    tokenEstimate: buildTokenEstimate(input, intent, tools),
    planner: options.planner ?? "local_fast_path",
  };
}

function textIncludesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function isQuestionAboutExistingOutput(query: string): boolean {
  const lower = query.toLowerCase();
  const questionOrCritiqueTerms = [
    "为什么",
    "为啥",
    "原因",
    "哪里",
    "区别",
    "差别",
    "差距",
    "问题",
    "不一样",
    "一样",
    "没区别",
    "没有区别",
    "没有任何区别",
    "不像",
    "怎么回事",
    "什么情况",
    "分析一下",
    "评价",
  ];
  const outputTerms = [
    "图",
    "图片",
    "图像",
    "海报",
    "结果",
    "回答",
    "输出",
    "文件",
    "image",
    "poster",
    "visual",
    "infographic",
  ];

  return (
    textIncludesAny(lower, questionOrCritiqueTerms) &&
    textIncludesAny(lower, outputTerms)
  );
}

function routeContextBundleFastPath(input: IntentRouterInput): IntentPlan | null {
  const query = compact(lastUserText(input.messages), 500);
  const bundle = input.contextBundle;
  if (!query || !bundle) return null;

  if (
    bundle.taskTypeHint === "critique_existing_output" &&
    bundle.contentSource === "previous_assistant_output"
  ) {
    return createLocalPlan(
      input,
      "conversation",
      "User is asking about or critiquing the previous assistant output.",
      {
        confidence: 0.95,
        inputScope: "current_message",
        outputType: "chat_answer",
        tools: ["chat_model"],
      },
    );
  }

  if (
    bundle.taskTypeHint === "create_artifact" &&
    bundle.contentSource === "previous_assistant_output"
  ) {
    const outputType: IntentPlan["outputType"] =
      /\bexcel\b|xlsx|表格/i.test(query) &&
      !/\bword\b|docx|pdf|ppt|pptx/i.test(query)
        ? "excel"
        : /pdf/i.test(query) && !/\bword\b|docx|excel|xlsx|ppt|pptx/i.test(query)
          ? "pdf"
          : /ppt|pptx/i.test(query) &&
              !/\bword\b|docx|excel|xlsx|pdf/i.test(query)
            ? "ppt"
            : "word";
    return createLocalPlan(
      input,
      "create_artifact",
      "User is continuing from the previous assistant output and wants downloadable files.",
      {
        confidence: 0.94,
        inputScope: "current_message",
        outputType,
        tools: ["document_pipeline", "quality_checker"],
      },
    );
  }

  return null;
}

function routeFastPath(input: IntentRouterInput): IntentPlan | null {
  const query = compact(lastUserText(input.messages), 500);
  if (!query) return null;

  const lower = query.toLowerCase();
  const hasProjectScope =
    input.contextMode === "project" || input.selectedFolderIds.length > 0;
  const projectScope: InputScope = hasProjectScope
    ? "current_project"
    : "current_message";
  if (isQuestionAboutExistingOutput(query)) {
    return createLocalPlan(
      input,
      "conversation",
      "用户在询问或评价已有输出，不应触发图片或文件生成。",
      {
        confidence: 0.94,
        inputScope: "current_message",
        outputType: "chat_answer",
        tools: ["chat_model"],
      },
    );
  }

  if (
    input.contextBundle?.taskTypeHint === "create_artifact" &&
    input.contextBundle.contentSource === "previous_assistant_output"
  ) {
    const outputType: IntentPlan["outputType"] =
      /\bexcel\b|xlsx|表格/i.test(query) &&
      !/\bword\b|docx|pdf|ppt|pptx/i.test(query)
        ? "excel"
        : /pdf/i.test(query) && !/\bword\b|docx|excel|xlsx|ppt|pptx/i.test(query)
          ? "pdf"
          : /ppt|pptx/i.test(query) &&
              !/\bword\b|docx|excel|xlsx|pdf/i.test(query)
            ? "ppt"
            : "word";
    return createLocalPlan(
      input,
      "create_artifact",
      "User is continuing from the previous assistant output and wants downloadable files.",
      {
        confidence: 0.93,
        inputScope: "current_message",
        outputType,
        tools: ["document_pipeline", "quality_checker"],
      },
    );
  }

  if (
    input.contextBundle?.taskTypeHint === "critique_existing_output" &&
    input.contextBundle.contentSource === "previous_assistant_output"
  ) {
    return createLocalPlan(
      input,
      "conversation",
      "User is critiquing or asking about the previous assistant output.",
      {
        confidence: 0.94,
        inputScope: "current_message",
        outputType: "chat_answer",
        tools: ["chat_model"],
      },
    );
  }

  const critiquesExistingOutput =
    /(为什么|为啥|原因|哪里|哪儿|区别|差别|差距|问题|评价|评估|分析|比较|不像|没有.*区别|没.*区别|不一样|一样|什么情况|怎么回事).{0,30}(图|图片|图像|海报|信息图|结果|回答|输出|visual|image|poster|infographic)|(图|图片|图像|海报|信息图|结果|回答|输出|visual|image|poster|infographic).{0,30}(为什么|为啥|原因|哪里|哪儿|区别|差别|差距|问题|评价|评估|分析|比较|不像|没有.*区别|没.*区别|不一样|一样|什么情况|怎么回事)/i.test(
      query,
    );

  if (critiquesExistingOutput) {
    return createLocalPlan(input, "conversation", "用户在追问或评价已有输出的问题。", {
      confidence: 0.9,
      inputScope: "current_message",
      outputType: "chat_answer",
      tools: ["chat_model"],
    });
  }

  if (input.webSearchRequested) {
    return createLocalPlan(input, "web_research", "用户已明确启用联网检索。", {
      inputScope: "web",
      tools: ["web_search", "chat_model"],
      outputType: "chat_answer",
    });
  }

  if (
    /(新建|创建|删除|重命名|改名|归档|恢复|切换).{0,10}(项目|project)/i.test(
      query,
    )
  ) {
    return createLocalPlan(input, "project_operation", "用户要操作科研项目。", {
      inputScope: "current_project",
      outputType: "workspace_operation",
      tools: ["project_workspace"],
    });
  }

  if (
    /(新建|创建|删除|重命名|改名|移动|拖拽|上传|保存).{0,12}(文件夹|文献|论文|pdf|PDF)/i.test(
      query,
    )
  ) {
    return createLocalPlan(
      input,
      "literature_library_operation",
      "用户要操作文献库或文献文件夹。",
      {
        inputScope: input.selectedFolderIds.length
          ? "selected_folders"
          : "literature_library",
        outputType: "workspace_operation",
        tools: ["literature_library"],
      },
    );
  }

  if (/(绑定|授权|读取|打开).{0,12}(本地|文件夹|文件|电脑)/i.test(query)) {
    return createLocalPlan(input, "local_file_operation", "用户要操作本机文件。", {
      inputScope: projectScope,
      outputType: "workspace_operation",
      tools: ["local_connector"],
    });
  }

  if (
    /(翻译|translate).{0,16}(文档|文件|docx|word|pdf|ppt|pptx|中英|英文|english)/i.test(
      query,
    )
  ) {
    return createLocalPlan(input, "translate_document", "用户要翻译文档并保留格式。", {
      inputScope: projectScope,
      outputType: "translated_document",
      tools: ["translation_pipeline", "document_pipeline", "quality_checker"],
    });
  }

  if (/(文献矩阵|矩阵).{0,20}(生成|整理|分析|导出)?/i.test(query)) {
    return createLocalPlan(input, "literature_matrix", "用户要生成文献矩阵。", {
      inputScope: projectScope,
      outputType: "literature_matrix",
      tools: ["local_connector", "literature_pipeline", "quality_checker"],
    });
  }

  if (
    /(单篇精读|精读|解读).{0,20}(文献|论文|paper|pdf|PDF)?/i.test(query)
  ) {
    return createLocalPlan(input, "single_paper_reading", "用户要单篇文献精读。", {
      inputScope: projectScope,
      outputType: "chat_answer",
      tools: ["local_connector", "literature_pipeline", "quality_checker"],
    });
  }

  if (/(ppt|pptx|幻灯片|汇报).{0,20}(生成|制作|导出|做|create|generate)/i.test(lower)) {
    return createLocalPlan(input, "presentation_generation", "用户要生成 PPT。", {
      inputScope: projectScope,
      outputType: "ppt",
      tools: ["presentation_pipeline", "quality_checker"],
    });
  }

  const shortCasualMessage = query.length <= 40 && !/[?？].{0,4}(最新|搜索|文献|论文|文件|图片|图|ppt|pdf|word|excel)/i.test(query);
  if (shortCasualMessage) {
    return createLocalPlan(input, "conversation", "用户是普通短问答。", {
      confidence: 0.78,
      inputScope: "current_message",
      outputType: "chat_answer",
      tools: ["chat_model"],
    });
  }

  return null;
}

function routeSafetyInterception(input: IntentRouterInput): IntentPlan | null {
  const query = compact(lastUserText(input.messages), 500);
  if (!query) return null;

  if (isQuestionAboutExistingOutput(query)) {
    return createLocalPlan(
      input,
      "conversation",
      "用户在询问或评价已有输出，不应触发图片或文件生成。",
      {
        confidence: 0.96,
        inputScope: "current_message",
        outputType: "chat_answer",
        tools: ["chat_model"],
      },
    );
  }

  const critiquesExistingOutput =
    /(为什么|为啥|原因|哪里|哪儿|区别|差别|差距|问题|评价|评估|分析|比较|不像|没有.*区别|没.*区别|不一样|一样|什么情况|怎么回事).{0,30}(图|图片|图像|海报|信息图|结果|回答|输出|visual|image|poster|infographic)|(图|图片|图像|海报|信息图|结果|回答|输出|visual|image|poster|infographic).{0,30}(为什么|为啥|原因|哪里|哪儿|区别|差别|差距|问题|评价|评估|分析|比较|不像|没有.*区别|没.*区别|不一样|一样|什么情况|怎么回事)/i.test(
      query,
    );

  if (!critiquesExistingOutput) return null;

  return createLocalPlan(input, "conversation", "用户在追问或评价已有输出的问题。", {
    confidence: 0.92,
    inputScope: "current_message",
    outputType: "chat_answer",
    tools: ["chat_model"],
  });
}

function planFromRecord(
  record: Record<string, unknown>,
  input: IntentRouterInput,
): IntentPlan | null {
  const intent = isIntentKind(record.intent) ? record.intent : null;
  if (!intent) return null;

  const constraints =
    typeof record.constraints === "object" && record.constraints !== null
      ? (record.constraints as Record<string, unknown>)
      : {};
  const tools = normalizeTools(record.tools, intent);

  return {
    intent,
    confidence: clampConfidence(record.confidence),
    summary:
      typeof record.summary === "string"
        ? compact(record.summary, 180)
        : "已完成任务意图识别。",
    inputScope: normalizeScope(record.inputScope, input),
    outputType: normalizeOutputType(record.outputType, intent),
    tools,
    needsConfirmation: record.needsConfirmation === true,
    confirmationQuestion:
      typeof record.confirmationQuestion === "string"
        ? compact(record.confirmationQuestion, 180)
        : undefined,
    constraints: {
      avoid: Array.isArray(constraints.avoid)
        ? constraints.avoid
            .filter((item): item is string => typeof item === "string")
            .slice(0, 8)
        : undefined,
      style:
        typeof constraints.style === "string"
          ? compact(constraints.style, 120)
          : undefined,
      language:
        typeof constraints.language === "string"
          ? compact(constraints.language, 40)
          : undefined,
      requireProjectIsolation: constraints.requireProjectIsolation === true,
    },
    steps: Array.isArray(record.steps)
      ? record.steps
          .filter((item): item is string => typeof item === "string")
          .slice(0, 8)
      : [],
    tokenEstimate: buildTokenEstimate(input, intent, tools),
    planner: "model",
  };
}

function getRouterClient(): { client: OpenAI; model: string } | null {
  const provider = process.env.INTENT_ROUTER_PROVIDER?.trim().toLowerCase();
  const model = process.env.INTENT_ROUTER_MODEL?.trim();

  if (provider === "local") return null;

  if (provider === "deepseek" || (!provider && process.env.DEEPSEEK_API_KEY)) {
    return {
      client: new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL:
          process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
      }),
      model: model || "deepseek-chat",
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: model || "gpt-4o-mini",
    };
  }

  return null;
}

function fallbackIntentPlan(input: IntentRouterInput): IntentPlan {
  const query = lastUserText(input.messages);
  const route = routeChatTask(input.messages);
  const image = isGptImageRequest(query);
  const intent: IntentKind = image
    ? "generate_image"
    : route.kind === "artifact"
      ? "create_artifact"
      : route.kind;
  return createLocalPlan(
    input,
    intent,
    image
      ? "用户需要生成一张可直接使用的高质量图片。"
      : "使用本地兜底规则完成任务识别。",
    {
      confidence: image ? 0.82 : 0.55,
      planner: "local_fallback",
    },
  );
}

export async function routeIntent(
  input: IntentRouterInput,
  signal?: AbortSignal,
): Promise<IntentPlan> {
  const safetyPlan = routeSafetyInterception(input);
  if (safetyPlan) return safetyPlan;

  const contextFastPlan = routeContextBundleFastPath(input);
  if (contextFastPlan) return contextFastPlan;

  const router = getRouterClient();
  if (!router) return routeFastPath(input) ?? fallbackIntentPlan(input);

  const recentConversation = input.messages
    .filter((message) => message.role !== "system")
    .slice(-4)
    .map((message) => {
      const role = message.role === "user" ? "用户" : "助手";
      return `${role}: ${compact(getTextFromMessageContent(message.content), 700)}`;
    })
    .join("\n\n");
  const contextBundlePrompt = input.contextBundle
    ? [
        "Context bundle:",
        `- current request: ${compact(input.contextBundle.currentUserRequest, 300)}`,
        `- is follow-up: ${input.contextBundle.isFollowUp ? "yes" : "no"}`,
        `- follow-up target: ${input.contextBundle.followUpTarget}`,
        `- task hint: ${input.contextBundle.taskTypeHint}`,
        `- content source: ${input.contextBundle.contentSource}`,
        `- previous output summary: ${
          input.contextBundle.usablePreviousOutputSummary || "none"
        }`,
        input.contextBundle.missingRequiredInfo.length
          ? `- missing info: ${input.contextBundle.missingRequiredInfo.join("; ")}`
          : "- missing info: none",
      ].join("\n")
    : "Context bundle: none";

  const prompt = [
    "你是 ResearchGPT 的 Intent Router，不回答用户问题，只判断用户真实想完成的任务。",
    "不要主要依赖关键词。请理解用户语义、上下文、否定表达和输出目标。",
    "如果用户是在问已有图片/输出为什么不对、哪里有差别、为什么没有区别、质量差在哪里，应判断为 conversation + chat_answer；不要调用图片生成。",
    "如果用户说“不要流程图/不要鱼骨图/要像 GPT 那种图片/做成一张能直接用于汇报的图”，应判断为 generate_image + polished_image，而不是 visualization。",
    "如果用户要可编辑流程图、时间轴、鱼骨图、柱状图等结构化图，才判断为 visualization + editable_visual。",
    "如果用户要求翻译文件并保持格式，应判断为 translate_document。",
    "如果用户要求分析当前项目、选中文件或文件夹，inputScope 应优先是 current_project/selected_files/selected_folders，并要求项目隔离。",
    "如果不确定工具或范围，needsConfirmation=true，并给出一个简短确认问题。",
    "",
    "只输出 JSON，不要输出解释文字。JSON 字段：",
    "{",
    '  "intent": "conversation|web_research|generate_image|visualization|create_artifact|translate_document|single_paper_reading|literature_matrix|presentation_generation|file_analysis|data_analysis|literature_library_operation|project_operation|local_file_operation",',
    '  "confidence": 0.0,',
    '  "summary": "一句话说明用户想做什么",',
    '  "inputScope": "current_message|uploaded_files|selected_files|current_project|selected_folders|literature_library|web",',
    '  "outputType": "chat_answer|polished_image|editable_visual|word|excel|ppt|pdf|translated_document|literature_matrix|workspace_operation",',
    '  "tools": ["chat_model"],',
    '  "needsConfirmation": false,',
    '  "confirmationQuestion": "",',
    '  "constraints": {"avoid": [], "style": "", "language": "", "requireProjectIsolation": false},',
    '  "steps": ["简短执行步骤"]',
    "}",
    "",
    `当前项目：${input.projectName || "未选择"}`,
    `上下文模式：${input.contextMode}`,
    `已选文件夹数量：${input.selectedFolderIds.length}`,
    `用户显式联网：${input.webSearchRequested}`,
    `用户显式使用文献库：${input.libraryRequested}`,
    "",
    "ResearchGPT 当前可用工具层：",
    summarizeToolDefinitions([...CHAT_TOOL_NAMES]),
    "",
    contextBundlePrompt,
    "",
    "最近对话：",
    recentConversation,
  ].join("\n");

  try {
    const completion = await router.client.chat.completions.create(
      {
        model: router.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 700,
      },
      { signal },
    );
    const content = completion.choices[0]?.message.content ?? "";
    const record = extractJsonObject(content);
    const plan = record ? planFromRecord(record, input) : null;
    return plan ?? routeFastPath(input) ?? fallbackIntentPlan(input);
  } catch (error) {
    console.warn("[intent-router] model routing failed", error);
    return routeFastPath(input) ?? fallbackIntentPlan(input);
  }
}

export function chatRouteFromIntent(plan: IntentPlan): ChatTaskRoute {
  const taskKindByIntent: Record<IntentKind, ChatTaskKind> = {
    conversation: "conversation",
    web_research: "web_research",
    generate_image: "artifact",
    visualization: "visualization",
    create_artifact: "artifact",
    translate_document: "artifact",
    single_paper_reading: "file_analysis",
    literature_matrix: "file_analysis",
    presentation_generation: "artifact",
    file_analysis: "file_analysis",
    data_analysis: "data_analysis",
    literature_library_operation: "conversation",
    project_operation: "conversation",
    local_file_operation: "conversation",
  };

  const kind = taskKindByIntent[plan.intent];
  const usesWeb = plan.tools.includes("web_search") || plan.inputScope === "web";
  const usesCode =
    plan.tools.includes("spreadsheet_pipeline") || plan.intent === "data_analysis";

  return {
    kind,
    status: `已识别任务：${plan.summary}`,
    autoWebSearch: usesWeb,
    useCodeInterpreter: usesCode,
    systemInstruction: [
      "This request has already been routed by ResearchGPT Intent Router.",
      `Intent: ${plan.intent}`,
      `Output type: ${plan.outputType}`,
      `Input scope: ${plan.inputScope}`,
      `Tools: ${plan.tools.join(", ")}`,
      plan.constraints.style ? `Style: ${plan.constraints.style}` : "",
      plan.constraints.avoid?.length
        ? `Avoid: ${plan.constraints.avoid.join(", ")}`
        : "",
      plan.constraints.requireProjectIsolation
        ? "Respect project isolation. Do not use files outside the current project or selected scope unless the user explicitly authorizes it."
        : "",
      "If the plan requires a tool that is not available in the current chat stream, explain the missing action clearly and guide the user to the right workflow.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function intentRequestsGptImage(plan: IntentPlan): boolean {
  return (
    plan.intent === "generate_image" ||
    plan.outputType === "polished_image" ||
    plan.tools.includes("gpt_image")
  );
}
