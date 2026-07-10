// Server-only module.

import OpenAI from "openai";
import { AIProviderError } from "@/lib/ai/errors";
import { LiteratureError } from "@/lib/literature/errors";
import { REVIEW_LENGTH_WORD_TARGETS } from "@/lib/literature/review/constants";
import type { LiteratureReviewRequest } from "@/lib/literature/review/types";
import { buildReviewPaperContext } from "@/lib/literature/server/review-papers";
import type { LiteraturePaper } from "@/lib/literature/types";

type ReviewPaperContext = ReturnType<typeof buildReviewPaperContext>[number];

const REVIEW_CONTEXT_LIMITS = {
  outline: {
    maxFullTextChars: 2500,
    maxFigureEvidence: 4,
    maxFigureCaptionChars: 450,
  },
  full: {
    maxFullTextChars: 5000,
    maxFigureEvidence: 6,
    maxFigureCaptionChars: 600,
  },
  ppt: {
    maxFullTextChars: 3000,
    maxFigureEvidence: 5,
    maxFigureCaptionChars: 500,
  },
} as const;

function buildContextForPhase(
  request: LiteratureReviewRequest,
  papers: LiteraturePaper[],
  phase: keyof typeof REVIEW_CONTEXT_LIMITS,
) {
  const academic = request.workflowMode === "academic_review";

  return buildReviewPaperContext(papers, {
    ...REVIEW_CONTEXT_LIMITS[phase],
    includeFullText: academic,
    includeWorkspaceAnalysis: academic,
  });
}

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new AIProviderError("OPENAI_API_KEY is not configured", {
      statusCode: 500,
      provider: "openai",
    });
  }

  return new OpenAI({ apiKey });
}

function getTextModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function resolvePerspective(request: LiteratureReviewRequest): string {
  return request.perspective === "自定义"
    ? request.customPerspective || request.perspective
    : request.perspective;
}

function resolveLengthTarget(request: LiteratureReviewRequest): string {
  if (request.length === "自定义字数") {
    return `约 ${request.customWordCount || 3000} 字`;
  }

  return REVIEW_LENGTH_WORD_TARGETS[request.length];
}

