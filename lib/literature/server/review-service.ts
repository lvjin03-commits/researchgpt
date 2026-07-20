// Server-only module.

import OpenAI from "openai";
import { AIProviderError } from "@/lib/ai/errors";
import { LiteratureError } from "@/lib/literature/errors";
import { REVIEW_LENGTH_WORD_TARGETS } from "@/lib/literature/review/constants";
import type {
  LiteratureMatrixRow,
  LiteratureReviewRequest,
  PresentationDeck,
  PresentationSlide,
  PresentationSlideType,
  PresentationVisualMode,
  ReviewModel,
} from "@/lib/literature/review/types";
import { buildReviewPaperContext } from "@/lib/literature/server/review-papers";
import type { LiteraturePaper } from "@/lib/literature/types";

type ReviewPaperContext = ReturnType<typeof buildReviewPaperContext>[number];

const REVIEW_CONTEXT_LIMITS = {
  outline: {
    maxFullTextChars: 2500,
    maxFigureEvidence: 4,
    maxFigureCaptionChars: 450,
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

function resolvePerspective(request: LiteratureReviewRequest): string {
  return request.perspective === "自定义"
    ? request.customPerspective || request.perspective
    : request.perspective;
}

function resolveLengthTarget(request: LiteratureReviewRequest): string {
  if (request.length === "自定义页数") {
    return `约 ${request.customWordCount || 12} 页`;
  }

  return REVIEW_LENGTH_WORD_TARGETS[request.length];
}

function buildInstructionSummary(request: LiteratureReviewRequest): string {
  return [
    `生成模式：${
      request.workflowMode === "academic_review"
        ? "学术汇报（基于全文分析）"
        : "快速大纲（仅题目、摘要和元数据）"
    }`,
    `AI 模型：${request.model}`,
    `汇报主题：${request.topic}`,
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
    "交付目标是可直接用于导师汇报、组会和科研交流的研究大纲与演示文稿。",
    "必须包含：核心洞察、研究空白、未来方向、方法/框架对比、规范引用和参考文献规划。",
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

function compactMatrixValue(value: string | null | undefined, fallback: string) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 600) : fallback;
}

export function buildLiteratureMatrix(
  papers: LiteraturePaper[],
): LiteratureMatrixRow[] {
  return papers.map((paper) => {
    const analysis = paper.workspaceAnalysis;
    const year = paper.publishedAt
      ? new Date(paper.publishedAt).getFullYear()
      : null;
    const author = paper.authors[0]
      ? `${paper.authors[0]}${paper.authors.length > 1 ? " 等" : ""}`
      : "作者未知";
    const abstractFallback = compactMatrixValue(
      paper.abstract,
      "暂无摘要，待补充全文。",
    );
    const unavailable = analysis
      ? "当前单篇分析未单独提取该字段。"
      : "仅有摘要，待全文分析后确认。";

    return {
      paperId: paper.id,
      included: true,
      citation: `${author}${year ? `（${year}）` : ""}：《${paper.title}》`,
      researchTopic: compactMatrixValue(
        analysis?.oneSentenceSummary,
        abstractFallback,
      ),
      researchProblem: compactMatrixValue(
        analysis?.researchProblem,
        unavailable,
      ),
      researchObject: unavailable,
      researchMethod: compactMatrixValue(analysis?.coreMethod, unavailable),
      keyResults: compactMatrixValue(
        analysis?.experimentalResults,
        unavailable,
      ),
      conclusion: compactMatrixValue(
        analysis?.mainContributions,
        abstractFallback,
      ),
      coreIdea: compactMatrixValue(analysis?.whyItMatters, unavailable),
      limitations: compactMatrixValue(analysis?.limitations, unavailable),
      reviewRelation: compactMatrixValue(
        paper.recommendationReason || analysis?.whyItMatters,
        "需要结合综述主题由用户确认。",
      ),
      evidenceLevel:
        analysis?.evidenceLevel === "full_text"
          ? "full_text"
          : "abstract_only",
    };
  });
}

function isLiteratureMatrixRow(value: unknown): value is LiteratureMatrixRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.paperId === "string" &&
    typeof row.included === "boolean" &&
    typeof row.citation === "string" &&
    typeof row.researchTopic === "string" &&
    typeof row.researchProblem === "string" &&
    typeof row.researchObject === "string" &&
    typeof row.researchMethod === "string" &&
    typeof row.keyResults === "string" &&
    typeof row.conclusion === "string" &&
    typeof row.coreIdea === "string" &&
    typeof row.limitations === "string" &&
    typeof row.reviewRelation === "string" &&
    (row.evidenceLevel === "full_text" || row.evidenceLevel === "abstract_only")
  );
}

