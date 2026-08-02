import { validateChatMessages } from "@/lib/ai/provider";
import { openResponsesChatStream } from "@/lib/ai/openai";
import { createHash } from "node:crypto";
import type { ChatMessage } from "@/lib/ai/types";
import { getTextFromMessageContent } from "@/lib/ai/types";
import {
  DEFAULT_CHAT_MODEL_TIER,
  type ChatModelOption,
  type ChatModelTier,
  getChatModelOption,
  isChatModelTier,
} from "@/lib/ai/chat-models";
import {
  inspectArtifactContentCompleteness,
  type ArtifactCompletenessReport,
} from "@/lib/export/completeness";
import { createExport } from "@/lib/export/service";
import {
  createDocumentGenerationTrace,
  type DocumentGenerationTrace,
} from "@/lib/export/document-trace";
import type { ArtifactTemplateId } from "@/lib/export/artifact-planner";
import type { ExportFormat } from "@/lib/export/types";
import {
  documentLanguageInstruction,
  resolveDocumentLanguage,
  type DocumentLanguage,
} from "@/lib/export/document-language";
import {
  applySemanticDocumentPlan,
  createDocumentPlan,
  documentSpecPrompt,
  documentSpecToMarkdown,
  parseDocumentSpec,
  semanticDocumentPlanPrompt,
  validateDocumentSpec,
  type DocumentPlan,
  type DocumentSpec,
  type FinalImageAsset,
} from "@/lib/export/document-spec";
import {
  resolveDocumentTemplate,
  type ResolvedDocumentTemplate,
} from "@/lib/export/document-templates";
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
  buildContextBundle,
  contextBundleToSystemMessage,
} from "@/lib/chat/context-bundle";
import {
  requireChatUser,
  toChatApiErrorResponse,
} from "@/lib/chat/server/errors";
import { AIProviderError } from "@/lib/ai/errors";
import { buildLiteratureLibraryContext } from "@/lib/chat/server/library-context";
import {
  encodeChatStreamEvent,
} from "@/lib/chat/stream-protocol";
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
import { executeDocumentCommand } from "@/lib/document-v2-production/command-gateway";
import {
  inspectDocumentV2Runtime,
  requireDocumentV2PublicRuntime,
} from "@/lib/document-v2-production/runtime-config";

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

function buildPromptCacheKey(...parts: Array<string | number | undefined>): string {
  const raw = parts.filter((part) => part !== undefined && part !== "").join(":");
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const readable = parts
    .filter((part) => part !== undefined && part !== "")
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, "-"))
    .join(":")
    .slice(0, 40);
  return `${readable}:${digest}`.slice(0, 64);
}

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


