// Server-only module.

import OpenAI from "openai";
import { AIProviderError } from "@/lib/ai/errors";
import { LiteratureError } from "@/lib/literature/errors";
import {
  deriveWorkspaceAnalysisFromPaper,
  isValidWorkspaceAnalysis,
} from "@/lib/literature/paper-workspace-display";
import type {
  LiteraturePaper,
  PaperWorkspaceAnalysis,
  PaperWorkspaceDifficulty,
} from "@/lib/literature/types";
import type { ReviewModel } from "@/lib/literature/review/types";

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

function getTextModel(model?: ReviewModel): string {
  return model || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function clampScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 3;
  }

  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function parseDifficulty(value: unknown): PaperWorkspaceDifficulty {
  if (value === "Beginner" || value === "Intermediate" || value === "Advanced") {
    return value;
  }

  return "Intermediate";
}

function parseWorkspaceRecord(
  record: Record<string, unknown>,
  evidenceLevel: PaperWorkspaceAnalysis["evidenceLevel"],
  model: string,
): PaperWorkspaceAnalysis | null {
  const readingGuideRaw =
    typeof record.readingGuide === "object" && record.readingGuide !== null
      ? (record.readingGuide as Record<string, unknown>)
      : null;
  const researchValueRaw =
    typeof record.researchValue === "object" && record.researchValue !== null
      ? (record.researchValue as Record<string, unknown>)
      : null;

  if (!readingGuideRaw || !researchValueRaw) {
    return null;
  }

  const suggestedReadingOrder = Array.isArray(readingGuideRaw.suggestedReadingOrder)
    ? readingGuideRaw.suggestedReadingOrder.filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  const workspace: PaperWorkspaceAnalysis = {
    oneSentenceSummary: String(record.oneSentenceSummary ?? "").trim(),
    researchProblem: String(record.researchProblem ?? "").trim(),
    coreMethod: String(record.coreMethod ?? "").trim(),
    mainContributions: String(record.mainContributions ?? "").trim(),
    experimentalResults: String(record.experimentalResults ?? "").trim(),
    limitations: String(record.limitations ?? "").trim(),
    whyItMatters: String(record.whyItMatters ?? "").trim(),
    readingGuide: {
      estimatedReadingMinutes: Math.max(
        5,
        Math.round(Number(readingGuideRaw.estimatedReadingMinutes) || 15),
      ),
      suggestedReadingOrder:
        suggestedReadingOrder.length > 0
          ? suggestedReadingOrder
          : [
              "Read abstract and summary",
              "Review methods and contributions",
              "Check results and limitations",
            ],
      difficulty: parseDifficulty(readingGuideRaw.difficulty),
    },
    researchValue: {
      novelty: clampScore(researchValueRaw.novelty),
      technicalDepth: clampScore(researchValueRaw.technicalDepth),
      industrialPotential: clampScore(researchValueRaw.industrialPotential),
      readingPriority: clampScore(researchValueRaw.readingPriority),
    },
    generatedAt: new Date().toISOString(),
    evidenceLevel,
    model,
  };

  return isValidWorkspaceAnalysis(workspace) ? workspace : null;
}

export async function generatePaperWorkspaceAnalysis(
  paper: LiteraturePaper,
  signal?: AbortSignal,
  options: { requireFullText?: boolean; model?: ReviewModel } = {},
): Promise<PaperWorkspaceAnalysis> {
  try {
    if (options.requireFullText && !paper.fullText?.trim()) {
      throw new LiteratureError(
        `《${paper.title}》没有可读取的 PDF 全文，请先上传有效 PDF。`,
        422,
      );
    }

    const client = getClient();
    const evidenceLevel = paper.fullText ? "full_text" : "abstract_only";
    const model = getTextModel(options.model);

    const completion = await client.chat.completions.create(
      {
        model,
        reasoning_effort: "none",
        max_completion_tokens: 2500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a research paper analysis assistant for ResearchGPT.",
              "Return JSON only with shape:",
              '{"oneSentenceSummary":"...","researchProblem":"...","coreMethod":"...","mainContributions":"...","experimentalResults":"...","limitations":"...","whyItMatters":"...","readingGuide":{"estimatedReadingMinutes":15,"suggestedReadingOrder":["..."],"difficulty":"Beginner|Intermediate|Advanced"},"researchValue":{"novelty":1-5,"technicalDepth":1-5,"industrialPotential":1-5,"readingPriority":1-5}}',
              "All descriptive text fields and suggestedReadingOrder must use concise professional Chinese. Keep paper titles, author names, chemical formulas, gene names, material names, model names, dataset names, and standard technical abbreviations in their original form.",
              "The readingGuide.difficulty value must remain exactly one of Beginner, Intermediate, or Advanced.",
              "When fullText is present, analyze evidence across the entire supplied paper text instead of relying on the abstract.",
              "Scores must be integers from 1 to 5.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              title: paper.title,
              authors: paper.authors,
              abstract: paper.abstract.slice(0, 4000),
              fullText: paper.fullText?.slice(0, 60000) ?? null,
              evidenceLevel,
              categories: paper.categories,
              existingSummary: paper.chineseSummary,
              recommendationReason: paper.recommendationReason,
            }),
          },
        ],
      },
      { signal },
    );

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new LiteratureError(
        "The workspace analysis provider returned an empty response.",
        502,
      );
    }

    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      throw new LiteratureError(
        "The workspace analysis provider returned invalid JSON.",
        502,
      );
    }

    const workspace = parseWorkspaceRecord(
      parsed as Record<string, unknown>,
      evidenceLevel,
      model,
    );
    if (!workspace) {
      throw new LiteratureError(
        "The workspace analysis provider returned an unexpected JSON shape.",
        502,
      );
    }

    return workspace;
  } catch (error) {
    if (error instanceof LiteratureError || error instanceof AIProviderError) {
      throw error;
    }

    if (error instanceof OpenAI.APIError) {
      const message =
        error.status === 429
          ? "OpenAI API 额度不足或请求过于频繁，请检查账户余额后重试。"
          : `AI 文献分析失败：${error.message}`;
      throw new AIProviderError(message, {
        statusCode: error.status ?? 502,
        provider: "openai",
        cause: error,
      });
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new AIProviderError("文献分析已取消。", {
        statusCode: 499,
        provider: "openai",
        cause: error,
      });
    }

    console.error("[literature] workspace analysis fallback:", error);
    if (options.requireFullText) {
      throw new AIProviderError("AI 无法完成该文献的全文分析。", {
        statusCode: 502,
        provider: "openai",
        cause: error,
      });
    }
    return deriveWorkspaceAnalysisFromPaper(paper);
  }
}

export function resolvePaperWorkspaceAnalysis(
  paper: LiteraturePaper,
): PaperWorkspaceAnalysis {
  if (paper.workspaceAnalysis && isValidWorkspaceAnalysis(paper.workspaceAnalysis)) {
    return paper.workspaceAnalysis;
  }

  return deriveWorkspaceAnalysisFromPaper(paper);
}