export async function generateLocalizedLiteratureMatrix(
  request: LiteratureReviewRequest,
  papers: LiteraturePaper[],
  signal?: AbortSignal,
): Promise<LiteratureMatrixRow[]> {
  const sourceRows = buildLiteratureMatrix(papers);
  const client = getClient();
  const localizedRows: LiteratureMatrixRow[] = [];

  for (let offset = 0; offset < sourceRows.length; offset += 8) {
    const batch = sourceRows.slice(offset, offset + 8);
    const completion = await createReviewCompletion(
      client,
      {
        model: request.model,
        reasoning_effort: "none",
        max_completion_tokens: 5000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是科研文献矩阵的中文编辑。只做忠实翻译和简洁整理，不增加原文没有的事实。",
              "将矩阵各说明字段转换为专业、准确、简洁的中文。",
              "论文标题、作者姓名、期刊名、化学式、材料名、基因名、模型名、数据集名和通用专业缩写保持原文。",
              "paperId、citation 和 evidenceLevel 必须原样保留。",
              "缺失信息仍明确写为未提取或待全文确认，不得猜测。",
              "返回 JSON 对象，格式为 {\"rows\":[...]}，字段和输入完全一致。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({ rows: batch }),
          },
        ],
      },
      signal,
    );

    const content = completion.choices[0]?.message?.content;
    try {
      const parsed = JSON.parse(content ?? "{}") as { rows?: unknown[] };
      const translatedById = new Map(
        (parsed.rows ?? [])
          .filter(isLiteratureMatrixRow)
          .map((row) => [row.paperId, row] as const),
      );
      localizedRows.push(
        ...batch.map((source) => translatedById.get(source.paperId) ?? source),
      );
    } catch {
      localizedRows.push(...batch);
    }
  }

  return localizedRows;
}

