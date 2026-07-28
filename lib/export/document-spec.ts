import {
  resolveDocumentLanguage,
  type DocumentLanguage,
} from "@/lib/export/document-language";
import {
  resolveDocumentTemplate,
  resolvedTemplateByIdentity,
  orderTemplateComponents,
  templateComponentPrompt,
  type DocumentComponentId,
  type ResolvedDocumentTemplate,
} from "@/lib/export/document-templates";

export type DocumentPlan = {
  version: 1;
  templateId: ResolvedDocumentTemplate["id"];
  templateVersion: number;
  templateSource: ResolvedDocumentTemplate["source"];
  language: DocumentLanguage;
  documentType:
    | "review"
    | "research_report"
    | "paper_reading"
    | "proposal"
    | "meeting_notes"
    | "general";
  subject: string;
  requireAbstract: boolean;
  requireReferences: boolean;
  visualsEnabled: boolean;
  maxVisuals: number;
  componentTasks: Array<{
    id: DocumentComponentId;
    required: boolean;
    repeatable: boolean;
    dependsOn: DocumentComponentId[];
    status: "planned";
    executionOrder: number;
    matureOutput: string;
  }>;
  sections: Array<{
    id: string;
    role: string;
    headingIntent: string;
    requiredPoints: string[];
  }>;
  visualIntents: Array<{
    id: string;
    sectionId: string;
    purpose: string;
    preferredType: DocumentVisualRequest["type"];
  }>;
};

export type DocumentParagraphBlock = {
  id: string;
  type: "paragraph";
  text: string;
};

export type DocumentListBlock = {
  id: string;
  type: "list";
  ordered: boolean;
  items: string[];
};

export type DocumentTableBlock = {
  id: string;
  type: "table";
  caption: string;
  columns: string[];
  rows: string[][];
  source?: string;
};

export type DocumentVisualBlock = {
  id: string;
  type: "visual";
  visualRequestId: string;
};

export type DocumentContentBlock =
  | DocumentParagraphBlock
  | DocumentListBlock
  | DocumentTableBlock
  | DocumentVisualBlock;

export type DocumentSectionSpec = {
  id: string;
  heading: string;
  level: 1 | 2 | 3;
  blocks: DocumentContentBlock[];
};

export type DocumentReferenceSpec = {
  id: string;
  displayText: string;
  verified: boolean;
  url?: string;
  doi?: string;
};

export type DocumentVisualRequest = {
  id: string;
  sectionId: string;
  purpose: string;
  type:
    | "scientific_illustration"
    | "mechanism"
    | "process"
    | "timeline"
    | "comparison"
    | "data_chart";
  contentBrief: string;
  requiredElements: string[];
  caption: string;
  sourceStatement: string;
  evidenceKind:
    | "verified_data"
    | "verified_literature"
    | "conceptual_synthesis";
};

export type DocumentSpec = {
  version: 1;
  templateId: ResolvedDocumentTemplate["id"];
  templateVersion: number;
  language: DocumentLanguage;
  documentType: DocumentPlan["documentType"];
  title: string;
  abstract?: string;
  keywords: string[];
  sections: DocumentSectionSpec[];
  references: DocumentReferenceSpec[];
  visualRequests: DocumentVisualRequest[];
};

export type FinalImageAsset = {
  id: string;
  requestId: string;
  mimeType: "image/png" | "image/jpeg";
  dataBase64: string;
  width: number;
  height: number;
  caption: string;
  source: string;
  altText: string;
};

export type FinalDocumentSpec = DocumentSpec & {
  imageAssets: FinalImageAsset[];
};

export type DocumentSpecIssue = {
  code: string;
  path: string;
  message: string;
};

export type DocumentSpecValidation = {
  passed: boolean;
  issues: DocumentSpecIssue[];
};

const INTERNAL_CONTENT_PATTERN =
  /figure placeholder|visualSpecs|evidenceType|<researchgpt-visual>|此处插入|建议增加(?:图片|图表)|待补充|click generate|copy this markdown/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : [];
}

