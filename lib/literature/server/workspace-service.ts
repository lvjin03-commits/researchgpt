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

const WORKSPACE_JSON_SCHEMA = {
  name: "paper_workspace_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      oneSentenceSummary: { type: "string" },
      researchProblem: { type: "string" },
      coreHypothesis: { type: "string" },
      coreMethod: { type: "string" },
      technicalRoute: { type: "array", items: { type: "string" } },
      keyExperiments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            purpose: { type: "string" },
            design: { type: "string" },
            variables: { type: "string" },
            conditions: { type: "string" },
            result: { type: "string" },
            evidenceRefs: { type: "array", items: { type: "string" } },
          },
          required: ["title", "purpose", "design", "variables", "conditions", "result", "evidenceRefs"],
        },
      },
      evidenceItems: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            claim: { type: "string" },
            sourceType: { type: "string", enum: ["figure", "table", "text"] },
            sourceRef: { type: "string" },
            page: { type: ["integer", "null"] },
            evidence: { type: "string" },
            interpretation: { type: "string" },
            limitation: { type: "string" },
            strength: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["id", "claim", "sourceType", "sourceRef", "page", "evidence", "interpretation", "limitation", "strength"],
        },
      },
      mainContributions: { type: "string" },
      innovations: { type: "array", items: { type: "string" } },
      experimentalResults: { type: "string" },
      limitations: { type: "string" },
      whyItMatters: { type: "string" },
      futureDirections: { type: "array", items: { type: "string" } },
      visualizationPlans: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            chartType: { type: "string", enum: ["bar", "line", "scatter", "heatmap", "pie", "stacked_bar", "process", "timeline", "mechanism", "evidence_card"] },
            purpose: { type: "string" },
            takeaway: { type: "string" },
            sourceRefs: { type: "array", items: { type: "string" } },
            dataStatus: { type: "string", enum: ["exact", "table_extractable", "figure_only", "conceptual", "insufficient"] },
            dataPoints: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string" },
                  value: { type: "number" },
                  unit: { type: "string" },
                  series: { type: "string" },
                },
                required: ["label", "value", "unit", "series"],
              },
            },
            caution: { type: "string" },
          },
          required: ["id", "title", "chartType", "purpose", "takeaway", "sourceRefs", "dataStatus", "dataPoints", "caution"],
        },
      },
      readingGuide: {
        type: "object",
        additionalProperties: false,
        properties: {
          estimatedReadingMinutes: { type: "integer" },
          suggestedReadingOrder: { type: "array", items: { type: "string" } },
          difficulty: { type: "string", enum: ["Beginner", "Intermediate", "Advanced"] },
        },
        required: ["estimatedReadingMinutes", "suggestedReadingOrder", "difficulty"],
      },
      researchValue: {
        type: "object",
        additionalProperties: false,
        properties: {
          novelty: { type: "integer", minimum: 1, maximum: 5 },
          technicalDepth: { type: "integer", minimum: 1, maximum: 5 },
          industrialPotential: { type: "integer", minimum: 1, maximum: 5 },
          readingPriority: { type: "integer", minimum: 1, maximum: 5 },
        },
        required: ["novelty", "technicalDepth", "industrialPotential", "readingPriority"],
      },
    },
    required: [
      "oneSentenceSummary", "researchProblem", "coreHypothesis", "coreMethod",
      "technicalRoute", "keyExperiments", "evidenceItems", "mainContributions",
      "innovations", "experimentalResults", "limitations", "whyItMatters",
      "futureDirections", "visualizationPlans", "readingGuide", "researchValue",
    ],
  },
} as const;

function buildFullTextEvidenceSample(fullText: string): string {
  const normalized = fullText.trim();
  const segmentLength = 18_000;
  if (normalized.length <= segmentLength * 3) return normalized;

  const middleStart = Math.max(0, Math.floor(normalized.length / 2 - segmentLength / 2));
  return [
    `[论文前段]\n${normalized.slice(0, segmentLength)}`,
    `[论文中段]\n${normalized.slice(middleStart, middleStart + segmentLength)}`,
    `[论文后段]\n${normalized.slice(-segmentLength)}`,
  ].join("\n\n");
}

