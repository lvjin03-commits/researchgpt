// Server-only module.

import OpenAI from "openai";
import { AIProviderError } from "@/lib/ai/errors";
import { LITERATURE_ANALYSIS_BATCH_SIZE } from "@/lib/literature/constants";
import { LiteratureError } from "@/lib/literature/errors";
import type {
  ArxivPaperDraft,
  LiteratureSettings,
  PaperAnalysisResult,
} from "@/lib/literature/types";

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

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

async function analyzePaperBatch(
  papers: ArxivPaperDraft[],
  settings: LiteratureSettings,
  signal?: AbortSignal,
): Promise<PaperAnalysisResult[]> {
  const client = getClient();

  const payload = papers.map((paper) => ({
    arxivId: paper.arxivId,
    title: paper.title,
    abstract: paper.abstract.slice(0, 2500),
    categories: paper.categories,
  }));

  const completion = await client.chat.completions.create(
    {
      model: getTextModel(),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are a research literature triage assistant for ResearchGPT Literature Tracker.",
            "Evaluate each paper for the user's research direction and keywords.",
            "Return JSON only with shape:",
            '{"papers":[{"arxivId":"...","relevanceScore":0-100,"priority":"recommended|skim|skip","chineseSummary":"...","recommendationReason":"..."}]}',
            "chineseSummary must be structured Chinese markdown with sections:",
            "## 研究主题",
            "## 核心方法",
            "## 主要发现",
            "## 创新点",
            "## 局限性",
            "recommendationReason should be concise English explaining the priority.",
            "priority rules: recommended = highly relevant, skim = somewhat relevant, skip = low relevance or excluded topic.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            researchDirection: settings.researchDirection,
            keywords: settings.keywords,
            excludeKeywords: settings.excludeKeywords,
            papers: payload,
          }),
        },
      ],
    },
    { signal },
  );

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new LiteratureError(
      "The literature analysis provider returned an empty response.",
      502,
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new LiteratureError(
      "The literature analysis provider returned invalid JSON.",
      502,
    );
  }

  const items =
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { papers?: unknown }).papers)
      ? (parsed as { papers: unknown[] }).papers
      : null;

  if (!items) {
    throw new LiteratureError(
      "The literature analysis provider returned an unexpected JSON shape.",
      502,
    );
  }

  const results: PaperAnalysisResult[] = [];

  for (const item of items) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const arxivId = record.arxivId;
    const priority = record.priority;
    const chineseSummary = record.chineseSummary;
    const recommendationReason = record.recommendationReason;
    const relevanceScore = Number(record.relevanceScore);

    if (
      typeof arxivId !== "string" ||
      typeof chineseSummary !== "string" ||
      typeof recommendationReason !== "string" ||
      !Number.isFinite(relevanceScore) ||
      (priority !== "recommended" &&
        priority !== "skim" &&
        priority !== "skip")
    ) {
      continue;
    }

    results.push({
      arxivId,
      relevanceScore: Math.max(0, Math.min(100, Math.round(relevanceScore))),
      priority,
      chineseSummary: chineseSummary.trim(),
      recommendationReason: recommendationReason.trim(),
    });
  }

  return results;
}

export async function analyzeArxivPapers(
  papers: ArxivPaperDraft[],
  settings: LiteratureSettings,
  signal?: AbortSignal,
): Promise<Map<string, PaperAnalysisResult>> {
  const results = new Map<string, PaperAnalysisResult>();
  const batches = chunk(papers, LITERATURE_ANALYSIS_BATCH_SIZE);

  console.log(`[literature] openai papers sent: ${papers.length}`);
  console.log(`[literature] openai batches: ${batches.length}`);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const batchNumber = index + 1;
    console.log(
      `[literature] openai batch ${batchNumber}/${batches.length}: start papers=${batch.length}`,
    );
    const batchStartedAt = Date.now();
    const analyzed = await analyzePaperBatch(batch, settings, signal);
    console.log(
      `[literature] openai batch ${batchNumber}/${batches.length}: done elapsedMs=${Date.now() - batchStartedAt} results=${analyzed.length}`,
    );

    for (const item of analyzed) {
      results.set(item.arxivId, item);
    }
  }

  return results;
}