function extractJsonPayload(value: string): string {
  const normalized = value.trim();
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(normalized)?.[1];
  if (fenced) return fenced.trim();
  const first = normalized.indexOf("{");
  const last = normalized.lastIndexOf("}");
  return first >= 0 && last > first ? normalized.slice(first, last + 1) : normalized;
}

export function parseDocumentSpec(value: string): DocumentSpec | null {
  try {
    const root = record(JSON.parse(extractJsonPayload(value)));
    if (!root) return null;

    const sections = Array.isArray(root.sections)
      ? root.sections.flatMap((sectionValue, sectionIndex) => {
          const section = record(sectionValue);
          if (!section) return [];
          const blocks: DocumentContentBlock[] = Array.isArray(section.blocks)
            ? section.blocks.flatMap<DocumentContentBlock>((blockValue, blockIndex) => {
                const block = record(blockValue);
                if (!block) return [];
                const type = text(block.type);
                const id = text(block.id) || `block-${sectionIndex + 1}-${blockIndex + 1}`;
                if (type === "paragraph") {
                  return [{ id, type, text: text(block.text) } satisfies DocumentParagraphBlock];
                }
                if (type === "list") {
                  return [{
                    id,
                    type,
                    ordered: block.ordered === true,
                    items: stringArray(block.items),
                  } satisfies DocumentListBlock];
                }
                if (type === "table") {
                  return [{
                    id,
                    type,
                    caption: text(block.caption),
                    columns: stringArray(block.columns),
                    rows: Array.isArray(block.rows)
                      ? block.rows.map((row) => stringArray(row))
                      : [],
                    source: text(block.source) || undefined,
                  } satisfies DocumentTableBlock];
                }
                if (type === "visual") {
                  return [{
                    id,
                    type,
                    visualRequestId: text(block.visualRequestId),
                  } satisfies DocumentVisualBlock];
                }
                return [];
              })
            : [];
          const level = Number(section.level);
          return [{
            id: text(section.id) || `section-${sectionIndex + 1}`,
            heading: text(section.heading),
            level: level === 2 || level === 3 ? level : 1,
            blocks,
          } satisfies DocumentSectionSpec];
        })
      : [];

    const references = Array.isArray(root.references)
      ? root.references.flatMap((referenceValue, index) => {
          const reference = record(referenceValue);
          if (!reference) return [];
          return [{
            id: text(reference.id) || `reference-${index + 1}`,
            displayText: text(reference.displayText),
            verified: reference.verified === true,
            url: text(reference.url) || undefined,
            doi: text(reference.doi) || undefined,
          } satisfies DocumentReferenceSpec];
        })
      : [];

    const visualRequests = Array.isArray(root.visualRequests)
      ? root.visualRequests.flatMap((requestValue, index) => {
          const request = record(requestValue);
          if (!request) return [];
          const visualType = text(request.type) as DocumentVisualRequest["type"];
          return [{
            id: text(request.id) || `visual-${index + 1}`,
            sectionId: text(request.sectionId),
            purpose: text(request.purpose),
            type: [
              "scientific_illustration",
              "mechanism",
              "process",
              "timeline",
              "comparison",
              "data_chart",
            ].includes(visualType)
              ? visualType
              : "scientific_illustration",
            contentBrief: text(request.contentBrief),
            requiredElements: stringArray(request.requiredElements),
            caption: text(request.caption),
            sourceStatement: text(request.sourceStatement),
            evidenceKind: [
              "verified_data",
              "verified_literature",
              "conceptual_synthesis",
            ].includes(text(request.evidenceKind))
              ? (text(request.evidenceKind) as DocumentVisualRequest["evidenceKind"])
              : "conceptual_synthesis",
          } satisfies DocumentVisualRequest];
        })
      : [];

    return {
      version: 1,
      templateId:
        text(root.templateId) === "sci-academic-word"
          ? "sci-academic-word"
          : "legacy-general-word",
      templateVersion: Number.isFinite(Number(root.templateVersion))
        ? Number(root.templateVersion)
        : 0,
      language: root.language === "zh-CN" ? "zh-CN" : "en-US",
      documentType: [
        "review",
        "research_report",
        "paper_reading",
        "proposal",
        "meeting_notes",
      ].includes(text(root.documentType))
        ? (text(root.documentType) as DocumentPlan["documentType"])
        : "general",
      title: text(root.title),
      abstract: text(root.abstract) || undefined,
      keywords: stringArray(root.keywords),
      sections,
      references,
      visualRequests,
    };
  } catch {
    return null;
  }
}

