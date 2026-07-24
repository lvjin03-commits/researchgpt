import { validateChatMessages } from "@/lib/ai/provider";
import { openResponsesChatStream } from "@/lib/ai/openai";
import type { ChatMessage } from "@/lib/ai/types";
import { getTextFromMessageContent } from "@/lib/ai/types";
import {
  DEFAULT_CHAT_MODEL_TIER,
  type ChatModelOption,
  type ChatModelTier,
  getChatModelOption,
  isChatModelTier,
} from "@/lib/ai/chat-models";
import { createExport } from "@/lib/export/service";
import type { ExportFormat } from "@/lib/export/types";
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
import { AIProviderError } from "@/lib/ai/errors";
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
import { generateResearchImage } from "@/lib/ai/image-generation";
import { getToolLabel } from "@/lib/chat/tool-registry";
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

const QUERY_EXPORT_FORMATS: Array<{
  format: ExportFormat;
  pattern: RegExp;
}> = [
  { format: "docx", pattern: /\b(docx|word)\b|Word\s*文档|word\s*文档|文档/i },
  { format: "xlsx", pattern: /\b(xlsx|excel)\b|Excel\s*(文件|文档|表格)|excel\s*(文件|文档|表格)|电子表格/i },
  { format: "pptx", pattern: /\b(pptx|ppt|slides?)\b|PPT|幻灯片|演示文稿/i },
  { format: "pdf", pattern: /\bpdf\b|PDF\s*(文件|文档)|pdf\s*(文件|文档)/i },
  { format: "md", pattern: /\b(markdown|md)\b|Markdown/i },
  { format: "txt", pattern: /\b(txt|text)\b|纯文本/i },
  { format: "json", pattern: /\bjson\b/i },
  { format: "svg", pattern: /\bsvg\b/i },
  { format: "png", pattern: /\bpng\b/i },
];

function inferRequestedExportFormats(
  query: string,
  plan: IntentPlan,
): ExportFormat[] {
  const formats = new Set<ExportFormat>();
  for (const item of QUERY_EXPORT_FORMATS) {
    if (item.pattern.test(query)) {
      formats.add(item.format);
    }
  }

  if (plan.outputType === "word") formats.add("docx");
  if (plan.outputType === "excel") formats.add("xlsx");
  if (plan.outputType === "ppt") formats.add("pptx");
  if (plan.outputType === "pdf") formats.add("pdf");

  return Array.from(formats);
}

function shouldAutoCreateExports(query: string, plan: IntentPlan): boolean {
  if (plan.intent === "create_artifact") return true;
  if (["word", "excel", "ppt", "pdf"].includes(plan.outputType)) return true;
  return /(生成|输出|导出|制作|创建|保存|下载).{0,24}(文件|文档|表格|报告|Word|Excel|PPT|PDF|docx|xlsx|pptx|pdf)/i.test(
    query,
  );
}

function createExportTitle(query: string): string {
  const cleaned = query
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "ResearchGPT 生成文件";
  return cleaned.length > 48 ? cleaned.slice(0, 48) : cleaned;
}

const CLEAN_QUERY_EXPORT_FORMATS: Array<{
  format: ExportFormat;
  pattern: RegExp;
}> = [
  { format: "docx", pattern: /\b(docx|word)\b|Word\s*(文件|文档)|word\s*(文件|文档)|微软文档/i },
  { format: "xlsx", pattern: /\b(xlsx|excel)\b|Excel\s*(文件|文档|表格)|excel\s*(文件|文档|表格)|电子表格|工作簿/i },
  { format: "pptx", pattern: /\b(pptx|ppt|slides?)\b|PPT|幻灯片|演示文稿/i },
  { format: "pdf", pattern: /\bpdf\b|PDF\s*(文件|文档)|pdf\s*(文件|文档)/i },
  { format: "md", pattern: /\b(markdown|md)\b|Markdown/i },
  { format: "txt", pattern: /\b(txt|text)\b|纯文本/i },
  { format: "json", pattern: /\bjson\b/i },
  { format: "svg", pattern: /\bsvg\b/i },
  { format: "png", pattern: /\bpng\b/i },
];