function shouldAutoCreateExports(query: string, plan: IntentPlan): boolean {
  if (plan.intent === "create_artifact") return true;
  if (["word", "excel", "ppt", "pdf"].includes(plan.outputType)) return true;
  return /(生成|输出|导出|制作|创建|保存|下载).{0,24}(文件|文档|表格|报告|Word|Excel|PPT|PDF|docx|xlsx|pptx|pdf)/i.test(
    query,
  );
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


function createCleanExportTitle(query: string): string {
  const cleaned = query
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "ResearchGPT 生成文件";
  return cleaned.length > 48 ? cleaned.slice(0, 48) : cleaned;
}

function selectExportTemplateId(
  query: string,
  format: ExportFormat,
): ArtifactTemplateId {
  if (
    format === "docx" &&
    /(nature|top\s*journal|manuscript|sci|review|literature\s+review|顶刊|综述|论文|稿件)/i.test(
      query,
    )
  ) {
    return "nature";
  }

  return "academic";
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

function queryExplicitlyRequestsFileCreation(query: string): boolean {
  const compact = query.replace(/\s+/g, " ").trim();
  const hasCreateVerb =
    /(generate|create|make|export|download|save|write|produce|生成|输出|导出|制作|创建|保存|下载|写一篇|做一份)/i.test(
      compact,
    );
  const hasFileTarget =
    /\b(word|docx|excel|xlsx|ppt|pptx|pdf|markdown|md|txt|json|svg|png)\b|文档|文件|表格|幻灯片|演示文稿|综述|报告/i.test(
      compact,
    );
  return hasCreateVerb && hasFileTarget;
}

function exportFormatsFromIntentPlan(
  query: string,
  plan: IntentPlan,
): ExportFormat[] {
  if (
    !intentPlanRequestsExport(plan) &&
    !shouldAutoCreateExports(query, plan) &&
    !queryExplicitlyRequestsFileCreation(query)
  ) {
    return [];
  }

  const formats = new Set<ExportFormat>();
  if (plan.outputType === "word") formats.add("docx");
  if (plan.outputType === "excel") formats.add("xlsx");
  if (plan.outputType === "ppt") formats.add("pptx");
  if (plan.outputType === "pdf") formats.add("pdf");

  for (const format of inferReadableExportFormats(query, plan)) {
    formats.add(format);
  }

  if (formats.size === 0 && queryExplicitlyRequestsFileCreation(query)) {
    formats.add("docx");
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

function buildPreviousAssistantSourceMessage(source: string): ChatMessage {
  return {
    role: "system",
    content: [
      "The latest user request is a follow-up transformation of the previous assistant output.",
      "Use the previous assistant output below as the source material.",
      "Do not ask the user to select a project, folder, or file unless the user explicitly asks to analyze new external material.",
      "If the user asks for multiple language versions, produce those versions from this source.",
      `Previous assistant output:\n${source.slice(0, 12000)}`,
    ].join("\n\n"),
  };
}

function toolPlanUsingConversationSource(toolPlan: ToolPlan): ToolPlan {
  return {
    ...toolPlan,
    blockers: [],
    needsUserDecision: false,
    confirmationQuestion: undefined,
    warnings: [
      ...toolPlan.warnings,
      "Using the previous assistant output as the source for this follow-up request.",
    ],
  };
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

function buildRecoverableExportFailureLine(
  format: ExportFormat,
  message: string,
): string {
  return [
    `- ${format.toUpperCase()} 暂未生成：${message}`,
    "  下一步：如果是缺少材料，请补充文献、数据或引用来源；如果是接口或存储问题，请稍后重试或切换模型后继续生成。",
  ].join("\n");
}

function isDedicatedArtifactFormat(format: ExportFormat): boolean {
  return ["docx", "xlsx", "pptx", "pdf", "md", "txt", "json", "svg", "png"].includes(
    format,
  );
}

function shouldUseDedicatedArtifactMode(
  plan: IntentPlan,
  formats: ExportFormat[],
): boolean {
  if (formats.length === 0) return false;
  if (!formats.every(isDedicatedArtifactFormat)) return false;
  if (formats.some((format) => ["docx", "xlsx", "pptx", "pdf"].includes(format))) {
    return true;
  }
  return (
    plan.intent === "create_artifact" ||
    plan.intent === "presentation_generation" ||
    ["word", "excel", "ppt", "pdf"].includes(plan.outputType)
  );
}

function artifactTemplateInstruction(
  format: ExportFormat,
  templateId: ArtifactTemplateId,
  language: DocumentLanguage,
): string {
  if (format !== "docx" || templateId !== "nature") return "";

  const structure =
    language === "zh-CN"
      ? [
          "# <根据主题提炼的简洁中文学术标题>",
          "## 摘要",
          "<一个完整中文段落，概述背景、核心论点、证据与意义>",
          "关键词：<4-8 个专业术语，以分号分隔>",
          "## 1. 引言",
          "<研究背景、综述范围与核心科学问题>",
          "## 2. <主要证据章节>",
          "## 3. <机制、比较或分析章节>",
          "## 4. 结论与展望",
          "## 参考文献",
        ]
      : [
          "# <concise scientific title derived from the subject>",
          "## Abstract",
          "<one paragraph, 120-180 words, focused on background, core argument, evidence, and implication>",
          "Keywords: <4-8 professional terms separated by semicolons>",
          "## 1. Introduction",
          "<research background, scope, and core scientific question>",
          "## 2. <main evidence section>",
          "## 3. <mechanism/comparison/analysis section>",
          "## 4. Conclusions and Outlook",
          "## References",
        ];
  return [
    "Template track: Nature/top-journal manuscript.",
    "Plan the manuscript internally first, then output only the final markdown source.",
    "Required manuscript structure, using these exact localized markdown slots:",
    ...structure,
    "<reference entries or a clear placeholder that references must be completed from source literature>",
    "Do not omit Abstract, Keywords, Introduction, Conclusions, or References.",
    "Use evidence-focused paragraphs, not chat-style bullets unless the user explicitly requests bullets.",
    "- Tables only when they clarify comparisons; every table needs a short caption or lead-in sentence.",
    "- Include figures only when they materially clarify the argument.",
    "- For each needed figure, insert one machine-readable visual specification at the intended position using exactly <researchgpt-visual>{\"type\":\"process\",\"title\":\"...\",\"steps\":[{\"title\":\"...\",\"description\":\"...\"}],\"caption\":\"...\",\"source\":\"...\",\"evidenceType\":\"ai_structure\"}</researchgpt-visual>.",
    "- Keep each visual specification valid JSON. Use concise labels and 2-6 meaningful steps or nodes derived from the document content.",
    "- The server removes these internal visual specifications and replaces them with rendered images; do not also write visible placeholder, 图注, evidenceType, or internal-tool prose.",
    "- First determine whether verified source context is available from the conversation, uploaded files, selected project literature, retrieved context, or user-provided references.",
    "- If verified source context exists, cite only those sources and build References from them.",
    "- If no verified source context exists, still generate the manuscript as a clearly labeled no-reference draft. Add a short 'Source notice' after the title or abstract, and under References write that no verified reference source was provided and references must be completed before academic use.",
    "- Never fabricate citations. A no-reference draft is acceptable when the user has not provided sources.",
    "Style: restrained top-journal academic prose, precise transitions, no chatty wording, no operational instructions.",
  ].join("\n");
}

function artifactFormatInstruction(
  format: ExportFormat,
  templateId: ArtifactTemplateId,
  language: DocumentLanguage,
): string {
  if (format === "docx") {
    return [
      "Target format: DOCX.",
      "Return a mature structured DocumentSpec JSON object following the separate schema contract.",
      "Do not return Markdown or visible placeholders.",
    ].join("\n");
  }

  if (format === "xlsx") {
    return [
      "Target format: XLSX.",
      "Return only one fenced json code block.",
      'Schema: {"sheets":[{"name":"Sheet name","columns":["Column A","Column B"],"rows":[{"Column A":"value","Column B":"value"}]}]}.',
      "Use separate fields and rows. Never put a whole table, paragraph, or markdown table into one cell.",
      "Do not include prose outside the json block.",
    ].join("\n");
  }

  if (format === "pdf" || format === "md") {
    return [
      `Target format: ${format.toUpperCase()}.`,
      "Return only one fenced markdown code block.",
      "Create a professional document source, not a chat answer.",
      "Use a real document title, abstract/summary when appropriate, clear heading levels, paragraphs, tables, and references if available.",
      "For SCI, Nature, top-journal, manuscript, or literature-review requests, produce manuscript-style source: concise scientific title, Abstract, Keywords, numbered sections, evidence-focused paragraphs, table captions, figure captions when useful, and References.",
      "Do not output fenced visual/chart blocks, Mermaid, or visible internal-tool prose.",
      "When a figure is useful, insert one valid machine-readable specification at the intended position using exactly <researchgpt-visual>{\"type\":\"process\",\"title\":\"...\",\"steps\":[{\"title\":\"...\",\"description\":\"...\"}],\"caption\":\"...\",\"source\":\"...\",\"evidenceType\":\"ai_structure\"}</researchgpt-visual>.",
      "The server removes the specification and inserts the rendered image, caption, and source. Do not also write 图 N 占位符, Figure placeholder, 图注, or evidenceType as visible document text.",
      "If the document normally requires citations but no verified source is available, do not fabricate references and do not fail file generation. Generate an explicitly labeled no-reference draft and make the limitation visible inside the document.",
      "Do not use the user's command as the title. Derive the title from the actual subject.",
      "Do not include instructions such as 'click Generate file' or 'copy this markdown'.",
      artifactTemplateInstruction(format, templateId, language),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (format === "pptx") {
    return [
      "Target format: PPTX.",
      "Return only one fenced markdown code block.",
      "Create a slide-production outline. Each H2 is one slide.",
      "For every slide include: title, one-sentence takeaway, 3-5 concise bullets, visual/layout suggestion, and speaker note.",
      "Do not output a long article. Keep slide text brief and presentation-ready.",
    ].join("\n");
  }

  if (format === "svg" || format === "png") {
    return [
      `Target format: ${format.toUpperCase()}.`,
      "Return only one fenced svg code block when possible.",
      "Design a polished scientific visual with explicit layout, legible labels, balanced spacing, and no clipped text.",
      "Do not output a chat explanation before the visual source.",
    ].join("\n");
  }

  if (format === "json") {
    return [
      "Target format: JSON.",
      "Return only one fenced json code block.",
      "Use clear keys and structured data. No prose outside the json block.",
    ].join("\n");
  }

  return [
    `Target format: ${format.toUpperCase()}.`,
    "Return only the final artifact content. Do not include chat instructions.",
  ].join("\n");
}

function buildDedicatedArtifactMessages(
  baseMessages: ChatMessage[],
  format: ExportFormat,
  query: string,
  templateId: ArtifactTemplateId,
  suppliedPlan?: DocumentPlan,
): ChatMessage[] {
  const language = resolveDocumentLanguage({ query });
  const documentPlan =
    format === "docx"
      ? suppliedPlan ?? createDocumentPlan({ query, templateId, maxVisuals: 3 })
      : null;
  return [
    {
      role: "system",
      content: [
        "You are ResearchGPT Artifact Builder.",
        "This is a hidden file-generation pass. The user will not see your raw content.",
        "Your job is to create artifact source content for a server-side file generator.",
        "Do not write a conversational answer.",
        "Keep final document text separate from internal tool data. The only permitted internal payload in Word/PDF/Markdown source is the exact <researchgpt-visual> JSON channel described below; the server removes it before rendering.",
        "For academic documents with no verified sources, generate an explicitly labeled no-reference draft instead of failing or fabricating references.",
        "Ask follow-up questions only when the file cannot be generated at all.",
        "Use the conversation, project context, uploaded files, retrieved context, and the user's latest request as the content source.",
        "If the user asked for multiple files, this pass creates exactly one format; optimize for that format.",
        documentLanguageInstruction(language),
        artifactFormatInstruction(format, templateId, language),
        documentPlan ? documentSpecPrompt(documentPlan) : "",
      ].join("\n\n"),
    },
    ...baseMessages,
    {
      role: "user",
      content: [
        `Create the ${format.toUpperCase()} artifact source for this request:`,
        query,
        "",
        "Output only the artifact source content requested above.",
      ].join("\n"),
    },
  ];
}

function buildArtifactContinuationMessages(
  baseMessages: ChatMessage[],
  format: ExportFormat,
  query: string,
  templateId: ArtifactTemplateId,
  partialSource: string,
  report: ArtifactCompletenessReport,
): ChatMessage[] {
  const language = resolveDocumentLanguage({ query });
  const documentPlan =
    format === "docx"
      ? createDocumentPlan({ query, templateId, maxVisuals: 3 })
      : null;
  const issueSummary =
    report.issues.map((issue) => issue.message).join("\n") ||
    "The previous artifact source is incomplete.";
  const tail = partialSource.slice(-14_000);

  return [
    {
      role: "system",
      content: [
        "You are ResearchGPT Artifact Builder.",
        "Continue an unfinished hidden artifact-generation pass.",
        "Do not restart the document. Do not repeat existing sections.",
        "Start exactly from the point where the partial source stopped.",
        "Return only continuation artifact source content. No chat explanation.",
        documentLanguageInstruction(language),
        artifactFormatInstruction(format, templateId, language),
        documentPlan ? documentSpecPrompt(documentPlan) : "",
      ].join("\n\n"),
    },
    ...baseMessages,
    {
      role: "assistant",
      content: tail,
    },
    {
      role: "user",
      content: [
        `The ${format.toUpperCase()} artifact source for the request below is incomplete.`,
        `Original request: ${query}`,
        "",
        "Completeness issues:",
        issueSummary,
        "",
        "Continue and finish the artifact. Do not repeat the text already provided.",
      ].join("\n"),
    },
  ];
}

function hasMissingRequiredSection(
  report: ArtifactCompletenessReport | null,
): report is ArtifactCompletenessReport {
  return (
    report?.issues.some((issue) => issue.code === "missing_required_section") ??
    false
  );
}

function buildArtifactRepairMessages(
  baseMessages: ChatMessage[],
  format: ExportFormat,
  query: string,
  templateId: ArtifactTemplateId,
  incompleteSource: string,
  report: ArtifactCompletenessReport,
): ChatMessage[] {
  const language = resolveDocumentLanguage({ query });
  const documentPlan =
    format === "docx"
      ? createDocumentPlan({ query, templateId, maxVisuals: 3 })
      : null;
  const issueSummary =
    report.issues.map((issue) => issue.message).join("\n") ||
    "The previous artifact source is incomplete.";

  return [
    {
      role: "system",
      content: [
        "You are ResearchGPT Artifact Builder.",
        "Repair a failed hidden artifact-generation pass by rewriting the complete artifact source.",
        "The previous source was rejected by the export quality gate because required document structure was missing.",
        "Do not merely continue from the end. Rebuild the whole artifact with the required structure.",
        "Preserve useful substance from the failed source, but output a complete, export-ready document.",
        "Return only final artifact source content. No chat explanation.",
        documentLanguageInstruction(language),
        artifactFormatInstruction(format, templateId, language),
        documentPlan ? documentSpecPrompt(documentPlan) : "",
      ].join("\n\n"),
    },
    ...baseMessages,
    {
      role: "assistant",
      content: incompleteSource.slice(-16_000),
    },
    {
      role: "user",
      content: [
        `The ${format.toUpperCase()} artifact source for the request below failed export completeness checks.`,
        `Original request: ${query}`,
        "",
        "Completeness issues:",
        issueSummary,
        "",
        "Rewrite the complete artifact now. Include all required front matter and closing sections. Do not output only a continuation.",
      ].join("\n"),
    },
  ];
}

function buildDocumentSpecRepairMessages(
  baseMessages: ChatMessage[],
  query: string,
  templateId: ArtifactTemplateId,
  failedSource: string,
  plan: DocumentPlan,
  issues: Array<{ path: string; message: string }>,
): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are ResearchGPT Structured Document Builder.",
        "Rewrite the complete DocumentSpec. Do not return a partial patch.",
        documentLanguageInstruction(plan.language),
        documentSpecPrompt(plan),
      ].join("\n\n"),
    },
    ...baseMessages,
    {
      role: "assistant",
      content: failedSource.slice(-20_000),
    },
    {
      role: "user",
      content: [
        `The structured DOCX content for this request failed validation: ${query}`,
        "",
        ...issues.map((issue) => `- ${issue.path}: ${issue.message}`),
        "",
        "Return a complete corrected DocumentSpec JSON object now.",
        `Template: ${templateId}.`,
      ].join("\n"),
    },
  ];
}

async function generateDocumentImageAssets(
  spec: DocumentSpec,
  userId: string,
  signal?: AbortSignal,
  trace?: DocumentGenerationTrace,
): Promise<FinalImageAsset[]> {
  const assets: FinalImageAsset[] = [];
  const sharp = (await import("sharp")).default;
  const placementOrder = spec.sections.flatMap((section) =>
    section.blocks.flatMap((block) =>
      block.type === "visual" ? [block.visualRequestId] : [],
    ),
  );
  const orderedRequests = [
    ...placementOrder.flatMap((id) =>
      spec.visualRequests.filter((request) => request.id === id),
    ),
    ...spec.visualRequests.filter((request) => !placementOrder.includes(request.id)),
  ];

  for (const [index, request] of orderedRequests.entries()) {
    const startedAt = Date.now();
    await trace?.event({
      stage: "figure_generation",
      componentId: request.id,
      attempt: 1,
      status: "started",
      details: {
        index: index + 1,
        total: orderedRequests.length,
        type: request.type,
        evidenceKind: request.evidenceKind,
      },
    });
    try {
      const image = await generateResearchImage(
      [
        {
          role: "user",
          content: [
            `Generate the final ${request.type} image for a formal research document.`,
            `Document language: ${spec.language}.`,
            `Purpose: ${request.purpose}`,
            `Content brief: ${request.contentBrief}`,
            `Required elements: ${request.requiredElements.join("; ")}`,
            `Final caption: ${request.caption}`,
            `Evidence basis: ${request.evidenceKind}.`,
            "Return a polished, publication-ready image. Do not show prompts, JSON, evidenceType, raw data objects, placeholders, or internal instructions in the image.",
          ].join("\n"),
        },
      ],
      userId,
      signal,
      );
      const metadata = await sharp(image.buffer).metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width < 640 ||
        metadata.height < 360
      ) {
        throw new Error(
          `生成图片 ${request.id} 的分辨率不足，未进入文档排版。`,
        );
      }
      assets.push({
        id: `asset-${request.id}`,
        requestId: request.id,
        mimeType: image.mimeType,
        dataBase64: image.buffer.toString("base64"),
        width: metadata.width,
        height: metadata.height,
        caption: request.caption,
        source: request.sourceStatement,
        altText: request.contentBrief,
      });
      await trace?.event({
        stage: "figure_generation",
        componentId: request.id,
        attempt: 1,
        status: "succeeded",
        durationMs: Date.now() - startedAt,
        details: {
          model: image.model,
          mimeType: image.mimeType,
          width: metadata.width,
          height: metadata.height,
        },
      });
    } catch (error) {
      await trace?.event({
        stage: "figure_generation",
        componentId: request.id,
        attempt: 1,
        status: "failed",
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }

  return assets;
}

function createArtifactExportTitle(query: string, content: string): string {
  const withoutFence = content
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const markdownHeading = withoutFence.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const jsonSheetName = withoutFence.match(/"name"\s*:\s*"([^"]+)"/)?.[1]?.trim();
  const structuralHeading = markdownHeading
    ?.replace(/^\d+(?:\.\d+)*[.)、]?\s*/, "")
    .trim();
  const usableMarkdownHeading =
    markdownHeading &&
    !/^(abstract|摘要|keywords?|关键词|introduction|引言|references?|参考文献|conclusions?(?: and outlook)?|结论(?:与展望)?)$/i.test(
      structuralHeading ?? "",
    )
      ? markdownHeading
      : "";
  const title = usableMarkdownHeading || jsonSheetName || query;
  return createCleanExportTitle(
    title
      .replace(/\b(generate|create|export|download|make)\b/gi, "")
      .replace(/\b(word|excel|ppt|pdf|docx|xlsx|pptx)\b/gi, "")
      .replace(/生成|输出|导出|下载|制作|创建|文档|文件|表格/g, "")
      .trim() || query,
  );
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
  previous_assistant_output: "承接上一轮结果",
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



function formatCompactPlanDisclosure(
  intentPlan: IntentPlan,
  toolPlan: ToolPlan,
): string {
  const estimate = intentPlan.tokenEstimate;
  const tools =
    Array.from(new Set(toolPlan.steps.flatMap((step) => step.tools)))
      .map(getToolLabel)
      .join("、") || "语言模型";
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
    const contextBundle = buildContextBundle({
      messages,
      selectedFolderIds,
      contextMode,
      projectName: effectiveProjectName,
      projectContext,
      memory,
    });
    const intentPlan = await routeIntent(
      {
        messages,
        selectedFolderIds,
        contextMode,
        projectName: effectiveProjectName,
        webSearchRequested: webSearch,
        libraryRequested: useLibrary,
        contextBundle,
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
      contextBundle,
    });
    const requestedExportFormats = exportFormatsFromIntentPlan(
      query,
      intentPlan,
    );
    const previousAssistantExportSource =
      previousAssistantTextBeforeLastUser(messages);
    const shouldUsePreviousAssistantSource =
      intentPlan.inputScope === "previous_assistant_output";
    const shouldExportPreviousAssistant =
      requestedExportFormats.length > 0 && shouldUsePreviousAssistantSource;
    const effectiveToolPlan = shouldUsePreviousAssistantSource
      ? toolPlanUsingConversationSource(toolPlan)
      : toolPlan;
    const documentTrace =
      requestedExportFormats.length > 0
        ? createDocumentGenerationTrace(supabase, user.id, {
            query,
            requestedFormats: requestedExportFormats,
            pipelineVersion: "legacy-chat-v1",
          })
        : null;
    await documentTrace?.start({
      intent: intentPlan.intent,
      inputScope: intentPlan.inputScope,
      outputType: intentPlan.outputType,
      planner: intentPlan.planner,
      confidence: intentPlan.confidence,
      shouldUsePreviousAssistantSource,
      shouldExportPreviousAssistant,
      contextMode,
      webSearchRequested: webSearch,
      libraryRequested: useLibrary,
    });
    const toolExecutionStartedAt = Date.now();
    await documentTrace?.event({
      stage: "tool_execution",
      status: "started",
      details: {
        tools: Array.from(
          new Set(effectiveToolPlan.steps.flatMap((step) => step.tools)),
        ),
        needsUserDecision: effectiveToolPlan.needsUserDecision,
      },
    });
    let toolExecution;
    try {
      toolExecution = await executeToolPlan({
        intentPlan,
        toolPlan: effectiveToolPlan,
        projectContext,
        selectedFolderIds,
        contextMode,
        projectName: effectiveProjectName,
        allowConversationSource: shouldUsePreviousAssistantSource,
      });
      await documentTrace?.event({
        stage: "tool_execution",
        status: "succeeded",
        durationMs: Date.now() - toolExecutionStartedAt,
        details: {
          statusCount: toolExecution.statuses.length,
          contextMessageCount: toolExecution.contextMessages.length,
          blocked: Boolean(toolExecution.blockingMessage),
        },
      });
    } catch (error) {
      await documentTrace?.fail({
        stage: "tool_execution",
        error,
        details: { durationMs: Date.now() - toolExecutionStartedAt },
      });
      throw error;
    }
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
        contextBundleToSystemMessage(contextBundle),
        ...(requestedExportFormats.length > 0
          ? [buildReadableAutoExportInstruction(requestedExportFormats)]
          : []),
        ...messages,
      ],
      modelOption,
    );

    if (shouldUsePreviousAssistantSource) {
      messages = insertContextBeforeLastUser(
        messages,
        buildPreviousAssistantSourceMessage(previousAssistantExportSource),
      );
    }

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
          if (documentTrace) {
            controller.enqueue(
              encodeChatStreamEvent({
                type: "status",
                message: `文件任务编号：${documentTrace.jobId}`,
              }),
            );
          }
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
              delta: formatCompactPlanDisclosure(intentPlan, effectiveToolPlan),
            }),
          );
          if (toolExecution.blockingMessage) {
            await documentTrace?.cancel("tool_execution_blocked", {
              reasonCode: "tool_execution_returned_blocking_message",
              messageChars: toolExecution.blockingMessage.length,
            });
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
          if (
            effectiveToolPlan.needsUserDecision &&
            effectiveToolPlan.confirmationQuestion
          ) {
            await documentTrace?.cancel("waiting_for_user_decision", {
              reasonCode: "tool_plan_requires_user_decision",
              questionChars: effectiveToolPlan.confirmationQuestion.length,
            });
            controller.enqueue(
              encodeChatStreamEvent({
                type: "text",
                delta: [
                  "我需要先确认一下，避免调用错工具：",
                  "",
                  effectiveToolPlan.confirmationQuestion,
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
              promptCacheKey: buildPromptCacheKey("chat", user.id, tier),
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

          const generateSemanticPlan = async (
            queryText: string,
            template: ResolvedDocumentTemplate,
            option: ChatModelOption,
            tier: ChatModelTier,
          ): Promise<DocumentPlan> => {
            const planningStartedAt = Date.now();
            await documentTrace?.event({
              stage: "document_planning",
              status: "started",
              attempt: 1,
              details: {
                templateId: template.id,
                templateVersion: template.version,
                model: option.model,
              },
            });
            const basePlan = createDocumentPlan({
              query: queryText,
              template,
              maxVisuals: option.maxVisuals,
            });
            let planSource = "";
            for await (const event of openResponsesChatStream({
              messages: [
                {
                  role: "system",
                  content: semanticDocumentPlanPrompt(basePlan),
                },
                {
                  role: "user",
                  content: queryText,
                },
              ],
              signal: request.signal,
              model: option.model,
              provider: option.provider,
              reasoningEffort: option.reasoningEffort,
              webSearch: false,
              codeInterpreter: false,
              maxOutputTokens: Math.min(3000, option.maxOutputTokens),
              promptCacheKey: buildPromptCacheKey(
                "document-plan",
                user.id,
                tier,
                "docx",
                0,
              ),
            })) {
              if (event.type === "text") {
                planSource += event.delta;
              } else if (event.type === "usage") {
                await recordAiUsage(supabase, {
                  userId: user.id,
                  feature: "artifact-planning",
                  taskKind: taskRoute.kind,
                  projectName: effectiveProjectName,
                  modelTier: tier,
                  usage: event,
                });
                controller.enqueue(encodeChatStreamEvent(event));
              }
            }
            const plan = applySemanticDocumentPlan(basePlan, planSource);
            await documentTrace?.event({
              stage: "document_planning",
              status: "succeeded",
              attempt: 1,
              durationMs: Date.now() - planningStartedAt,
              details: {
                templateId: plan.templateId,
                templateVersion: plan.templateVersion,
                componentCount: plan.componentTasks.length,
                visualBudget: plan.maxVisuals,
                responseChars: planSource.length,
              },
            });
            return plan;
          };

          const generateArtifactSource = async (
            format: ExportFormat,
            option: ChatModelOption,
            tier: ChatModelTier,
            templateId: ArtifactTemplateId,
            documentTemplate?: ResolvedDocumentTemplate,
          ) => {
            let source = "";
            const structuredPlan =
              format === "docx"
                ? await generateSemanticPlan(
                    query,
                    documentTemplate ??
                      resolveDocumentTemplate({
                        query,
                        format,
                        legacyTemplateId: templateId,
                      }),
                    option,
                    tier,
                  )
                : null;
            let artifactMessages = buildDedicatedArtifactMessages(
              messages,
              format,
              query,
              templateId,
              structuredPlan ?? undefined,
            );
            let latestReport: ArtifactCompletenessReport | null = null;
            for (let attempt = 0; attempt < 4; attempt += 1) {
              const generationStartedAt = Date.now();
              await documentTrace?.event({
                stage: "content_generation",
                componentId: format,
                attempt: attempt + 1,
                status: attempt === 0 ? "started" : "retrying",
                details: {
                  structured: Boolean(structuredPlan),
                  model: option.model,
                  fullDocumentRewrite: Boolean(structuredPlan && attempt > 0),
                },
              });
              let streamWasIncomplete = false;
              let chunk = "";

              for await (const event of openResponsesChatStream({
                messages: artifactMessages,
                signal: request.signal,
                model: option.model,
                provider: option.provider,
                reasoningEffort: option.reasoningEffort,
                webSearch:
                  option.provider === "openai" && effectiveWebSearch
                    ? true
                    : false,
                codeInterpreter: false,
                maxOutputTokens: option.maxOutputTokens,
                promptCacheKey: buildPromptCacheKey(
                  "artifact",
                  user.id,
                  tier,
                  format,
                  attempt,
                ),
              })) {
              if (event.type === "text") {
                chunk += event.delta;
                continue;
              }
              if (event.type === "usage") {
                await recordAiUsage(supabase, {
                  userId: user.id,
                  feature: "artifact-generation",
                  taskKind: taskRoute.kind,
                  projectName: effectiveProjectName,
                  modelTier: tier,
                  usage: event,
                });
                controller.enqueue(encodeChatStreamEvent(event));
              }
              if (event.type === "incomplete") {
                streamWasIncomplete = true;
                controller.enqueue(
                  encodeChatStreamEvent({
                    type: "status",
                    message: `${format.toUpperCase()} 内容接近单次输出上限，系统会用已生成内容继续创建文件。`,
                  }),
                );
              }

              }

              if (structuredPlan) {
                source = chunk.trim();
                const parsedSpec = parseDocumentSpec(source);
                const validation = parsedSpec
                  ? validateDocumentSpec(parsedSpec, structuredPlan)
                  : {
                      passed: false,
                      issues: [
                        {
                          code: "invalid_document_spec",
                          path: "root",
                          message: "The response was not a valid DocumentSpec JSON object.",
                        },
                      ],
                    };
                if (!streamWasIncomplete && validation.passed) {
                  await documentTrace?.event({
                    stage: "content_generation",
                    componentId: format,
                    attempt: attempt + 1,
                    status: "succeeded",
                    durationMs: Date.now() - generationStartedAt,
                    details: {
                      responseChars: source.length,
                      validationIssueCount: 0,
                    },
                  });
                  return { source, structuredPlan };
                }
                await documentTrace?.event({
                  stage: "content_validation",
                  componentId: format,
                  attempt: attempt + 1,
                  status: "failed",
                  durationMs: Date.now() - generationStartedAt,
                  details: {
                    streamWasIncomplete,
                    responseChars: source.length,
                    validationIssues: validation.issues.map((issue) => ({
                      code: issue.code,
                      path: issue.path,
                      message: issue.message,
                    })),
                  },
                });
                if (attempt >= 3) break;
                artifactMessages = buildDocumentSpecRepairMessages(
                  messages,
                  query,
                  templateId,
                  source,
                  structuredPlan,
                  validation.issues,
                );
                controller.enqueue(
                  encodeChatStreamEvent({
                    type: "status",
                    message: `DOCX 结构化内容未通过校验，正在进行第 ${attempt + 2} 次完整重写。`,
                  }),
                );
                continue;
              }

              source = [source.trim(), chunk.trim()].filter(Boolean).join("\n\n");
              latestReport = inspectArtifactContentCompleteness({
                format,
                title: createArtifactExportTitle(query, source),
                content: source,
                metadata: {
                  source: "chat-dedicated-artifact-mode",
                  templateId,
                  artifactOnly: true,
                  requestQuery: query,
                },
              });

              if (!streamWasIncomplete && latestReport.passed) {
                await documentTrace?.event({
                  stage: "content_generation",
                  componentId: format,
                  attempt: attempt + 1,
                  status: "succeeded",
                  durationMs: Date.now() - generationStartedAt,
                  details: {
                    responseChars: source.length,
                    validationIssueCount: 0,
                  },
                });
                break;
              }
              await documentTrace?.event({
                stage: "content_validation",
                componentId: format,
                attempt: attempt + 1,
                status: "failed",
                durationMs: Date.now() - generationStartedAt,
                details: {
                  streamWasIncomplete,
                  responseChars: source.length,
                  issues: latestReport.issues,
                },
              });

              if (attempt >= 3) {
                break;
              }

              artifactMessages = hasMissingRequiredSection(latestReport)
                ? buildArtifactRepairMessages(
                    messages,
                    format,
                    query,
                    templateId,
                    source,
                    latestReport,
                  )
                : buildArtifactContinuationMessages(
                    messages,
                    format,
                    query,
                    templateId,
                    source,
                    latestReport,
                  );
              controller.enqueue(
                encodeChatStreamEvent({
                  type: "status",
                  message: `${format.toUpperCase()} 内容仍不完整，正在进行第 ${attempt + 2} 次续写与修复。`,
                }),
              );
            }
            return { source: source.trim(), structuredPlan };
          };

          const useDedicatedArtifactMode = shouldUseDedicatedArtifactMode(
            intentPlan,
            requestedExportFormats,
          );

          const requestsDocx = requestedExportFormats.includes("docx");
          const isSingleDocxRequest =
            requestedExportFormats.length === 1 &&
            requestedExportFormats[0] === "docx";
          const documentV2Readiness = inspectDocumentV2Runtime();
          const useDocumentV2 =
            documentV2Readiness.publicEnabled &&
            useDedicatedArtifactMode &&
            isSingleDocxRequest;

          if (requestsDocx && !isSingleDocxRequest) {
            const error = new Error(
              "Word 文档必须由新版文档主链单独生成。请将 DOCX 与其他文件格式拆分为不同请求。",
            );
            await documentTrace?.fail({
              stage: "pipeline_selection",
              error,
              details: {
                selectedPipeline: "document_v2_required",
                requestedFormats: requestedExportFormats,
                reason: "mixed_docx_formats_are_not_supported",
              },
            });
            throw error;
          }

          if (
            requestsDocx &&
            !documentV2Readiness.publicEnabled
          ) {
            const error = new Error(
              "新版 Word 文档生成主链当前未启用，系统不会回退到旧版聊天文本导出。",
            );
            await documentTrace?.fail({
              stage: "pipeline_selection",
              error,
              details: {
                selectedPipeline: "document_v2_required",
                reason: "document_v2_runtime_disabled",
              },
            });
            throw error;
          }

          if (useDocumentV2) {
            requireDocumentV2PublicRuntime();
            const previousContent = shouldExportPreviousAssistant
              ? previousAssistantExportSource.trim()
              : "";
            const commandResult = await executeDocumentCommand({
              supabase,
              command: {
                type: "create_document",
                ownerId: user.id,
                instruction: query,
                previousAssistantContent: previousContent || undefined,
                requestUrl: request.url,
                textExecution: {
                  provider: modelOption.provider,
                  requestedModelId: modelOption.model,
                  resolvedModelId: modelOption.model,
                  maxOutputTokens: modelOption.maxOutputTokens,
                  reasoningEffort: modelOption.reasoningEffort,
                  allowProviderFallback: false,
                },
              },
            });
            const jobId = commandResult.jobId;
            await documentTrace?.event({
              stage: "pipeline_selection",
              status: "info",
              details: {
                selectedPipeline: "document_v2",
                jobId,
                reason: "dedicated_docx_request",
              },
            });
            controller.enqueue(
              encodeChatStreamEvent({
                type: "document_job",
                jobId,
              }),
            );
            controller.close();
            return;
          }

          if (useDedicatedArtifactMode) {
            const links: string[] = [];
            const artifactIds: string[] = [];
            await documentTrace?.event({
              stage: "pipeline_selection",
              status: "info",
              details: {
                selectedPipeline: "legacy_dedicated_artifact",
                reason: "dedicated_artifact_mode_matched",
              },
            });
            controller.enqueue(
              encodeChatStreamEvent({
                type: "status",
                message:
                  "已切换到文件生成模式：系统会在后台生成文件内容，不再把聊天正文直接塞进文档。",
              }),
            );

            for (const format of requestedExportFormats) {
              let activeStage = "template_resolution";
              const formatStartedAt = Date.now();
              try {
                const legacyTemplateId = selectExportTemplateId(query, format);
                const documentTemplate =
                  format === "docx"
                    ? resolveDocumentTemplate({
                        query,
                        format,
                        legacyTemplateId,
                      })
                    : undefined;
                const templateId =
                  documentTemplate?.rendererTemplateId ?? legacyTemplateId;
                await documentTrace?.setTemplate(
                  documentTemplate?.id ?? templateId,
                  documentTemplate?.version === undefined
                    ? undefined
                    : String(documentTemplate.version),
                );
                controller.enqueue(
                  encodeChatStreamEvent({
                    type: "status",
                    message: `正在生成 ${format.toUpperCase()} 文件内容并排版。`,
                  }),
                );
                activeStage = "content_generation";
                const generatedArtifact = await generateArtifactSource(
                  format,
                  modelOption,
                  modelTier,
                  templateId,
                  documentTemplate,
                );
                const artifactSource = generatedArtifact.source;
                if (!artifactSource) {
                  throw new Error("文件内容为空，未创建下载文件。");
                }
                let exportContent = artifactSource;
                let exportTitle = createArtifactExportTitle(query, artifactSource);
                let structuredDocument: DocumentSpec | undefined;
                let imageAssets: FinalImageAsset[] = [];
                const documentPlan = generatedArtifact.structuredPlan;
                if (format === "docx") {
                  activeStage = "document_validation";
                  if (!documentPlan) {
                    throw new Error("DOCX 模板规划缺失，未进入排版。");
                  }
                  structuredDocument = parseDocumentSpec(artifactSource) ?? undefined;
                  if (!structuredDocument) {
                    throw new Error("模型未交付有效的结构化文档，未进入排版。");
                  }
                  const validation = validateDocumentSpec(
                    structuredDocument,
                    documentPlan,
                  );
                  if (!validation.passed) {
                    await documentTrace?.event({
                      stage: "document_validation",
                      componentId: format,
                      status: "failed",
                      attempt: 1,
                      details: {
                        validationIssues: validation.issues,
                      },
                    });
                    throw new Error(
                      `结构化文档未通过最终校验：${validation.issues
                        .map((issue) => issue.message)
                        .join("；")}`,
                    );
                  }
                  await documentTrace?.event({
                    stage: "document_validation",
                    componentId: format,
                    status: "succeeded",
                    attempt: 1,
                    details: {
                      sectionCount: structuredDocument.sections.length,
                      visualRequestCount:
                        structuredDocument.visualRequests.length,
                      referenceCount: structuredDocument.references.length,
                    },
                  });
                  activeStage = "figure_generation";
                  imageAssets = await generateDocumentImageAssets(
                    structuredDocument,
                    user.id,
                    request.signal,
                    documentTrace ?? undefined,
                  );
                  exportContent = documentSpecToMarkdown(structuredDocument);
                  exportTitle = structuredDocument.title;
                }
                activeStage = "artifact_render_and_store";
                const renderStartedAt = Date.now();
                await documentTrace?.event({
                  stage: activeStage,
                  componentId: format,
                  attempt: 1,
                  status: "started",
                  details: {
                    templateId,
                    hasStructuredDocument: Boolean(structuredDocument),
                    imageAssetCount: imageAssets.length,
                  },
                });
                const created = await createExport(
                  {
                    format,
                    title: exportTitle,
                    content: exportContent,
                    metadata: {
                      source: "chat-dedicated-artifact-mode",
                      templateId,
                      documentTemplateId: documentPlan?.templateId,
                      documentTemplateVersion: documentPlan?.templateVersion,
                      documentTemplateSource: documentPlan?.templateSource,
                      artifactOnly: true,
                      requestQuery: query,
                      documentSpec: structuredDocument,
                      imageAssets,
                      documentLanguage: resolveDocumentLanguage({
                        query,
                        content: exportContent,
                      }),
                    },
                  },
                  user.id,
                );
                const artifactId = created.downloadUrl.split("/").at(-1);
                if (artifactId) artifactIds.push(artifactId);
                await documentTrace?.event({
                  stage: activeStage,
                  componentId: format,
                  attempt: 1,
                  status: "succeeded",
                  durationMs: Date.now() - renderStartedAt,
                  details: {
                    filename: created.filename,
                    artifactId,
                    totalFormatDurationMs: Date.now() - formatStartedAt,
                  },
                });
                links.push(`- [${created.filename}](${created.downloadUrl})`);
              } catch (exportError) {
                await documentTrace?.event({
                  stage: activeStage,
                  componentId: format,
                  attempt: 1,
                  status: "failed",
                  durationMs: Date.now() - formatStartedAt,
                  error: exportError,
                });
                const message =
                  exportError instanceof Error ? exportError.message : "未知错误";
                links.push(buildRecoverableExportFailureLine(format, message));
              }
            }
            if (artifactIds.length > 0) {
              await documentTrace?.complete({
                artifactIds,
                details: {
                  selectedPipeline: "legacy_dedicated_artifact",
                  succeededFormats: artifactIds.length,
                  requestedFormats: requestedExportFormats.length,
                },
              });
            } else {
              await documentTrace?.fail({
                stage: "document_generation",
                error: new Error("所有请求格式均未生成可下载文件。"),
              });
            }

            controller.enqueue(
              encodeChatStreamEvent({
                type: "text",
                delta: [
                  "已完成文件生成。正文没有在聊天区重复展开，避免把聊天回答误当成文档内容。",
                  buildExportLinksMessage(links),
                ].join("\n\n"),
              }),
            );
            controller.close();
            return;
          }

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
            const artifactIds: string[] = [];
            const title = createCleanExportTitle(query);
            await documentTrace?.event({
              stage: "pipeline_selection",
              status: "info",
              details: {
                selectedPipeline: "legacy_chat_auto_export",
                reason: "chat_response_completed_with_requested_formats",
              },
            });

            for (const format of requestedFormats) {
              const exportStartedAt = Date.now();
              try {
                await documentTrace?.event({
                  stage: "artifact_render_and_store",
                  componentId: format,
                  attempt: 1,
                  status: "started",
                  details: { source: "generated_chat_response" },
                });
                const created = await createExport(
                  {
                    format,
                    title,
                    content: assistantText,
                    metadata: {
                      source: "chat-auto-export",
                      templateId: selectExportTemplateId(query, format),
                      documentLanguage: resolveDocumentLanguage({
                        query,
                        content: assistantText,
                      }),
                      requestQuery: query,
                    },
                  },
                  user.id,
                );
                const artifactId = created.downloadUrl.split("/").at(-1);
                if (artifactId) artifactIds.push(artifactId);
                await documentTrace?.event({
                  stage: "artifact_render_and_store",
                  componentId: format,
                  attempt: 1,
                  status: "succeeded",
                  durationMs: Date.now() - exportStartedAt,
                  details: { filename: created.filename, artifactId },
                });
                links.push(`- [${created.filename}](${created.downloadUrl})`);
              } catch (exportError) {
                await documentTrace?.event({
                  stage: "artifact_render_and_store",
                  componentId: format,
                  attempt: 1,
                  status: "failed",
                  durationMs: Date.now() - exportStartedAt,
                  error: exportError,
                });
                const message =
                  exportError instanceof Error
                    ? exportError.message
                    : "未知错误";
                links.push(buildRecoverableExportFailureLine(format, message));
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
            if (artifactIds.length > 0) {
              await documentTrace?.complete({
                artifactIds,
                details: {
                  selectedPipeline: "legacy_chat_auto_export",
                  succeededFormats: artifactIds.length,
                  requestedFormats: requestedFormats.length,
                },
              });
            } else {
              await documentTrace?.fail({
                stage: "artifact_render_and_store",
                error: new Error("所有请求格式均未生成可下载文件。"),
              });
            }
          } else if (requestedFormats.length > 0) {
            await documentTrace?.fail({
              stage: "content_generation",
              error: streamFailure ?? new Error("模型没有生成可导出的正文。"),
              details: { assistantTextChars: assistantText.trim().length },
            });
          }
          controller.close();
        } catch (error) {
          await documentTrace?.fail({
            stage: "unhandled_pipeline_error",
            error,
          });
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
