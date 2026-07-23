// Server-only module. Converts natural language into an auditable tool plan.

import OpenAI from "openai";
import type { ChatMessage } from "@/lib/ai/types";
import { getTextFromMessageContent } from "@/lib/ai/types";
import type { ChatTaskKind, ChatTaskRoute } from "@/lib/chat/task-router";
import { routeChatTask } from "@/lib/chat/task-router";
import { isGptImageRequest } from "@/lib/ai/image-generation";

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
  planner: "model" | "local_fallback";
};

export type IntentRouterInput = {
  messages: ChatMessage[];
  selectedFolderIds: string[];
  contextMode: "auto" | "project" | "temporary";
  projectName?: string;
  webSearchRequested: boolean;
  libraryRequested: boolean;
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
  const allowed = new Set<ToolName>([
    "chat_model",
    "web_search",
    "gpt_image",
    "svg_visual_renderer",
    "document_pipeline",
    "translation_pipeline",
    "literature_pipeline",
    "presentation_pipeline",
    "spreadsheet_pipeline",
    "literature_library",
    "project_workspace",
    "local_connector",
    "quality_checker",
  ]);
  const tools = Array.isArray(value)
    ? value.filter((item): item is ToolName => allowed.has(item as ToolName))
    : [];

  if (tools.length > 0) return Array.from(new Set(tools));

  switch (intent) {
    case "generate_image":
      return ["gpt_image", "quality_checker"];
    case "visualization":
      return ["svg_visual_renderer", "quality_checker"];
    case "translate_document":
      return ["translation_pipeline", "document_pipeline", "quality_checker"];
    case "single_paper_reading":
    case "literature_matrix":
      return ["local_connector", "literature_pipeline", "quality_checker"];
    case "presentation_generation":
      return ["presentation_pipeline", "quality_checker"];
    case "literature_library_operation":
      return ["literature_library"];
    case "project_operation":
      return ["project_workspace"];
    case "local_file_operation":
      return ["local_connector"];
    case "web_research":
      return ["web_search", "chat_model"];
    default:
      return ["chat_model"];
  }
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
  const tools = normalizeTools(undefined, intent);

  return {
    intent,
    confidence: image ? 0.82 : 0.55,
    summary: image
      ? "用户需要生成一张可直接使用的高质量图片。"
      : "使用本地兜底规则完成任务识别。",
    inputScope:
      input.contextMode === "project" || input.selectedFolderIds.length > 0
        ? "current_project"
        : "current_message",
    outputType: normalizeOutputType(undefined, intent),
    tools,
    needsConfirmation: false,
    constraints: {
      requireProjectIsolation:
        input.contextMode === "project" || input.selectedFolderIds.length > 0,
    },
    steps: [],
    tokenEstimate: buildTokenEstimate(input, intent, tools),
    planner: "local_fallback",
  };
}

export async function routeIntent(
  input: IntentRouterInput,
  signal?: AbortSignal,
): Promise<IntentPlan> {
  const router = getRouterClient();
  if (!router) return fallbackIntentPlan(input);

  const recentConversation = input.messages
    .filter((message) => message.role !== "system")
    .slice(-6)
    .map((message) => {
      const role = message.role === "user" ? "用户" : "助手";
      return `${role}: ${compact(getTextFromMessageContent(message.content), 1200)}`;
    })
    .join("\n\n");

  const prompt = [
    "你是 ResearchGPT 的 Intent Router，不回答用户问题，只判断用户真实想完成的任务。",
    "不要主要依赖关键词。请理解用户语义、上下文、否定表达和输出目标。",
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
    return plan ?? fallbackIntentPlan(input);
  } catch (error) {
    console.warn("[intent-router] model routing failed", error);
    return fallbackIntentPlan(input);
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
