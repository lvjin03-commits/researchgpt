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
  PaperEvidenceItem,
  PaperKeyExperiment,
  PaperVisualizationPlan,
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

function cleanStringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function parseEvidenceItems(value: unknown): PaperEvidenceItem[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 16).flatMap((item, index) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const claim = String(record.claim ?? "").trim();
    const evidence = String(record.evidence ?? "").trim();
    if (!claim || !evidence) return [];
    const sourceType =
      record.sourceType === "figure" ||
      record.sourceType === "table" ||
      record.sourceType === "text"
        ? record.sourceType
        : "text";
    const strength =
      record.strength === "high" ||
      record.strength === "medium" ||
      record.strength === "low"
        ? record.strength
        : "medium";
    const numericPage = Number(record.page);

    return [{
      id: String(record.id ?? `evidence-${index + 1}`),
      claim,
      sourceType,
      sourceRef: String(record.sourceRef ?? "正文").trim() || "正文",
      page: Number.isFinite(numericPage) && numericPage > 0
        ? Math.round(numericPage)
        : null,
      evidence,
      interpretation: String(record.interpretation ?? "").trim(),
      limitation: String(record.limitation ?? "").trim(),
      strength,
    } satisfies PaperEvidenceItem];
  });
}

function parseKeyExperiments(value: unknown): PaperKeyExperiment[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 10).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const title = String(record.title ?? "").trim();
    if (!title) return [];
    return [{
      title,
      purpose: String(record.purpose ?? "").trim(),
      design: String(record.design ?? "").trim(),
      variables: String(record.variables ?? "").trim(),
      conditions: String(record.conditions ?? "").trim(),
      result: String(record.result ?? "").trim(),
      evidenceRefs: cleanStringArray(record.evidenceRefs, 8),
    } satisfies PaperKeyExperiment];
  });
}

function parseVisualizationPlans(value: unknown): PaperVisualizationPlan[] {
  if (!Array.isArray(value)) return [];
  const chartTypes = new Set<PaperVisualizationPlan["chartType"]>([
    "bar", "line", "scatter", "heatmap", "pie", "stacked_bar",
    "process", "timeline", "mechanism", "evidence_card",
  ]);
  const dataStatuses = new Set<PaperVisualizationPlan["dataStatus"]>([
    "exact", "table_extractable", "figure_only", "conceptual", "insufficient",
  ]);

  return value.slice(0, 12).flatMap((item, index) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const title = String(record.title ?? "").trim();
    if (!title) return [];
    const chartType = chartTypes.has(record.chartType as PaperVisualizationPlan["chartType"])
      ? (record.chartType as PaperVisualizationPlan["chartType"])
      : "evidence_card";
    const dataStatus = dataStatuses.has(record.dataStatus as PaperVisualizationPlan["dataStatus"])
      ? (record.dataStatus as PaperVisualizationPlan["dataStatus"])
      : "insufficient";
    const dataPoints = Array.isArray(record.dataPoints)
      ? record.dataPoints.slice(0, 24).flatMap((point) => {
          if (typeof point !== "object" || point === null) return [];
          const pointRecord = point as Record<string, unknown>;
          const value = Number(pointRecord.value);
          const label = String(pointRecord.label ?? "").trim();
          if (!label || !Number.isFinite(value)) return [];
          return [{
            label,
            value,
            unit: String(pointRecord.unit ?? "").trim(),
            series: String(pointRecord.series ?? "").trim(),
          }];
        })
      : [];

    return [{
      id: String(record.id ?? `visual-${index + 1}`),
      title,
      chartType,
      purpose: String(record.purpose ?? "").trim(),
      takeaway: String(record.takeaway ?? "").trim(),
      sourceRefs: cleanStringArray(record.sourceRefs, 8),
      dataStatus,
      dataPoints,
      caution: String(record.caution ?? "").trim(),
    } satisfies PaperVisualizationPlan];
  });
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
    coreHypothesis: String(record.coreHypothesis ?? "").trim(),
    technicalRoute: cleanStringArray(record.technicalRoute, 12),
    keyExperiments: parseKeyExperiments(record.keyExperiments),
    evidenceItems: parseEvidenceItems(record.evidenceItems),
    innovations: cleanStringArray(record.innovations, 10),
    futureDirections: cleanStringArray(record.futureDirections, 10),
    visualizationPlans: parseVisualizationPlans(record.visualizationPlans),
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
        max_completion_tokens: 6500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a research paper analysis assistant for ResearchGPT.",
              "Return JSON only with shape:",
              '{"oneSentenceSummary":"...","researchProblem":"...","coreHypothesis":"...","coreMethod":"...","technicalRoute":["step 1","step 2"],"keyExperiments":[{"title":"...","purpose":"...","design":"...","variables":"...","conditions":"...","result":"...","evidenceRefs":["Figure 2, page 5"]}],"evidenceItems":[{"id":"E1","claim":"...","sourceType":"figure|table|text","sourceRef":"Figure 2b","page":5,"evidence":"...","interpretation":"...","limitation":"...","strength":"high|medium|low"}],"mainContributions":"...","innovations":["..."],"experimentalResults":"...","limitations":"...","whyItMatters":"...","futureDirections":["..."],"visualizationPlans":[{"id":"V1","title":"...","chartType":"bar|line|scatter|heatmap|pie|stacked_bar|process|timeline|mechanism|evidence_card","purpose":"...","takeaway":"...","sourceRefs":["Table 2, page 7"],"dataStatus":"exact|table_extractable|figure_only|conceptual|insufficient","dataPoints":[{"label":"Group A","value":12.3,"unit":"%","series":"Conversion"}],"caution":"..."}],"readingGuide":{"estimatedReadingMinutes":15,"suggestedReadingOrder":["..."],"difficulty":"Beginner|Intermediate|Advanced"},"researchValue":{"novelty":1-5,"technicalDepth":1-5,"industrialPotential":1-5,"readingPriority":1-5}}',
              "All descriptive text fields and suggestedReadingOrder must use concise professional Chinese. Keep paper titles, author names, chemical formulas, gene names, material names, model names, dataset names, and standard technical abbreviations in their original form.",
              "The readingGuide.difficulty value must remain exactly one of Beginner, Intermediate, or Advanced.",
              "When fullText is present, analyze evidence across the entire supplied paper text instead of relying on the abstract.",
              "Build a claim-evidence chain. Every evidenceItems entry must identify a real Figure, Table, section, or page reference found in the supplied paper. Never invent page numbers, measurements, controls, error bars, or statistical significance.",
              "Identify the research problem, hypothesis, technical route, key experiments, result evidence, innovations, limitations, and future directions in detail.",
              "For visualizationPlans, recommend bar charts for categorical comparisons, line charts for continuous trends, scatter charts for relationships, heatmaps for multi-factor matrices, and pie charts only when categories form a verified 100% total.",
              "Only include numeric dataPoints when the exact values and units are explicitly present in the supplied text or table captions. Otherwise leave dataPoints empty and set dataStatus to figure_only, conceptual, or insufficient.",
              "Use process, timeline, or mechanism only as explanatory diagrams and state that they are based on the paper rather than experimental measurements.",
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
              extractedFigures: (paper.figureEvidence ?? []).slice(0, 30).map((figure) => ({
                label: figure.label,
                kind: figure.kind,
                caption: figure.caption,
                page: figure.page,
              })),
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
