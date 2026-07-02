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

function parseWorkspaceRecord(record: Record<string, unknown>): PaperWorkspaceAnalysis | null {
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
  };

  return isValidWorkspaceAnalysis(workspace) ? workspace : null;
}

export async function generatePaperWorkspaceAnalysis(
  paper: LiteraturePaper,
  signal?: AbortSignal,
): Promise<PaperWorkspaceAnalysis> {
  try {
    const client = getClient();

    const completion = await client.chat.completions.create(
      {
        model: getTextModel(),
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a research paper analysis assistant for ResearchGPT.",
              "Return JSON only with shape:",
              '{"oneSentenceSummary":"...","researchProblem":"...","coreMethod":"...","mainContributions":"...","experimentalResults":"...","limitations":"...","whyItMatters":"...","readingGuide":{"estimatedReadingMinutes":15,"suggestedReadingOrder":["..."],"difficulty":"Beginner|Intermediate|Advanced"},"researchValue":{"novelty":1-5,"technicalDepth":1-5,"industrialPotential":1-5,"readingPriority":1-5}}',
              "Write concise English. Base analysis on title and abstract.",
              "Scores must be integers from 1 to 5.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              title: paper.title,
              authors: paper.authors,
              abstract: paper.abstract.slice(0, 4000),
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

    const workspace = parseWorkspaceRecord(parsed as Record<string, unknown>);
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

    console.error("[literature] workspace analysis fallback:", error);
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
