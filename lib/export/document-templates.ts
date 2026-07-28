import type { ArtifactTemplateId } from "@/lib/export/artifact-planner";
import type { DocumentLanguage } from "@/lib/export/document-language";
import type { ExportFormat } from "@/lib/export/types";

export type DocumentTemplateId =
  | "sci-academic-word"
  | "literature-review-word"
  | "research-report-word"
  | "paper-reading-word"
  | "proposal-word"
  | "meeting-notes-word"
  | "business-report-word"
  | "general-word";

export type DocumentComponentId =
  | "title"
  | "subtitle"
  | "author_information"
  | "abstract"
  | "keywords"
  | "introduction"
  | "body"
  | "discussion"
  | "limitations"
  | "future_perspective"
  | "conclusion"
  | "figures"
  | "tables"
  | "equations"
  | "references";

export type TemplateComponentRule = {
  id: DocumentComponentId;
  required: boolean;
  repeatable?: boolean;
  dependsOn: DocumentComponentId[];
  aiResponsibility: string;
  decisionBasis: string[];
  matureOutput: string;
};

export type DocumentTemplateDefinition = {
  id: DocumentTemplateId;
  version: number;
  name: string;
  status: "active" | "planned";
  supportedFormats: ExportFormat[];
  rendererTemplateId?: ArtifactTemplateId;
  matchingPolicy?: {
    include: RegExp[];
    exclude: RegExp[];
  };
  components: TemplateComponentRule[];
  fixedRenderingRules?: {
    archivePath: string;
    page: {
      size: "A4";
      orientation: "portrait";
      columns: 1;
      marginsMm: { top: 20; bottom: 20; left: 22; right: 22 };
    };
    maximumHeadingLevel: 3;
    figureMinimumDpi: 300;
    editableTables: true;
    wordStylesRequired: true;
  };
  globalContentRules?: string[];
};

export type ResolvedDocumentTemplate = {
  id: DocumentTemplateId | "legacy-general-word";
  version: number;
  name: string;
  source: "registry" | "legacy_fallback";
  selectionReason: string;
  rendererTemplateId: ArtifactTemplateId;
  components: TemplateComponentRule[];
  globalContentRules: string[];
};