export async function generateReviewThemes(
  request: LiteratureReviewRequest,
  papers: LiteraturePaper[],
  signal?: AbortSignal,
): Promise<string> {
  const context = buildContextForPhase(request, papers, "outline");
  const matrix = (request.confirmedMatrix ?? buildLiteratureMatrix(papers)).filter(
    (row) => row.included,
  );
  const client = getClient();

  const completion = await createReviewCompletion(
    client,
    {
      model: request.model,
      reasoning_effort: "none",
      max_completion_tokens: 3000,
      messages: [
        {
          role: "system",
          content: [
            "你是科研文献整理助手。请基于文献矩阵完成跨文献归类，不写论文大纲，不写PPT，也不复述完整矩阵。",
            "必须严格区分文献事实与推断；证据不足时明确说明。",
            "输出纯 Markdown。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            buildInstructionSummary(request),
            "",
            "已确认的文献矩阵：",
            JSON.stringify(matrix, null, 2),
            "",
            "可用文献上下文：",
            buildPaperListPrompt(context),
            "",
            "请严格按以下结构输出：",
            "## 主题分类",
            "列出 3-8 个由当前文献实际内容驱动的主题，并标注对应文献。",
            "## 研究共识",
            "## 研究分歧",
            "说明差异可能来自研究对象、条件、方法、指标或样本。",
            "## 研究空白",
            "## 对论文结构的启示",
          ].join("\n"),
        },
      ],
    },
    signal,
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new LiteratureError("AI 未返回有效主题归类。", 502);
  }
  return extractMarkdownContent(content);
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
    const completion = await client.chat.completions.create(params, { signal });
    if (completion.choices[0]?.message?.content?.trim()) {
      return completion;
    }

    const finishReason = completion.choices[0]?.finish_reason ?? "unknown";
    throw new AIProviderError(
      `AI returned no usable review content (finish reason: ${finishReason}). Retry only after reducing the scope or changing the model.`,
      {
        statusCode: 502,
        provider: "openai",
      },
    );
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
  const matrix = (request.confirmedMatrix ?? buildLiteratureMatrix(papers)).filter(
    (row) => row.included,
  );
  const client = getClient();

  const completion = await createReviewCompletion(
    client,
    {
      model: request.model,
      reasoning_effort: "none",
      max_completion_tokens: 5000,
      messages: [
        {
          role: "system",
          content: [
            "你是 ResearchGPT 的高级科研写作与学术汇报策划助手。",
            buildEvidenceRules(),
            buildDeliverableRules(),
            "请生成可编辑的 Markdown 研究汇报大纲。",
            "大纲必须规划内容结构、图表结构、引用策略和汇报故事线。",
            "文献矩阵与主题归类已经由用户单独确认。大纲不得重复输出矩阵，也不得把主题归类原文粘贴进大纲。",
            "每个章节必须给出：本节需要回答的问题、建议讨论内容、建议组织顺序、推荐引用文献及推荐理由。",
            "输出纯 Markdown，不要 JSON。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            buildInstructionSummary(request),
            "",
            "用户确认的跨文献主题归类：",
            request.confirmedThemes,
            "",
            "已确认的文献矩阵：",
            JSON.stringify(matrix, null, 2),
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

const PRESENTATION_SLIDE_TYPES = new Set<PresentationSlideType>([
  "cover",
  "section",
  "evidence",
  "comparison",
  "timeline",
  "taxonomy",
  "framework",
  "insight",
  "gap",
  "future",
  "summary",
]);
const PRESENTATION_VISUAL_MODES = new Set<PresentationVisualMode>([
  "native",
  "evidence",
  "placeholder",
  "none",
]);

function cleanPresentationText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, 1200) : fallback;
}

function parsePresentationDeck(value: unknown, title: string): PresentationDeck {
  if (typeof value !== "object" || value === null) {
    throw new LiteratureError("AI 未返回有效的结构化 PPT 数据。", 502);
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.slides)) {
    throw new LiteratureError("AI 返回的 PPT 缺少幻灯片列表。", 502);
  }

  const slides = record.slides
    .slice(0, 15)
    .map((raw, index): PresentationSlide | null => {
      if (typeof raw !== "object" || raw === null) return null;
      const slide = raw as Record<string, unknown>;
      const type = PRESENTATION_SLIDE_TYPES.has(slide.type as PresentationSlideType)
        ? (slide.type as PresentationSlideType)
        : "insight";
      const visualRaw =
        typeof slide.visual === "object" && slide.visual !== null
          ? (slide.visual as Record<string, unknown>)
          : {};
      const visualMode = PRESENTATION_VISUAL_MODES.has(
        visualRaw.mode as PresentationVisualMode,
      )
        ? (visualRaw.mode as PresentationVisualMode)
        : "placeholder";
      const aspectRatio =
        visualRaw.aspectRatio === "16:9" ||
        visualRaw.aspectRatio === "4:3" ||
        visualRaw.aspectRatio === "1:1"
          ? visualRaw.aspectRatio
          : "4:3";
      const bullets = Array.isArray(slide.bullets)
        ? slide.bullets
            .map((item) => cleanPresentationText(item))
            .filter(Boolean)
            .slice(0, 4)
        : [];
      const citations = Array.isArray(slide.citations)
        ? slide.citations
            .map((item) => cleanPresentationText(item))
            .filter(Boolean)
            .slice(0, 5)
        : [];

      return {
        id: cleanPresentationText(slide.id, `slide-${index + 1}`),
        type,
        title: cleanPresentationText(slide.title, `幻灯片 ${index + 1}`),
        takeaway: cleanPresentationText(slide.takeaway, "本页结论待确认"),
        bullets: bullets.length > 0 ? bullets : ["本页证据要点待确认"],
        citations,
        visual: {
          mode: visualMode,
          type: cleanPresentationText(visualRaw.type, type),
          title: cleanPresentationText(visualRaw.title, "建议图示"),
          description: cleanPresentationText(
            visualRaw.description,
            "请根据本页结论补充相关图示。",
          ),
          source: cleanPresentationText(visualRaw.source),
          aspectRatio,
        },
        speakerNotes: cleanPresentationText(slide.speakerNotes),
      };
    })
    .filter((slide): slide is PresentationSlide => slide !== null);

  if (slides.length < 3) {
    throw new LiteratureError("AI 返回的有效幻灯片数量不足。", 502);
  }

  return {
    schemaVersion: 1,
    title: cleanPresentationText(record.title, title),
    subtitle: cleanPresentationText(record.subtitle, "基于所选文献的证据驱动汇报"),
    slides,
  };
}

export async function generateReviewPptDeck(
  request: LiteratureReviewRequest,
  papers: LiteraturePaper[],
  signal?: AbortSignal,
): Promise<PresentationDeck> {
  const context = buildContextForPhase(request, papers, "ppt");
  const client = getClient();

  const completion = await createReviewCompletion(
    client,
    {
      model: request.model,
      reasoning_effort: "none",
      max_completion_tokens: 7000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是 ResearchGPT 的学术汇报策划与 PPT 导演。",
            buildEvidenceRules(),
            "请把用户确认的研究大纲转成结构化学术汇报方案，不要输出 Markdown。",
            "PPT 原则：少字、多图、强故事线；每页只讲一个结论，标题必须是结论型标题。",
            "输出 8-15 页。每页最多 4 个要点，每个要点尽量不超过 36 个中文字符。",
            "第 1 页必须是 cover，最后 1 页必须是 summary；中间应按背景与问题、研究脉络、主题分类、方法或机制、代表性比较、核心洞察、研究空白、未来方向形成故事线。",
            "除封面和章节过渡页外，每页 citations 应列出实际支撑本页结论的作者年份；没有可靠证据时不得伪造引用。",
            "slide.type 只能是 cover、section、evidence、comparison、timeline、taxonomy、framework、insight、gap、future、summary。",
            "visual.mode 只能是 native、evidence、placeholder、none。",
            "若原文图表与结论直接相关，使用 evidence，并写明论文、Figure/Table编号和页码；不能确认时使用 placeholder。",
            "Timeline、Taxonomy、Comparison、Framework 等可编辑结构图使用 native。",
            "复杂化学机理、分子结构和实验装置无法可靠生成时必须使用 placeholder，并写清需要插入什么图。",
            "返回 JSON 对象，严格格式：",
            '{"schemaVersion":1,"title":"...","subtitle":"...","slides":[{"id":"slide-1","type":"cover","title":"...","takeaway":"...","bullets":["..."],"citations":["Author et al., 2024"],"visual":{"mode":"none","type":"cover","title":"","description":"","source":"","aspectRatio":"16:9"},"speakerNotes":"..."}]}',
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            buildInstructionSummary(request),
            "",
            "用户确认的研究大纲：",
            request.confirmedOutline,
            "",
            "可用文献（仅限以下条目）：",
            buildPaperListPrompt(context),
            "",
            "请生成可直接用于导师汇报、并可由程序稳定排版的结构化 PPT 数据。",
          ].join("\n"),
        },
      ],
    },
    signal,
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new LiteratureError("AI 未返回有效 PPT 数据。", 502);
  try {
    return parsePresentationDeck(JSON.parse(content) as unknown, request.topic);
  } catch (error) {
    if (error instanceof LiteratureError) throw error;
    throw new LiteratureError("AI 返回的 PPT JSON 无法解析。", 502);
  }
}

export async function generatePresentationDeckFromOutline(input: {
  title: string;
  outline: string;
  model: ReviewModel;
  signal?: AbortSignal;
}): Promise<PresentationDeck> {
  const client = getClient();
  const completion = await createReviewCompletion(
    client,
    {
      model: input.model,
      reasoning_effort: "none",
      max_completion_tokens: 7000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是专业学术PPT导演。把用户提供的大纲转换成结构化幻灯片数据，不要输出Markdown。",
            "不得编造论文、引用、实验数据或图片来源。用户未提供证据时 citations 必须为空。",
            "每页只表达一个结论；标题应为结论型标题；每页最多4个要点，每个要点尽量不超过36个中文字符。",
            "第1页必须是cover，最后1页必须是summary，整体形成连贯故事线。",
            "slide.type 只能是 cover、section、evidence、comparison、timeline、taxonomy、framework、insight、gap、future、summary。",
            "visual.mode 只能是 native、placeholder、none。Timeline、Taxonomy、Comparison、Framework使用native。",
            "复杂机理、分子结构、实验装置或用户未提供的证据图使用placeholder，并明确写出需要插入什么图片。",
            "返回严格JSON对象：",
            '{"schemaVersion":1,"title":"...","subtitle":"...","slides":[{"id":"slide-1","type":"cover","title":"...","takeaway":"...","bullets":["..."],"citations":[],"visual":{"mode":"none","type":"cover","title":"","description":"","source":"","aspectRatio":"16:9"},"speakerNotes":"..."}]}',
          ].join("\n"),
        },
        {
          role: "user",
          content: [`PPT标题：${input.title}`, "", "用户大纲：", input.outline].join(
            "\n",
          ),
        },
      ],
    },
    input.signal,
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new LiteratureError("AI 未返回有效 PPT 数据。", 502);
  try {
    return parsePresentationDeck(JSON.parse(content) as unknown, input.title);
  } catch (error) {
    if (error instanceof LiteratureError) throw error;
    throw new LiteratureError("AI 返回的 PPT JSON 无法解析。", 502);
  }
}