function inferCleanRequestedExportFormats(
  query: string,
  plan: IntentPlan,
): ExportFormat[] {
  const formats = new Set<ExportFormat>();
  for (const item of CLEAN_QUERY_EXPORT_FORMATS) {
    if (item.pattern.test(query)) {
      formats.add(item.format);
    }
  }

  if (plan.outputType === "word") formats.add("docx");
  if (plan.outputType === "excel") formats.add("xlsx");
  if (plan.outputType === "ppt") formats.add("pptx");
  if (plan.outputType === "pdf") formats.add("pdf");

  return Array.from(formats);
}

function shouldCleanAutoCreateExports(query: string, plan: IntentPlan): boolean {
  if (plan.intent === "create_artifact") return true;
  if (["word", "excel", "ppt", "pdf"].includes(plan.outputType)) return true;
  return /(生成|输出|导出|制作|创建|保存|下载|给我|做成).{0,30}(文件|文档|表格|报告|Word|Excel|PPT|PDF|docx|xlsx|pptx|pdf)|\b(word|excel|ppt|pdf|docx|xlsx|pptx)\b.{0,30}(文件|文档|表格|报告|输出|导出|生成|下载)/i.test(
    query,
  );
}

function createCleanExportTitle(query: string): string {
  const cleaned = query
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "ResearchGPT 生成文件";
  return cleaned.length > 48 ? cleaned.slice(0, 48) : cleaned;
}

const CLEAN_EXPORT_FORMAT_ALIASES: Array<{
  format: ExportFormat;
  pattern: RegExp;
}> = [
  { format: "docx", pattern: /\b(docx|word)\b|word\s*(文件|文档)|微软文档/i },
  { format: "xlsx", pattern: /\b(xlsx|excel)\b|excel\s*(文件|文档|表格)|电子表格|工作簿/i },
  { format: "pptx", pattern: /\b(pptx|ppt|slides?)\b|幻灯片|演示文稿/i },
  { format: "pdf", pattern: /\bpdf\b|pdf\s*(文件|文档)/i },
  { format: "md", pattern: /\b(markdown|md)\b/i },
  { format: "txt", pattern: /\b(txt|text)\b|纯文本/i },
  { format: "json", pattern: /\bjson\b/i },
  { format: "svg", pattern: /\bsvg\b/i },
  { format: "png", pattern: /\bpng\b/i },
];

function inferReadableExportFormats(
  query: string,
  plan: IntentPlan,
): ExportFormat[] {
  const formats = new Set<ExportFormat>(
    inferCleanRequestedExportFormats(query, plan),
  );

  for (const item of CLEAN_EXPORT_FORMAT_ALIASES) {
    if (item.pattern.test(query)) {
      formats.add(item.format);
    }
  }

  if (plan.outputType === "word") formats.add("docx");
  if (plan.outputType === "excel") formats.add("xlsx");
  if (plan.outputType === "ppt") formats.add("pptx");
  if (plan.outputType === "pdf") formats.add("pdf");

  return Array.from(formats);
}

function intentPlanRequestsExport(plan: IntentPlan): boolean {
  return (
    plan.intent === "create_artifact" ||
    ["word", "excel", "ppt", "pdf"].includes(plan.outputType)
  );
}

function exportFormatsFromIntentPlan(
  query: string,
  plan: IntentPlan,
): ExportFormat[] {
  if (!intentPlanRequestsExport(plan)) return [];

  const formats = new Set<ExportFormat>();
  if (plan.outputType === "word") formats.add("docx");
  if (plan.outputType === "excel") formats.add("xlsx");
  if (plan.outputType === "ppt") formats.add("pptx");
  if (plan.outputType === "pdf") formats.add("pdf");

  for (const format of inferReadableExportFormats(query, plan)) {
    formats.add(format);
  }

  return Array.from(formats);
}

function stripGeneratedFileFooter(content: string): string {
  return content
    .replace(/\[\[RESEARCHGPT_PLAN:[\s\S]*?\]\]\s*/g, "")
    .replace(/\n-{3,}\n\s*(已生成可下载文件|Generated downloadable files)[\s\S]*$/iu, "")
    .trim();
}

function previousAssistantTextBeforeLastUser(messages: ChatMessage[]): string {
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const searchEnd = lastUserIndex >= 0 ? lastUserIndex : messages.length;

  for (let index = searchEnd - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = stripGeneratedFileFooter(
      getTextFromMessageContent(message.content),
    );
    if (text.length >= 80) return text;
  }

  return "";
}