const SCI_COMPONENTS: TemplateComponentRule[] = [
  {
    id: "title",
    required: true,
    dependsOn: ["body", "conclusion", "abstract", "keywords"],
    aiResponsibility: "Generate the final subject-specific scientific title.",
    decisionBasis: ["document subject", "central contribution", "mature body", "target journal tone"],
    matureOutput: "Final title text, not the user command and not a structural label.",
  },
  {
    id: "subtitle",
    required: false,
    dependsOn: ["title"],
    aiResponsibility: "Decide whether a subtitle materially improves precision.",
    decisionBasis: ["document type", "title scope"],
    matureOutput: "Final subtitle or an explicit omission.",
  },
  {
    id: "author_information",
    required: false,
    dependsOn: [],
    aiResponsibility: "Use only author and affiliation information explicitly supplied by the user.",
    decisionBasis: ["verified user-provided metadata"],
    matureOutput: "Verified author and affiliation text or an explicit omission.",
  },
  {
    id: "abstract",
    required: true,
    dependsOn: ["introduction", "body", "conclusion"],
    aiResponsibility: "Write a mature single-paragraph abstract grounded in the completed document.",
    decisionBasis: ["mature introduction", "main evidence", "discussion", "conclusion"],
    matureOutput: "Complete Abstract containing no unsupported result.",
  },
  {
    id: "keywords",
    required: true,
    dependsOn: ["abstract", "body"],
    aiResponsibility: "Extract the document's stable scientific terminology.",
    decisionBasis: ["full document theme", "final abstract", "terminology map"],
    matureOutput: "Three to eight final keywords.",
  },
  {
    id: "introduction",
    required: true,
    dependsOn: [],
    aiResponsibility: "Establish background, scope, scientific problem, and document objective.",
    decisionBasis: ["user request", "verified evidence", "document scope"],
    matureOutput: "Complete introduction paragraphs.",
  },
  {
    id: "body",
    required: true,
    repeatable: true,
    dependsOn: ["introduction"],
    aiResponsibility: "Choose coherent section names, order, depth, paragraph structure, and transitions.",
    decisionBasis: ["scientific logic", "evidence structure", "topic complexity", "length target"],
    matureOutput: "Five to eight sections when appropriate, using no more than three heading levels.",
  },
  {
    id: "discussion",
    required: false,
    dependsOn: ["body"],
    aiResponsibility: "Add a discussion when interpretation or comparison is needed.",
    decisionBasis: ["analytical depth", "conflicting evidence", "mechanistic interpretation"],
    matureOutput: "Mature discussion section or an explicit omission.",
  },
  {
    id: "limitations",
    required: false,
    dependsOn: ["body", "discussion"],
    aiResponsibility: "Add limitations when evidence boundaries must be made explicit.",
    decisionBasis: ["evidence quality", "methodological constraints", "scope"],
    matureOutput: "Mature limitations section or an explicit omission.",
  },
  {
    id: "future_perspective",
    required: false,
    dependsOn: ["body", "limitations"],
    aiResponsibility: "Add future perspectives only when supported by the analysis.",
    decisionBasis: ["research gaps", "unresolved mechanisms", "practical constraints"],
    matureOutput: "Mature future-perspective section or an explicit omission.",
  },
  {
    id: "conclusion",
    required: true,
    dependsOn: ["body", "discussion", "limitations"],
    aiResponsibility: "Synthesize the mature document without introducing new unsupported claims.",
    decisionBasis: ["full document content", "central question", "evidence boundaries"],
    matureOutput: "Complete conclusion.",
  },
  {
    id: "figures",
    required: false,
    repeatable: true,
    dependsOn: ["body"],
    aiResponsibility: "Decide analytical need, type, scientific content, caption, legend, placement, and body cross-reference.",
    decisionBasis: ["content complexity", "reading logic", "verified data availability"],
    matureOutput: "Final image asset request, final caption, legend, source statement, alt text, and placement relationship.",
  },
  {
    id: "tables",
    required: false,
    repeatable: true,
    dependsOn: ["body"],
    aiResponsibility: "Decide whether comparison is clearer as an editable table and generate mature cells.",
    decisionBasis: ["repeated comparable fields", "evidence structure", "reading logic"],
    matureOutput: "Final caption, columns, rows, source statement, and placement relationship.",
  },
  {
    id: "equations",
    required: false,
    repeatable: true,
    dependsOn: ["body"],
    aiResponsibility: "Generate only equations required by the scientific explanation.",
    decisionBasis: ["scientific content", "mathematical necessity"],
    matureOutput: "Final equation semantics and body reference relationship.",
  },
  {
    id: "references",
    required: true,
    dependsOn: ["introduction", "body", "discussion", "conclusion"],
    aiResponsibility: "Map supported claims to verified references in first-appearance order.",
    decisionBasis: ["verified source context", "claim-to-source mapping"],
    matureOutput: "Verified numeric references or an explicit no-source notice; never fabricated metadata.",
  },
];

export const DOCUMENT_TEMPLATE_REGISTRY: DocumentTemplateDefinition[] = [
  {
    id: "sci-academic-word",
    version: 1,
    name: "SCI Academic Word",
    status: "active",
    supportedFormats: ["docx"],
    rendererTemplateId: "nature",
    matchingPolicy: {
      include: [
        /\b(?:sci|nature|manuscript|scientific\s+(?:paper|review)|academic\s+(?:paper|manuscript))\b/i,
        /(?:SCI|Nature|学术|科研).{0,12}(?:论文|稿件|综述|Word|文档)/u,
        /(?:论文|综述|科研报告).{0,20}(?:摘要|关键词|参考文献|机制图|三线表)/u,
      ],
      exclude: [/(?:会议纪要|简历|合同|通知|宣传册|项目排期)/u],
    },
    components: SCI_COMPONENTS,
    fixedRenderingRules: {
      archivePath: "docs/word-rendering-fixed-rules-archive.md",
      page: {
        size: "A4",
        orientation: "portrait",
        columns: 1,
        marginsMm: { top: 20, bottom: 20, left: 22, right: 22 },
      },
      maximumHeadingLevel: 3,
      figureMinimumDpi: 300,
      editableTables: true,
      wordStylesRequired: true,
    },
    globalContentRules: [
      "Generate mature components rather than outlines, placeholders, prompts, or raw data.",
      "Use at most three heading levels.",
      "Keep terminology and abbreviations consistent across all components.",
      "Figures and tables must be referenced by the mature body and must match it.",
      "Never fabricate DOI, author, journal, quantitative result, or reference metadata.",
      "If verified sources are unavailable, produce an explicit no-source draft.",
    ],
  },
  ...[
    ["literature-review-word", "Literature Review Word"],
    ["research-report-word", "Research Report Word"],
    ["paper-reading-word", "Paper Reading Word"],
    ["proposal-word", "Proposal Word"],
    ["meeting-notes-word", "Meeting Notes Word"],
    ["business-report-word", "Business Report Word"],
    ["general-word", "General Word"],
  ].map(
    ([id, name]) =>
      ({
        id: id as DocumentTemplateId,
        version: 0,
        name,
        status: "planned",
        supportedFormats: ["docx"],
        components: [],
      }) satisfies DocumentTemplateDefinition,
  ),
];

