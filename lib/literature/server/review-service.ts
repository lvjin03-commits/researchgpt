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
    "只能使用用户提供的文件夹文献作为证据来源。",
    "不得虚构论文、作者、年份或实验结果。",
    "引用时必须使用所提供文献的真实标题、作者与年份。",
    "若某章节证据不足，必须明确写出“现有文件夹文献不足以支撑该部分结论”。",
    "不要引用文件夹以外的文献。",
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
            "你是 ResearchAI 的文献综述写作助手。",
            buildEvidenceRules(),
            "请根据用户写作指令，基于文件夹文献生成可编辑的 Markdown 大纲。",
            "大纲应覆盖用户要求的结构章节，并在各章节下列出将引用的代表性文献（标题 + 作者 + 年份）。",
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
            "请生成详细大纲，使用 ## 作为章节标题。",
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
            "你是 ResearchAI 的文献综述写作助手。",
            buildEvidenceRules(),
            "请严格遵循用户确认的大纲与写作指令撰写完整综述。",
            "正文中引用文献时使用“作者（年份）《标题》”格式，且只能引用提供的文献。",
            "输出纯 Markdown，包含用户要求的结构章节。",
            `目标语言：${request.language}`,
            `目标篇幅：${resolveLengthTarget(request)}`,
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
            "你是 ResearchAI 的学术汇报助手。",
            buildEvidenceRules(),
            "请基于已生成的综述正文，输出 PPT 汇报大纲。",
            "每页幻灯片使用 ## 标题，下面用 - 列出 3-5 条要点。",
            "只能引用文件夹中已有的文献，不得虚构。",
            "输出纯 Markdown。",
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
            "请生成 8-15 页 PPT 大纲。",
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