function isFollowUpExportRequest(query: string, formats: ExportFormat[]): boolean {
  if (formats.length === 0) return false;
  const compactQuery = query.replace(/\s+/g, "").toLowerCase();
  if (compactQuery.length > 80) return false;
  return /^(帮我|请|直接|把|将|再)?(生成|输出|导出|制作|保存|下载|做成|转成)?(excel|xlsx|word|docx|pdf|ppt|pptx|、|，|,|和|及|以及|\+)+文件?$/.test(
    compactQuery,
  );
}

function buildReadableAutoExportInstruction(formats: ExportFormat[]): ChatMessage {
  const names = formats.map((format) => format.toUpperCase()).join("、");
  return {
    role: "system",
    content: [
      `用户本次明确要求生成可下载文件，目标格式：${names}。`,
      "服务端会在回答结束后自动创建真实下载链接。",
      "你只需要输出可直接渲染为文件的正式正文，不要让用户再去点击 Generate file，不要要求用户复制 Markdown。",
      "如果用户是在上一条回答后追问生成文件，应当默认沿用上一条回答的内容与上下文，不要反问“要生成什么内容”。",
      "Word/PDF 请使用清晰标题、段落、列表和 Markdown 表格。",
      'Excel 必须先判断表格主题和字段，再输出机器可读数据；优先输出一个 fenced json 代码块，结构为 {"sheets":[{"name":"工作表名","columns":["字段1","字段2"],"rows":[{"字段1":"值","字段2":"值"}]}]}。也可以输出干净 CSV。禁止把多条记录塞进一个单元格，禁止把说明文字混入表格数据。',
      "如果同时生成多种文件，请输出一份结构清晰、可复用的正式内容。",
    ].join("\n"),
  };
}

function buildExportLinksMessage(links: string[]): string {
  return ["", "", "---", "", "已生成可下载文件：", ...links].join("\n");
}

function buildAutoExportInstruction(formats: ExportFormat[]): ChatMessage {
  const names = formats.map((format) => format.toUpperCase()).join("、");
  return {
    role: "system",
    content: [
      `用户本次明确要求生成可下载文件，目标格式：${names}。`,
      "服务器会在回答结束后自动调用文件生成工具并返回下载链接。",
      "你只需要输出可以直接渲染为文件的正文内容。",
      "不要告诉用户去点击 Generate file，不要要求用户复制 Markdown，不要输出手动生成步骤。",
      "如果是 Word/PDF，请使用清晰标题、段落、列表和 Markdown 表格。",
      "如果是 Excel，必须先判断表格主题和字段，再输出机器可读表格数据；优先输出一个 ```json 代码块，结构为 {\"sheets\":[{\"name\":\"工作表名\",\"columns\":[\"字段1\",\"字段2\"],\"rows\":[{\"字段1\":\"值\",\"字段2\":\"值\"}]}]}，也可输出干净 CSV。禁止把多条记录塞进一个单元格，禁止把说明文字混入表格数据。",
      "如果同时生成多种文件，请输出一份结构清晰、可复用的正式内容。",
    ].join("\n"),
  };
}

function isQuotaOrRateLimitError(error: unknown): boolean {
  if (!(error instanceof AIProviderError)) return false;
  const raw = error.message.toLowerCase();
  return (
    error.statusCode === 429 ||
    raw.includes("quota") ||
    raw.includes("rate limit") ||
    raw.includes("too many requests")
  );
}

function isRecoverableModelError(error: unknown): boolean {
  if (!(error instanceof AIProviderError)) return false;
  const raw = error.message.toLowerCase();
  return (
    error.statusCode === 400 ||
    error.statusCode === 403 ||
    raw.includes("model_not_found") ||
    raw.includes("does not exist") ||
    raw.includes("does not have access")
  );
}

function buildEmptyAssistantMessage(error?: unknown): string {
  const mapped = error ? toChatApiErrorResponse(error).body.error : "";
  const reason = mapped
    ? `\n\n可能原因：${mapped}`
    : "\n\n可能原因：模型服务本次返回了空内容，或联网检索/工具调用中途没有继续生成正文。";

  return [
    "\n\n我没有收到可用的正文回答，已经拦截到这次空输出。",
    reason,
    "",
    "请直接重试一次；如果连续出现，可以先关闭联网检索或切换到更稳定的模型后再问。系统后续不应该再只显示执行计划而没有正文。",
  ].join("\n");
}

const MAX_AUTO_CONTINUATIONS = 3;