export function getDocumentTemplate(
  id: DocumentTemplateId,
): DocumentTemplateDefinition | undefined {
  return DOCUMENT_TEMPLATE_REGISTRY.find((template) => template.id === id);
}

export function orderTemplateComponents(
  components: TemplateComponentRule[],
): TemplateComponentRule[] {
  const byId = new Map(components.map((component) => [component.id, component]));
  const remaining = new Set(components.map((component) => component.id));
  const completed = new Set<DocumentComponentId>();
  const ordered: TemplateComponentRule[] = [];

  while (remaining.size > 0) {
    const ready = components.filter(
      (component) =>
        remaining.has(component.id) &&
        component.dependsOn.every(
          (dependency) => !byId.has(dependency) || completed.has(dependency),
        ),
    );
    if (ready.length === 0) {
      throw new Error("Document template component dependencies contain a cycle.");
    }
    for (const component of ready) {
      ordered.push(component);
      remaining.delete(component.id);
      completed.add(component.id);
    }
  }

  return ordered;
}

export function resolveDocumentTemplate(input: {
  query: string;
  format: ExportFormat;
  legacyTemplateId?: ArtifactTemplateId;
}): ResolvedDocumentTemplate {
  const activeCandidates = DOCUMENT_TEMPLATE_REGISTRY.filter(
    (template) =>
      template.status === "active" &&
      template.supportedFormats.includes(input.format) &&
      template.matchingPolicy &&
      !template.matchingPolicy.exclude.some((pattern) => pattern.test(input.query)) &&
      template.matchingPolicy.include.some((pattern) => pattern.test(input.query)),
  );
  const selected = activeCandidates[0];
  if (selected) {
    return {
      id: selected.id,
      version: selected.version,
      name: selected.name,
      source: "registry",
      selectionReason: "The normalized request matched the registered SCI document policy.",
      rendererTemplateId: selected.rendererTemplateId ?? "academic",
      components: selected.components,
      globalContentRules: selected.globalContentRules ?? [],
    };
  }

  return {
    id: "legacy-general-word",
    version: 0,
    name: "Legacy General Word",
    source: "legacy_fallback",
    selectionReason:
      "No active registered template matched; planned templates are never selected automatically.",
    rendererTemplateId: input.legacyTemplateId ?? "academic",
    components: [],
    globalContentRules: [],
  };
}

export function resolvedTemplateByIdentity(input: {
  id: ResolvedDocumentTemplate["id"];
  version: number;
}): ResolvedDocumentTemplate {
  if (input.id !== "legacy-general-word") {
    const definition = getDocumentTemplate(input.id);
    if (
      definition?.status === "active" &&
      definition.version === input.version
    ) {
      return {
        id: definition.id,
        version: definition.version,
        name: definition.name,
        source: "registry",
        selectionReason: "Restored from the frozen document plan.",
        rendererTemplateId: definition.rendererTemplateId ?? "academic",
        components: definition.components,
        globalContentRules: definition.globalContentRules ?? [],
      };
    }
  }
  return {
    id: "legacy-general-word",
    version: 0,
    name: "Legacy General Word",
    source: "legacy_fallback",
    selectionReason: "Restored from the frozen legacy document plan.",
    rendererTemplateId: "academic",
    components: [],
    globalContentRules: [],
  };
}

export function templateComponentPrompt(
  template: ResolvedDocumentTemplate,
  language: DocumentLanguage,
): string {
  if (template.source !== "registry") {
    return `Template: ${template.name}. Preserve the existing general document behavior.`;
  }
  return [
    `Resolved template: ${template.id}@${template.version} (${template.name}).`,
    "This selection is frozen for planning, content generation, validation, and rendering.",
    `Document language: ${language}.`,
    `Global content rules: ${JSON.stringify(template.globalContentRules)}.`,
    `Component contracts: ${JSON.stringify(template.components)}.`,
    "Generate mature component content only. Rendering parameters are immutable and are not part of the model's decision space.",
  ].join("\n");
}