function visibleStrings(spec: DocumentSpec): string[] {
  return [
    spec.title,
    spec.abstract ?? "",
    ...spec.keywords,
    ...spec.sections.flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) => {
        if (block.type === "paragraph") return [block.text];
        if (block.type === "list") return block.items;
        if (block.type === "table") {
          return [block.caption, ...block.columns, ...block.rows.flat(), block.source ?? ""];
        }
        return [];
      }),
    ]),
    ...spec.references.map((reference) => reference.displayText),
  ].filter(Boolean);
}

export function validateDocumentSpec(
  spec: DocumentSpec,
  plan: DocumentPlan,
): DocumentSpecValidation {
  const issues: DocumentSpecIssue[] = [];
  const add = (code: string, path: string, message: string) =>
    issues.push({ code, path, message });

  if (
    spec.templateId !== plan.templateId ||
    spec.templateVersion !== plan.templateVersion
  ) {
    add(
      "template_mismatch",
      "templateId",
      `Expected frozen template ${plan.templateId}@${plan.templateVersion}.`,
    );
  }

  if (!spec.title || /^(abstract|摘要|introduction|引言|references?|参考文献)$/i.test(spec.title)) {
    add("invalid_title", "title", "A mature subject-specific title is required.");
  }
  if (spec.language !== plan.language) {
    add("language_mismatch", "language", `Expected ${plan.language}.`);
  }
  if (plan.requireAbstract && (!spec.abstract || spec.abstract.length < 40)) {
    add("missing_abstract", "abstract", "A complete abstract is required.");
  }
  if (
    plan.componentTasks.some(
      (component) => component.id === "keywords" && component.required,
    ) &&
    (spec.keywords.length < 3 || spec.keywords.length > 8)
  ) {
    add(
      "invalid_keywords",
      "keywords",
      "The selected template requires three to eight mature keywords.",
    );
  }
  if (spec.sections.length === 0) {
    add("missing_sections", "sections", "At least one mature section is required.");
  }
  for (const plannedSection of plan.sections) {
    if (!spec.sections.some((section) => section.id === plannedSection.id)) {
      add(
        "missing_planned_section",
        "sections",
        `Missing planned section ${plannedSection.id}: ${plannedSection.headingIntent}.`,
      );
    }
  }
  if (plan.requireReferences && spec.references.length === 0) {
    add("missing_references", "references", "A references section or explicit no-source entry is required.");
  }

  const sectionIds = new Set<string>();
  const blockIds = new Set<string>();
  for (const [sectionIndex, section] of spec.sections.entries()) {
    const sectionPath = `sections[${sectionIndex}]`;
    if (!section.id || sectionIds.has(section.id)) {
      add("duplicate_section_id", `${sectionPath}.id`, "Section IDs must be unique.");
    }
    sectionIds.add(section.id);
    if (!section.heading) add("missing_heading", `${sectionPath}.heading`, "Section heading is required.");
    if (section.blocks.length === 0) add("empty_section", `${sectionPath}.blocks`, "Section must contain mature content.");

    for (const [blockIndex, block] of section.blocks.entries()) {
      const blockPath = `${sectionPath}.blocks[${blockIndex}]`;
      if (!block.id || blockIds.has(block.id)) {
        add("duplicate_block_id", `${blockPath}.id`, "Block IDs must be unique.");
      }
      blockIds.add(block.id);
      if (block.type === "paragraph" && block.text.length < 8) {
        add("immature_paragraph", `${blockPath}.text`, "Paragraph is empty or outline-like.");
      }
      if (block.type === "list" && block.items.length === 0) {
        add("empty_list", `${blockPath}.items`, "List must contain final items.");
      }
      if (block.type === "table") {
        if (!block.caption || block.columns.length === 0 || block.rows.length === 0) {
          add("invalid_table", blockPath, "Table needs a final caption, columns, and rows.");
        } else if (block.rows.some((row) => row.length !== block.columns.length)) {
          add("invalid_table_shape", `${blockPath}.rows`, "Every row must match the column count.");
        }
      }
    }
  }

  const requestIds = new Set(spec.visualRequests.map((request) => request.id));
  for (const [sectionIndex, section] of spec.sections.entries()) {
    for (const [blockIndex, block] of section.blocks.entries()) {
      if (block.type === "visual" && !requestIds.has(block.visualRequestId)) {
        add(
          "unresolved_visual_slot",
          `sections[${sectionIndex}].blocks[${blockIndex}]`,
          "Visual block must reference an existing visual request.",
        );
      }
    }
  }
  if (!plan.visualsEnabled && spec.visualRequests.length > 0) {
    add("visuals_forbidden", "visualRequests", "The request does not permit generated visuals.");
  }
  if (spec.visualRequests.length > plan.maxVisuals) {
    add("too_many_visuals", "visualRequests", `At most ${plan.maxVisuals} visuals are allowed.`);
  }
  for (const visualIntent of plan.visualIntents) {
    if (
      !spec.visualRequests.some(
        (request) =>
          request.id === visualIntent.id ||
          (request.sectionId === visualIntent.sectionId &&
            request.type === visualIntent.preferredType),
      )
    ) {
      add(
        "missing_planned_visual",
        "visualRequests",
        `Missing planned visual for ${visualIntent.sectionId}: ${visualIntent.purpose}.`,
      );
    }
  }
  for (const [index, request] of spec.visualRequests.entries()) {
    if (!sectionIds.has(request.sectionId)) {
      add("invalid_visual_section", `visualRequests[${index}].sectionId`, "Visual must target an existing section.");
    }
    if (!request.contentBrief || !request.caption || !request.sourceStatement) {
      add("immature_visual_request", `visualRequests[${index}]`, "Visual request needs a mature brief, caption, and source.");
    }
  }

  for (const [index, value] of visibleStrings(spec).entries()) {
    if (INTERNAL_CONTENT_PATTERN.test(value)) {
      add("internal_content_leak", `visibleContent[${index}]`, "Internal instructions or placeholders cannot enter final content.");
    }
  }

  return { passed: issues.length === 0, issues };
}