function looksAbruptlyTruncated(text: string): boolean {
  const trimmed = stripGeneratedFileFooter(text).trim();
  if (trimmed.length < 600) return false;

  const tail = trimmed.slice(-120).trim();
  if (!tail) return false;

  if (/[。！？.!?）)\]】}"'”’]$/.test(tail)) {
    return false;
  }

  if (/[，,；;：:、-]$/.test(tail)) {
    return true;
  }

  return /\b(of|and|or|the|a|an|to|for|with|in|on|by|from|as|that|which|where|while|because|including|such as)$/i.test(
    tail,
  );
}

function buildAutoContinuationMessages(
  messages: ChatMessage[],
  assistantText: string,
): ChatMessage[] {
  const partialAnswer =
    assistantText.length > 8000 ? assistantText.slice(-8000) : assistantText;
  return [
    ...messages,
    {
      role: "assistant",
      content: partialAnswer,
    },
    {
      role: "user",
      content:
        "上一条回答因为输出长度限制在半句处中断了。请从中断处自然续写并完成原任务，不要重复已经写过的内容，不要重新开头；如果是综述、报告或长文，请补完整结论。",
    },
  ];
}

type LongFormSegment = {
  title: string;
  instruction: string;
};

function requestedLongFormLength(query: string): number | null {
  const match = query.match(/(\d{3,5})\s*(字|词|words?)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function shouldUseSegmentedLongForm(
  query: string,
  plan: IntentPlan,
  requestedFormats: ExportFormat[],
): boolean {
  if (
    plan.intent === "generate_image" ||
    plan.intent === "visualization" ||
    plan.outputType === "polished_image" ||
    plan.outputType === "editable_visual" ||
    plan.outputType === "excel" ||
    plan.outputType === "literature_matrix" ||
    plan.outputType === "workspace_operation"
  ) {
    return false;
  }

  const requestedLength = requestedLongFormLength(query);
  const asksLongForm =
    /(综述|长文|论文|报告|文章|review|literature\s+review|essay|article|report)/i.test(
      query,
    );
  const asksWriting =
    /(写|撰写|生成|输出|整理|总结|形成|帮我|write|draft|generate|compose|summarize)/i.test(
      query,
    );
  const asksExport = requestedFormats.some((format) =>
    ["docx", "pdf", "md", "txt"].includes(format),
  );

  if (requestedLength !== null && requestedLength >= 700) return true;
  if (asksLongForm && asksWriting) return true;
  if (asksLongForm && asksExport) return true;
  return false;
}

function buildLongFormSegments(query: string): LongFormSegment[] {
  const requestedLength = requestedLongFormLength(query);
  const compactLengthNote = requestedLength
    ? `Target total length is about ${requestedLength} Chinese characters or words as requested. Allocate the length across all segments and avoid excessive expansion.`
    : "Keep the final answer complete and concise. Allocate depth across all segments instead of over-expanding the first part.";

  if (/(综述|review|literature\s+review)/i.test(query)) {
    return [
      {
        title: "Title, abstract, and introduction",
        instruction: `${compactLengthNote} Write the final title, a concise abstract, keywords if appropriate, and the introduction/background. Do not stop before the section is complete.`,
      },
      {
        title: "Main research landscape",
        instruction:
          "Write the core classification, major research directions, and representative concepts. Connect claims with evidence or sources already available in the conversation.",
      },
      {
        title: "Mechanisms, methods, and evidence",
        instruction:
          "Write the technical mechanisms, methods, key findings, data patterns, and evidence comparison. Use clear paragraph structure instead of loose notes.",
      },
      {
        title: "Advantages, limitations, and gaps",
        instruction:
          "Write the advantages, limitations, contradictions, unresolved problems, and research gaps. Avoid repeating previous sections.",
      },
      {
        title: "Future directions, conclusion, and references",
        instruction:
          "Write future directions, a complete conclusion, and a references/source section when evidence is available. Finish with a natural closing sentence.",
      },
    ];
  }

  if (/(报告|report|论文|essay|article|文章)/i.test(query)) {
    return [
      {
        title: "Purpose and background",
        instruction: `${compactLengthNote} Write the title, purpose, background, and problem definition.`,
      },
      {
        title: "Core analysis",
        instruction:
          "Write the main analysis body with clear subsections, evidence, comparisons, and reasoning.",
      },
      {
        title: "Findings and implications",
        instruction:
          "Write key findings, implications, limitations, and practical recommendations if relevant.",
      },
      {
        title: "Conclusion",
        instruction:
          "Write a complete conclusion and any source/reference notes. Ensure the whole answer is finished.",
      },
    ];
  }

  return [
    {
      title: "Opening and context",
      instruction: `${compactLengthNote} Write the opening part and clarify the task background.`,
    },
    {
      title: "Main body",
      instruction: "Write the main body with structured reasoning and evidence.",
    },
    {
      title: "Closing",
      instruction: "Write the final part, conclusion, and any source/reference notes.",
    },
  ];
}

function buildSegmentMessages(
  messages: ChatMessage[],
  assistantText: string,
  segment: LongFormSegment,
  index: number,
  total: number,
): ChatMessage[] {
  const previousTail =
    assistantText.length > 5000 ? assistantText.slice(-5000) : assistantText;
  const segmentInstruction: ChatMessage = {
    role: "system",
    content: [
      "You are in segmented long-form generation mode.",
      `Write segment ${index} of ${total}: ${segment.title}.`,
      segment.instruction,
      "Output only the content for this segment. Do not say you are generating a segment. Do not ask the user to continue. Do not repeat completed text.",
      "If this is the final segment, complete the whole task with a clear ending.",
    ].join("\n"),
  };

  return [
    segmentInstruction,
    ...messages,
    ...(previousTail.trim()
      ? [
          {
            role: "assistant" as const,
            content: previousTail,
          },
        ]
      : []),
    {
      role: "user",
      content: `Continue the original task by writing segment ${index}/${total}: ${segment.title}.`,
    },
  ];
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
    .map(getToolLabel)
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

function formatCompactPlanDisclosure(
  intentPlan: IntentPlan,
  toolPlan: ToolPlan,
): string {
  const estimate = intentPlan.tokenEstimate;
  const tools =
    intentPlan.tools.map(getToolLabel).join("、") ||
    "语言模型";
  const requiredSteps = toolPlan.steps
    .filter((step) => step.required)
    .slice(0, 5)
    .map((step, index) => {
      const stepTools = step.tools.length ? `（${step.tools.join(", ")}）` : "";
      return `步骤 ${index + 1}：${step.title}${stepTools} - ${step.detail}`;
    });
  const lines = [
    `识别任务：${INTENT_LABELS[intentPlan.intent]}（置信度 ${Math.round(intentPlan.confidence * 100)}%）`,
    `读取范围：${SCOPE_LABELS[intentPlan.inputScope]}`,
    `输出结果：${OUTPUT_LABELS[intentPlan.outputType]}`,
    `调用工具：${tools}`,
    `预计 token：输入约 ${estimate.inputTokens.toLocaleString("zh-CN")}，输出约 ${estimate.expectedOutputTokens.toLocaleString("zh-CN")}，合计约 ${estimate.totalTokens.toLocaleString("zh-CN")}`,
    ...estimate.notes.slice(0, 1),
    ...toolPlan.warnings.slice(0, 2).map((warning) => `提醒：${warning}`),
    ...toolPlan.blockers.slice(0, 2).map((blocker) => `待确认：${blocker}`),
    ...requiredSteps,
  ].filter(Boolean);

  const payload = {
    summary: `执行规划 · ${INTENT_LABELS[intentPlan.intent]} · 约 ${estimate.totalTokens.toLocaleString("zh-CN")} tokens`,
    lines,
  };

  return `\n\n[[RESEARCHGPT_PLAN:${encodeURIComponent(JSON.stringify(payload))}]]\n\n`;
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
    const requestedExportFormats = exportFormatsFromIntentPlan(
      query,
      intentPlan,
    );
    const previousAssistantExportSource =
      previousAssistantTextBeforeLastUser(messages);
    const shouldExportPreviousAssistant =
      isFollowUpExportRequest(query, requestedExportFormats) &&
      previousAssistantExportSource.length > 0;
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
        ...(requestedExportFormats.length > 0
          ? [buildReadableAutoExportInstruction(requestedExportFormats)]
          : []),
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

    const shouldGenerateImage = intentRequestsGptImage(intentPlan);

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
          controller.enqueue(
            encodeChatStreamEvent({
              type: "text",
              delta: formatCompactPlanDisclosure(intentPlan, toolPlan),
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

          if (shouldExportPreviousAssistant) {
            const links: string[] = [];
            const title = createCleanExportTitle(
              previousAssistantExportSource.split("\n").find((line) => line.trim()) ||
                query,
            );

            controller.enqueue(
              encodeChatStreamEvent({
                type: "status",
                message: "已读取上一条回答，正在生成可下载文件。",
              }),
            );

            for (const format of requestedExportFormats) {
              try {
                const created = await createExport(
                  {
                    format,
                    title,
                    content: previousAssistantExportSource,
                    metadata: {
                      source: "chat-follow-up-export",
                      templateId: "academic",
                    },
                  },
                  user.id,
                );
                links.push(`- [${created.filename}](${created.downloadUrl})`);
              } catch (exportError) {
                const message =
                  exportError instanceof Error ? exportError.message : "未知错误";
                links.push(`- ${format.toUpperCase()} 生成失败：${message}`);
              }
            }

            controller.enqueue(
              encodeChatStreamEvent({
                type: "text",
                delta: [
                  "我已按上一条回答的内容生成文件，不需要你再补充主题。",
                  buildExportLinksMessage(links),
                ].join("\n"),
              }),
            );
            controller.close();
            return;
          }

          let assistantText = "";
          const streamModel = async (
            option: ChatModelOption,
            tier: ChatModelTier,
            enableOpenAiTools: boolean,
            overrideMessages?: ChatMessage[],
          ) => {
            let wasIncomplete = false;
            for await (const event of openResponsesChatStream({
              messages: overrideMessages ?? messages,
              signal: request.signal,
              model: option.model,
              provider: option.provider,
              reasoningEffort: option.reasoningEffort,
              webSearch:
                enableOpenAiTools && option.provider === "openai"
                  ? effectiveWebSearch
                  : false,
              codeInterpreter:
                enableOpenAiTools && option.provider === "openai"
                  ? taskRoute.useCodeInterpreter
                  : false,
              maxOutputTokens: option.maxOutputTokens,
              promptCacheKey: `chat:${user.id}:${tier}`,
            })) {
              if (event.type === "incomplete") {
                wasIncomplete = true;
                continue;
              }
              if (event.type === "usage") {
                await recordAiUsage(supabase, {
                  userId: user.id,
                  feature: "chat",
                  taskKind: taskRoute.kind,
                  projectName: effectiveProjectName,
                  modelTier: tier,
                  usage: event,
                });
              }
              if (event.type === "text") {
                assistantText += event.delta;
              }
              controller.enqueue(encodeChatStreamEvent(event));
            }
            return wasIncomplete;
          };

          let streamFailure: unknown = null;
          let wasIncomplete = false;
          let continuationOption = modelOption;
          let continuationTier = modelTier;
          const longFormSegments = shouldUseSegmentedLongForm(
            query,
            intentPlan,
            requestedExportFormats,
          )
            ? buildLongFormSegments(query)
            : [];

          if (longFormSegments.length > 0) {
            controller.enqueue(
              encodeChatStreamEvent({
                type: "status",
                message:
                  "长文任务已切换为分段生成：系统会逐段完成并自动合并，避免回答在中途截断。",
              }),
            );

            for (let index = 0; index < longFormSegments.length; index += 1) {
              const segment = longFormSegments[index];
              controller.enqueue(
                encodeChatStreamEvent({
                  type: "status",
                  message: `正在生成第 ${index + 1}/${longFormSegments.length} 段：${segment.title}`,
                }),
              );

              const beforeSegmentLength = assistantText.length;
              try {
                const segmentIncomplete = await streamModel(
                  continuationOption,
                  continuationTier,
                  index === 0,
                  buildSegmentMessages(
                    messages,
                    assistantText,
                    segment,
                    index + 1,
                    longFormSegments.length,
                  ),
                );
                wasIncomplete = wasIncomplete || segmentIncomplete;
              } catch (streamError) {
                streamFailure = streamError;
                break;
              }

              if (assistantText.length <= beforeSegmentLength) {
                streamFailure = new Error(
                  `Segment ${index + 1} did not return usable content.`,
                );
                break;
              }

              const separator = "\n\n";
              assistantText += separator;
              controller.enqueue(
                encodeChatStreamEvent({
                  type: "text",
                  delta: separator,
                }),
              );
            }
          } else {
          try {
            wasIncomplete = await streamModel(modelOption, modelTier, true);
          } catch (streamError) {
            if (
              assistantText.trim().length === 0 &&
              modelTier !== "economy" &&
              (isQuotaOrRateLimitError(streamError) ||
                isRecoverableModelError(streamError))
            ) {
              const fallbackOption = getChatModelOption("economy");
              const fallbackReason = isRecoverableModelError(streamError)
                ? "当前模型不可用或账号没有权限"
                : "当前模型触发额度或频率限制";
              controller.enqueue(
                encodeChatStreamEvent({
                  type: "status",
                  message: `${fallbackReason}，已自动切换到 ResearchGPT Nano 重试。本次回答会优先保证可用性，复杂推理和图片/联网工具可能降级。`,
                }),
              );
              try {
                wasIncomplete = await streamModel(
                  fallbackOption,
                  "economy",
                  false,
                );
                continuationOption = fallbackOption;
                continuationTier = "economy";
              } catch (fallbackError) {
                streamFailure = fallbackError;
              }
            } else {
              streamFailure = streamError;
            }
          }
          }

          if (assistantText.trim().length === 0) {
            controller.enqueue(
              encodeChatStreamEvent({
                type: "text",
                delta: buildEmptyAssistantMessage(streamFailure),
              }),
            );
          } else if (streamFailure) {
            throw streamFailure;
          }

          if (assistantText.trim().length > 0 && wasIncomplete && !streamFailure) {
            controller.enqueue(
              encodeChatStreamEvent({
                type: "status",
                message: "回答到达单次输出上限，正在自动续写一次",
              }),
            );
            const beforeContinuationLength = assistantText.length;
            try {
              const continuationIncomplete = await streamModel(
                continuationOption,
                continuationTier,
                false,
                buildAutoContinuationMessages(messages, assistantText),
              );
              if (
                continuationIncomplete ||
                assistantText.length <= beforeContinuationLength
              ) {
                controller.enqueue(
                  encodeChatStreamEvent({
                    type: "text",
                    delta:
                      "\n\n> 本次回答已接近模型输出上限。如果还没有完全结束，请直接发送“继续”，我会从这里接着写。",
                  }),
                );
              }
            } catch {
              controller.enqueue(
                encodeChatStreamEvent({
                  type: "text",
                  delta:
                    "\n\n> 本次回答到达模型输出上限，自动续写没有成功。如果内容还没完整，请直接发送“继续”。",
                }),
              );
            }
          }

          if (assistantText.trim().length > 0 && !streamFailure) {
            let extraContinuationCount = wasIncomplete ? 1 : 0;

            while (
              looksAbruptlyTruncated(assistantText) &&
              extraContinuationCount < MAX_AUTO_CONTINUATIONS
            ) {
              extraContinuationCount += 1;
              controller.enqueue(
                encodeChatStreamEvent({
                  type: "status",
                  message: `回答停在未完成句子处，正在自动续写第 ${extraContinuationCount} 次。`,
                }),
              );

              const beforeContinuationLength = assistantText.length;
              try {
                await streamModel(
                  continuationOption,
                  continuationTier,
                  false,
                  buildAutoContinuationMessages(messages, assistantText),
                );
              } catch {
                controller.enqueue(
                  encodeChatStreamEvent({
                    type: "text",
                    delta:
                      "\n\n> 本次回答接近模型输出上限，自动续写没有成功。如果内容仍不完整，请直接发送“继续”，我会从这里接着写。",
                  }),
                );
                break;
              }

              if (assistantText.length <= beforeContinuationLength) {
                break;
              }
            }
          }

          const requestedFormats = requestedExportFormats;

          if (requestedFormats.length > 0 && assistantText.trim()) {
            const links: string[] = [];
            const title = createCleanExportTitle(query);

            for (const format of requestedFormats) {
              try {
                const created = await createExport(
                  {
                    format,
                    title,
                    content: assistantText,
                    metadata: {
                      source: "chat-auto-export",
                      templateId: "academic",
                    },
                  },
                  user.id,
                );
                links.push(`- [${created.filename}](${created.downloadUrl})`);
              } catch (exportError) {
                const message =
                  exportError instanceof Error
                    ? exportError.message
                    : "未知错误";
                links.push(`- ${format.toUpperCase()} 生成失败：${message}`);
              }
            }

            if (links.length > 0) {
              controller.enqueue(
                encodeChatStreamEvent({
                  type: "text",
                  delta: buildExportLinksMessage(links),
                }),
              );
            }
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