function buildInstructionSummary(request: LiteratureReviewRequest): string {
  return [
    `生成模式：${
      request.workflowMode === "academic_review"
        ? "学术汇报综述（基于全文分析）"
        : "快速大纲（仅题目、摘要和元数据）"
    }`,
    `综述主题：${request.topic}`,
    `写作视角：${resolvePerspective(request)}`,
    `目标读者：${request.targetAudience}`,
    `输出类型：${request.outputType}`,
    `语言：${request.language}`,
    `篇幅：${resolveLengthTarget(request)}`,
    `必须结构：${request.requiredSections.join("、")}`,
    request.additionalInstructions
      ? `补充说明：${request.additionalInstructions}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildEvidenceRules(): string {
  return [
    "只能使用用户文献夹中的文献作为证据来源，不得虚构论文、作者、年份、方法、数据集或实验结果。",
    "当 fullTextExcerpt 存在时，优先使用全文摘录作为证据；全文不可用时才使用摘要。",
    "当 figureEvidence 存在时，优先把其中的 Figure/Table caption 作为图表证据，不要生成与正文论点无关的装饰性图。",
    "每个证据图表必须紧跟它支持的段落，说明它证明了什么、来自哪篇文献、对应 Figure/Table 编号是什么。",
    "正文引用使用作者-年份格式，例如：Zhang 等（2024）指出……",
    "参考文献表只能列出提供过的文献；如果 DOI 或期刊信息缺失，不要编造。",
    "若证据不足，必须明确写出“现有文献夹文献不足以支撑该部分结论”。",
  ].join("\n");
}

function buildDeliverableRules(): string {
  return [
    "交付目标不是普通摘要，而是可直接用于导师汇报、课程作业和科研交流的成果稿。",
    "必须包含：核心洞察、研究空白、未来方向、方法/框架对比、规范引用和参考文献。",
    "必须主动设计图表说明，至少包含 Timeline、Taxonomy、Framework、Comparison 中的三类。",
    "如果可用文献中有 figureEvidence，优先输出证据图表块，格式必须为：",
    "> Evidence Figure: Figure 1｜图题｜来源论文标题｜该图表支持的结论｜caption 摘要",
    "也可使用 Evidence Table；不要使用无来源、无论点支撑的图表。",
    "语言要学术、克制、可发表，避免口号式表达。",
  ].join("\n");
}

function buildPaperListPrompt(papers: ReviewPaperContext[]): string {
  return JSON.stringify(papers, null, 2);
}

function extractMarkdownContent(content: string): string {
  return content.trim();
}

async function createReviewCompletion(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  signal?: AbortSignal,
) {
  try {
    return await client.chat.completions.create(params, { signal });
  } catch (error) {
    if (error instanceof AIProviderError) {
      throw error;
    }

    if (error instanceof OpenAI.APIError) {
      let message = `AI 服务请求失败：${error.message}`;

      if (error.status === 401) {
        message = "AI 服务认证失败，请检查线上 OPENAI_API_KEY 配置。";
      } else if (error.status === 429) {
        message = "AI 服务额度不足或请求过于频繁，请稍后重试或检查账户额度。";
      }

      throw new AIProviderError(message, {
        statusCode: error.status ?? 502,
        provider: "openai",
        cause: error,
      });
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new AIProviderError("生成任务已取消。", {
        statusCode: 499,
        provider: "openai",
        cause: error,
      });
    }

    throw new AIProviderError("AI 服务暂时无法完成生成，请稍后重试。", {
      statusCode: 502,
      provider: "openai",
      cause: error,
    });
  }
}

export async function generateReviewOutline(
  request: LiteratureReviewRequest,
  papers: LiteraturePaper[],
  signal?: AbortSignal,
): Promise<string> {
  const context = buildContextForPhase(request, papers, "outline");
  const client = getClient();

  const completion = await createReviewCompletion(
    client,
    {
      model: getTextModel(),
      max_completion_tokens: 2200,
      messages: [
        {
          role: "system",
          content: [
            "你是 ResearchAI 的高级科研写作与学术汇报策划助手。",
            buildEvidenceRules(),
            buildDeliverableRules(),
            "请生成可编辑的 Markdown 综述大纲。",
            "大纲必须同时规划正文结构、图表结构、引用策略和汇报故事线。",
            "输出纯 Markdown，不要 JSON。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            buildInstructionSummary(request),
            "",
            "可用文献（仅限以下条目）：",
            buildPaperListPrompt(context),
            "",
            "请按以下结构生成详细大纲：",
            "## 研究背景与问题定义",
            "## 文献脉络与 Timeline 图",
            "## 主题分类与 Taxonomy 图",
            "## 方法框架与 Framework 图",
            "## 代表性文献 Comparison 表",
            "## 核心 Insight",
            "## Research Gap",
            "## Future Direction",
            "## 证据图表与引用规划",
            "## 参考文献规划",
          ].join("\n"),
        },
      ],
    },
    signal,
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new LiteratureError("AI 未返回有效大纲。", 502);
  }

  return extractMarkdownContent(content);
}

export async function generateReviewFullText(
  request: LiteratureReviewRequest,
  papers: LiteraturePaper[],
  signal?: AbortSignal,
): Promise<string> {
  const context = buildContextForPhase(request, papers, "full");
  const client = getClient();

  const completion = await createReviewCompletion(
    client,
    {
      model: getTextModel(),
      max_completion_tokens: 5200,
      messages: [
        {
          role: "system",
          content: [
            "你是 ResearchAI 的高级科研综述写作助手。",
            buildEvidenceRules(),
            buildDeliverableRules(),
            "请严格遵循用户确认的大纲，撰写可直接交付的完整综述。",
            "正文需要专业排版结构：摘要、关键词、引言、主题综述、图表说明、综合分析、研究空白、未来方向、结论、参考文献。",
            "正文中必须插入明确的证据图表块。优先使用 Evidence Figure/Evidence Table 格式，让导出 DOCX 能自动排成图表说明框。",
            "图表块必须与前后正文相关，用来证明或解释相邻段落的具体结论，不得随机插入。",
            "输出纯 Markdown。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            buildInstructionSummary(request),
            "",
            "用户确认的大纲：",
            request.confirmedOutline,
            "",
            "可用文献（仅限以下条目）：",
            buildPaperListPrompt(context),
          ].join("\n"),
        },
      ],
    },
    signal,
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new LiteratureError("AI 未返回有效综述正文。", 502);
  }

  return extractMarkdownContent(content);
}

export async function generateReviewPptOutline(
  request: LiteratureReviewRequest,
  papers: LiteraturePaper[],
  signal?: AbortSignal,
): Promise<string> {
  const context = buildContextForPhase(request, papers, "ppt");
  const client = getClient();

  const completion = await createReviewCompletion(
    client,
    {
      model: getTextModel(),
      max_completion_tokens: 2600,
      messages: [
        {
          role: "system",
          content: [
            "你是 ResearchAI 的学术汇报策划与 PPT 导演。",
            buildEvidenceRules(),
            "请把综述正文转成学术汇报风格 PPT 大纲。",
            "PPT 原则：少字、多图、强故事线；每页只讲一个点，每页必须有一句简洁结论。",
            "每页必须指定图示类型：timeline、taxonomy、framework、comparison、insight、gap、future、summary 中的一种。",
            "如果 figureEvidence 可用，每页尽量引用一个相关 Evidence Figure/Evidence Table，作为右侧证据说明。",
            "每页格式必须严格如下：",
            "## 页标题",
            "结论：一句话结论，不超过 28 个中文字符。",
            "图示：timeline/taxonomy/framework/comparison/insight/gap/future/summary",
            "证据：Evidence Figure/Table｜来源论文标题｜该页结论对应的图表证据",
            "- 要点 1（引用作者年份或文献标题）",
            "- 要点 2",
            "- 要点 3",
            "输出 8-15 页，纯 Markdown。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            buildInstructionSummary(request),
            "",
            "已生成综述正文：",
            request.reviewContent,
            "",
            "可用文献（仅限以下条目）：",
            buildPaperListPrompt(context),
            "",
            "请生成可直接用于导师汇报的 PPT 大纲。",
          ].join("\n"),
        },
      ],
    },
    signal,
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new LiteratureError("AI 未返回有效 PPT 大纲。", 502);
  }

  return extractMarkdownContent(content);
}