export function createDocumentPlan(input: {
  query: string;
  template?: ResolvedDocumentTemplate;
  templateId?: string;
  maxVisuals: number;
}): DocumentPlan {
  const template =
    input.template ??
    resolveDocumentTemplate({
      query: input.query,
      format: "docx",
      legacyTemplateId: input.templateId === "nature" ? "nature" : "academic",
    });
  const language = resolveDocumentLanguage({ query: input.query });
  const review =
    template.id === "sci-academic-word" ||
    /综述|review|literature review|sci|nature|论文/i.test(input.query);
  const visualsDisabled = /不要|不需要|无需|without|no\s+(?:image|figure|visual)/i.test(input.query);
  const visualsRequested = /图片|图像|插图|机制图|流程图|图表|figure|image|visual|diagram|chart/i.test(input.query);
  const subject = input.query
    .replace(/生成|输出|导出|制作|创建|写一篇|帮我|请|word|docx|文档|文件/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const visualsEnabled = !visualsDisabled && (visualsRequested || review);
  const sections =
    language === "zh-CN"
      ? review
        ? [
            { id: "introduction", role: "introduction", headingIntent: "研究背景与核心问题", requiredPoints: ["研究范围", "核心问题"] },
            { id: "evidence", role: "evidence", headingIntent: "主要研究证据与方法", requiredPoints: ["关键路径", "代表性证据"] },
            { id: "analysis", role: "analysis", headingIntent: "机制、比较与局限", requiredPoints: ["机制分析", "局限性"] },
            { id: "conclusion", role: "conclusion", headingIntent: "结论与展望", requiredPoints: ["核心结论", "未来方向"] },
          ]
        : [
            { id: "main", role: "main", headingIntent: "核心内容", requiredPoints: ["主要结论"] },
          ]
      : review
        ? [
            { id: "introduction", role: "introduction", headingIntent: "Background and core questions", requiredPoints: ["scope", "core question"] },
            { id: "evidence", role: "evidence", headingIntent: "Main evidence and methods", requiredPoints: ["key approaches", "representative evidence"] },
            { id: "analysis", role: "analysis", headingIntent: "Mechanisms, comparison, and limitations", requiredPoints: ["mechanism", "limitations"] },
            { id: "conclusion", role: "conclusion", headingIntent: "Conclusions and outlook", requiredPoints: ["conclusions", "future directions"] },
          ]
        : [
            { id: "main", role: "main", headingIntent: "Main content", requiredPoints: ["key conclusion"] },
          ];
  return {
    version: 1,
    templateId: template.id,
    templateVersion: template.version,
    templateSource: template.source,
    language,
    documentType: review ? "review" : "general",
    subject: subject || (language === "zh-CN" ? "研究主题" : "Research topic"),
    requireAbstract:
      template.components.some(
        (component) => component.id === "abstract" && component.required,
      ) || review,
    requireReferences:
      template.components.some(
        (component) => component.id === "references" && component.required,
      ) || review,
    visualsEnabled,
    maxVisuals: visualsEnabled ? Math.max(1, input.maxVisuals) : 0,
    componentTasks: orderTemplateComponents(template.components).map(
      (component, index) => ({
      id: component.id,
      required: component.required,
      repeatable: component.repeatable === true,
      dependsOn: component.dependsOn,
      status: "planned",
      executionOrder: index + 1,
      matureOutput: component.matureOutput,
      }),
    ),
    sections,
    visualIntents: [],
  };
}

export function documentSpecPrompt(plan: DocumentPlan): string {
  const template = resolvedTemplateByIdentity({
    id: plan.templateId,
    version: plan.templateVersion,
  });
  return [
    "Return exactly one fenced JSON object and no prose outside it.",
    "Generate mature, publication-ready content. Do not emit Markdown, outlines, placeholders, instructions, raw tool data, or unfinished notes.",
    templateComponentPrompt(template, plan.language),
    `Frozen template identity: ${plan.templateId}@${plan.templateVersion}.`,
    `Language: ${plan.language}. Document type: ${plan.documentType}. Subject: ${plan.subject}.`,
    `Abstract required: ${plan.requireAbstract}. References required: ${plan.requireReferences}.`,
    `Component execution contracts: ${JSON.stringify(plan.componentTasks)}.`,
    `Generated visuals allowed: ${plan.visualsEnabled}. Maximum visuals: ${plan.maxVisuals}.`,
    `Planned sections: ${JSON.stringify(plan.sections)}.`,
    `Planned visual intents: ${JSON.stringify(plan.visualIntents)}.`,
    "Schema:",
    '{"version":1,"templateId":"frozen template id","templateVersion":1,"language":"zh-CN|en-US","documentType":"review|research_report|paper_reading|proposal|meeting_notes|general","title":"mature title","abstract":"mature abstract","keywords":["term"],"sections":[{"id":"section-1","heading":"mature heading","level":1,"blocks":[{"id":"block-1","type":"paragraph","text":"mature final paragraph"},{"id":"block-2","type":"list","ordered":false,"items":["mature item"]},{"id":"block-3","type":"table","caption":"final caption","columns":["A","B"],"rows":[["value","value"]],"source":"final source"},{"id":"block-4","type":"visual","visualRequestId":"visual-1"}]}],"references":[{"id":"reference-1","displayText":"final formatted reference or explicit no-source notice","verified":false}],"visualRequests":[{"id":"visual-1","sectionId":"section-1","purpose":"why this image is needed","type":"scientific_illustration|mechanism|process|timeline|comparison|data_chart","contentBrief":"complete image-generation brief","requiredElements":["element"],"caption":"final caption","sourceStatement":"final source statement","evidenceKind":"verified_data|verified_literature|conceptual_synthesis"}]}',
    "Every visual block must reference one visualRequests item. Do not place visual request JSON, evidenceKind, prompts, or source data in visible paragraphs.",
  ].join("\n");
}

export function semanticDocumentPlanPrompt(base: DocumentPlan): string {
  return [
    "Return exactly one fenced JSON object describing the semantic document plan. Do not write document content.",
    "Preserve the frozen template identity, required component contracts, and every explicit constraint in the normalized base plan. Improve only semantic structure, evidence needs, and visual roles.",
    `Normalized base plan: ${JSON.stringify(base)}.`,
    "Schema:",
    '{"sections":[{"id":"stable-id","role":"introduction|evidence|method|analysis|discussion|conclusion|main","headingIntent":"what this section must accomplish","requiredPoints":["point"]}],"visualIntents":[{"id":"visual-1","sectionId":"existing-section-id","purpose":"analytical purpose","preferredType":"scientific_illustration|mechanism|process|timeline|comparison|data_chart"}]}',
    "Plan visuals only when they materially improve understanding. Do not plan a data_chart without verified quantitative data.",
  ].join("\n");
}

export function applySemanticDocumentPlan(
  base: DocumentPlan,
  value: string,
): DocumentPlan {
  try {
    const parsed = record(JSON.parse(extractJsonPayload(value)));
    if (!parsed) return base;
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections.flatMap((sectionValue, index) => {
          const section = record(sectionValue);
          if (!section) return [];
          const headingIntent = text(section.headingIntent);
          if (!headingIntent) return [];
          return [{
            id: text(section.id) || `section-${index + 1}`,
            role: text(section.role) || "main",
            headingIntent,
            requiredPoints: stringArray(section.requiredPoints),
          }];
        })
      : [];
    const validSectionIds = new Set(sections.map((section) => section.id));
    const visualIntents =
      base.visualsEnabled && Array.isArray(parsed.visualIntents)
        ? parsed.visualIntents
            .flatMap((intentValue, index) => {
              const intent = record(intentValue);
              if (!intent) return [];
              const preferredType = text(intent.preferredType) as DocumentVisualRequest["type"];
              const sectionId = text(intent.sectionId);
              if (
                !validSectionIds.has(sectionId) ||
                ![
                  "scientific_illustration",
                  "mechanism",
                  "process",
                  "timeline",
                  "comparison",
                  "data_chart",
                ].includes(preferredType)
              ) {
                return [];
              }
              return [{
                id: text(intent.id) || `visual-${index + 1}`,
                sectionId,
                purpose: text(intent.purpose),
                preferredType,
              }];
            })
            .filter((intent) => intent.purpose)
            .slice(0, base.maxVisuals)
        : [];
    return {
      ...base,
      sections: sections.length > 0 ? sections : base.sections,
      visualIntents,
    };
  } catch {
    return base;
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function documentSpecToMarkdown(spec: DocumentSpec): string {
  const lines: string[] = [`# ${spec.title}`];
  if (spec.abstract) lines.push("", spec.language === "zh-CN" ? "## 摘要" : "## Abstract", "", spec.abstract);
  if (spec.keywords.length > 0) {
    lines.push("", `${spec.language === "zh-CN" ? "关键词：" : "Keywords: "}${spec.keywords.join("; ")}`);
  }

  for (const section of spec.sections) {
    lines.push("", `${"#".repeat(Math.min(3, section.level + 1))} ${section.heading}`);
    for (const block of section.blocks) {
      if (block.type === "paragraph") lines.push("", block.text);
      if (block.type === "list") {
        lines.push("", ...block.items.map((item, index) => block.ordered ? `${index + 1}. ${item}` : `- ${item}`));
      }
      if (block.type === "table") {
        lines.push(
          "",
          `| ${block.columns.map(escapeCell).join(" | ")} |`,
          `| ${block.columns.map(() => "---").join(" | ")} |`,
          ...block.rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
        );
      }
      if (block.type === "visual") {
        const request = spec.visualRequests.find((item) => item.id === block.visualRequestId);
        if (request) {
          lines.push("", `> Figure placeholder: ${request.caption}`);
        }
      }
    }
  }

  if (spec.references.length > 0) {
    lines.push("", spec.language === "zh-CN" ? "## 参考文献" : "## References", "");
    lines.push(...spec.references.map((reference) => `- ${reference.displayText}`));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
