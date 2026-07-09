// Server-only module.

import OpenAI from "openai";
import { AIProviderError } from "@/lib/ai/errors";
import { LiteratureError } from "@/lib/literature/errors";
import {
  REVIEW_LENGTH_WORD_TARGETS,
} from "@/lib/literature/review/constants";
import type { LiteratureReviewRequest } from "@/lib/literature/review/types";
import { buildReviewPaperContext } from "@/lib/literature/server/review-papers";
import type { LiteraturePaper } from "@/lib/literature/types";

type ReviewPaperContext = ReturnType<typeof buildReviewPaperContext>[number];

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
    return `约 ${request.customWordCount} 字`;
  }

  return REVIEW_LENGTH_WORD_TARGETS[request.length];
}

function buildInstructionSummary(request: LiteratureReviewRequest): string {
  return [
    `综述主题：${request.topic}`,
    `写作视角：${resolvePerspective(request)}`,
    `目标读者：${request.targetAudience}`,
    `输出类型：${request.outputType}`,
    `语言：${request.language}`,
    `篇幅：${resolveLengthTarget(request)}`,
    `必需结构：${request.requiredSections.join("、")}`,
    request.additionalInstructions
      ? `补充说明：${request.additionalInstructions}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildEvidenceRules(): string {
  return [
    "When fullTextExcerpt is present, use it as the primary evidence; use abstract only when full text is unavailable.",
    "只能使用用户提供的文件夹文献作为证据来源。",
    "不得虚构论文、作者、年份、方法、数据集或实验结果。",
    "引用时必须使用提供文献中的真实标题、作者与年份。",
    "正文中使用作者-年份式引用，例如：Zhang 等（2024）指出……。",
    "参考文献表只能列出提供过的文献；如果 DOI 或期刊信息缺失，不要编造。",
    "若证据不足，必须明确写出“现有文件夹文献不足以支撑该部分结论”。",
  ].join("\n");
}

function buildDeliverableRules(): string {
  return [
    "交付目标不是普通摘要，而是可直接用于导师汇报、课程作业和科研交流的成果稿。",
    "必须包含：核心洞察、研究空白、未来方向、方法/框架对比、规范引用和参考文献。",
    "必须主动设计图表说明，至少包含 Timeline、Taxonomy、Framework、Comparison 中的三类。",
    "每个图表说明必须包含：图题、图意、建议呈现元素、对应文献证据。",
    "语言要学术、克制、可发表，避免口号式表达。",
  ].join("\n");
}

function buildPaperListPrompt(papers: ReviewPaperContext[]): string {
  return JSON.stringify(papers, null, 2);
}

function extractMarkdownContent(content: string): string {
  return content.trim();
}

export async function generateReviewOutline(
  request: LiteratureReviewRequest,
  papers: LiteraturePaper[],
  signal?: AbortSignal,
): Promise<string> {
  const context = buildReviewPaperContext(papers);
  const client = getClient();

  const completion = await client.chat.completions.create(
    {
      model: getTextModel(),
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
            "## 参考文献规划",
          ].join("\n"),
        },
      ],
    },
    { signal },
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
  const context = buildReviewPaperContext(papers);
  const client = getClient();

  const completion = await client.chat.completions.create(
    {
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content: [
            "你是 ResearchAI 的高级科研综述写作助手。",
            buildEvidenceRules(),
            buildDeliverableRules(),
            "请严格遵循用户确认的大纲，撰写可直接交付的完整综述。",
            "正文需要专业排版结构：摘要、关键词、引言、主题综述、图表说明、综合分析、研究空白、未来方向、结论、参考文献。",
            "请在正文中插入明确的图表占位，格式为：",
            "> 图表建议：Figure 1｜图题｜图表类型｜应呈现的变量/节点｜对应文献证据",
            "请至少输出 4 个图表建议：Timeline、Taxonomy、Framework、Comparison。",
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
    { signal },
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
  const context = buildReviewPaperContext(papers);
  const client = getClient();

  const completion = await client.chat.completions.create(
    {
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content: [
            "你是 ResearchAI 的学术汇报策划与 PPT 导演。",
            buildEvidenceRules(),
            "请把综述正文转成学术汇报风格 PPT 大纲。",
            "PPT 原则：少字、多图、强故事线；每页只讲一个点，每页必须有一句简洁结论。",
            "每页必须指定图示类型：timeline、taxonomy、framework、comparison、insight、gap、future、summary 中的一种。",
            "每页格式必须严格如下：",
            "## 页标题",
            "结论：一句话结论，不超过 28 个中文字符。",
            "图示：timeline/taxonomy/framework/comparison/insight/gap/future/summary",
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
    { signal },
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new LiteratureError("AI 未返回有效 PPT 大纲。", 502);
  }

  return extractMarkdownContent(content);
}