async function extractFullTextEvidenceDigest(
  client: OpenAI,
  model: string,
  paper: LiteraturePaper,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: [
        "你负责从论文全文片段中提取紧凑、可追溯的证据摘要。只返回JSON。",
        "只使用以下顶层字段：sectionSummaries、keyExperiments、evidenceItems、numericFindings、limitations、figureAndTableRefs。",
        "每条证据必须保留原文中的 Figure、Table、章节或页码线索；没有明确线索时写 null，禁止编造。",
        "严格限制篇幅：章节最多8项、实验最多6项、证据最多10项、数值最多12项、图表引用最多12项。",
        "每个字符串不超过120个中文字符，不复述摘要，不输出Markdown。所有说明使用中文。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        title: paper.title,
        abstract: paper.abstract.slice(0, 4000),
        fullTextSegments: buildFullTextEvidenceSample(paper.fullText ?? ""),
        extractedFigures: (paper.figureEvidence ?? []).slice(0, 30).map((figure) => ({
          label: figure.label,
          kind: figure.kind,
          caption: figure.caption,
          page: figure.page,
        })),
      }),
    },
  ];

  let completion: OpenAI.Chat.Completions.ChatCompletion | null = null;
  for (const maxCompletionTokens of [4000, 6500]) {
    completion = await client.chat.completions.create(
      {
        model,
        reasoning_effort: "none",
        max_completion_tokens: maxCompletionTokens,
        response_format: { type: "json_object" },
        messages,
      },
      { signal },
    );
    if (completion.choices[0]?.finish_reason !== "length") break;
  }

  const choice = completion?.choices[0];
  if (choice?.finish_reason === "length") {
    throw new AIProviderError("AI 证据提取连续两次达到输出上限，请缩小分析范围或改用更高质量模型。", {
      statusCode: 502,
      provider: "openai",
    });
  }
  const content = choice?.message?.content;
  if (!content) {
    throw new AIProviderError("AI 未返回文献证据摘要，请重试。", {
      statusCode: 502,
      provider: "openai",
    });
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== "object" || parsed === null) throw new Error("invalid object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new AIProviderError("AI 返回的证据摘要格式不完整，请重试。", {
      statusCode: 502,
      provider: "openai",
      cause: error,
    });
  }
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
    const evidenceDigest = paper.fullText
      ? await extractFullTextEvidenceDigest(client, model, paper, signal)
      : null;
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: [
          "You are a research paper analysis assistant for ResearchGPT.",
          "Use the supplied evidence digest to build a concise, evidence-driven paper reading workspace.",
          "All descriptive text fields and suggestedReadingOrder must use professional Chinese. Keep paper titles, author names, chemical formulas, gene names, material names, model names, dataset names, and standard technical abbreviations in their original form.",
          "Every evidence item must identify a real Figure, Table, section, or page reference present in the evidence digest. Never invent measurements, controls, error bars, statistical significance, or page numbers.",
          "Return 3-8 key experiments, 4-12 evidence items, 2-6 innovations, 2-6 future directions, and 2-8 visualization plans. Keep each field concise so the complete response fits the output limit.",
          "Only include numeric dataPoints when exact values and units are present. Otherwise keep dataPoints empty and mark the appropriate dataStatus.",
          "Pie charts are allowed only when verified categories total 100%. Process, timeline, and mechanism diagrams must be labeled conceptual rather than experimental evidence.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          title: paper.title,
          authors: paper.authors,
          abstract: paper.abstract.slice(0, 4000),
          evidenceDigest,
          evidenceLevel,
          categories: paper.categories,
          existingSummary: paper.chineseSummary,
          recommendationReason: paper.recommendationReason,
        }),
      },
    ];

    let completion: OpenAI.Chat.Completions.ChatCompletion | null = null;
    for (const maxCompletionTokens of [7000, 9000]) {
      completion = await client.chat.completions.create(
        {
          model,
          reasoning_effort: "none",
          max_completion_tokens: maxCompletionTokens,
          response_format: {
            type: "json_schema",
            json_schema: WORKSPACE_JSON_SCHEMA,
          },
          messages,
        },
        { signal },
      );
      if (completion.choices[0]?.finish_reason !== "length") break;
    }

    const choice = completion?.choices[0];
    if (choice?.finish_reason === "length") {
      throw new AIProviderError("AI 分析结果连续两次被截断，请改用更高质量模型后重试。", {
        statusCode: 502,
        provider: "openai",
      });
    }
    const content = choice?.message?.content;
    if (!content) {
      throw new AIProviderError("AI 未返回分析结果，请重试。", {
        statusCode: 502,
        provider: "openai",
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (error) {
      throw new AIProviderError("AI 返回结果格式不完整，系统重试后仍无法解析。", {
        statusCode: 502,
        provider: "openai",
        cause: error,
      });
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new AIProviderError("AI 返回的分析结果不是有效结构。", {
        statusCode: 502,
        provider: "openai",
      });
    }

    const workspace = parseWorkspaceRecord(
      parsed as Record<string, unknown>,
      evidenceLevel,
      model,
    );
    if (!workspace) {
      throw new AIProviderError("AI 返回结果缺少必要分析字段，请重试。", {
        statusCode: 502,
        provider: "openai",
      });
    }

    return workspace;
  } catch (error) {
    if (error instanceof LiteratureError || error instanceof AIProviderError) {
      throw error;
    }

    if (error instanceof OpenAI.APIError) {
      const message = (() => {
        if (error.status === 401 || error.status === 403) {
          return "OpenAI API 密钥无效或当前账户没有该模型权限，请检查 Vercel 环境变量与模型权限。";
        }
        if (error.status === 404) {
          return `当前 OpenAI 账户无法使用所配置的模型，请检查 OPENAI_MODEL。详情：${error.message}`;
        }
        if (error.status === 429) {
          return "OpenAI API 额度不足或请求过于频繁，请检查账户余额后重试。";
        }
        if (error.status === 408 || (error.status && error.status >= 500)) {
          return "OpenAI 文献分析请求超时或服务暂时不可用，请稍后重试。";
        }
        return `AI 文献分析失败：${error.message}`;
      })();
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
      const detail = error instanceof Error ? error.message.slice(0, 300) : "未知错误";
      throw new AIProviderError(`AI 无法完成该文献的全文分析：${detail}`, {
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
