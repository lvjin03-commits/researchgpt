import { createHash } from "node:crypto";
import { z, type ZodType } from "zod";
import type { DocumentPlan } from "../contracts";
import type { GeneratedComponentPayload } from "../orchestration/contracts";
import { joinCitationSegmentTexts } from "../citations/segments";
import type { ContentNormalizationRecord } from "./content-normalizer";

type PlannedComponent = DocumentPlan["components"][number];
type FigureSlot = DocumentPlan["figureSlots"][number];

const IdentifierSchema = z.string().trim().min(1).max(120);
const CitationIdsSchema = z.array(IdentifierSchema).max(500).default([]);
const FigureReferenceIdsSchema = z
  .array(IdentifierSchema)
  .max(100)
  .default([]);

const SemanticCitationSegmentSchema = z
  .object({
    text: z.string().trim().min(1),
    citationIds: CitationIdsSchema,
  })
  .strict();

const SemanticTextParagraphSchema = z
  .object({
    segments: z.array(SemanticCitationSegmentSchema).min(1).max(2_000),
  })
  .strict();

const SemanticParagraphSchema = SemanticTextParagraphSchema.extend({
    figureReferenceIds: FigureReferenceIdsSchema,
  })
  .strict();

const LegacySemanticTableSchema = z
  .object({
    caption: z.string().trim().min(1),
    columns: z.array(z.string().trim().min(1)).min(1).max(50),
    rows: z.array(z.array(z.string()).min(1).max(50)).min(1).max(500),
    placementAfterParagraphIndex: z.number().int().min(0).max(499),
  })
  .strict()
  .superRefine((table, context) => {
    table.rows.forEach((row, index) => {
      if (row.length !== table.columns.length) {
        context.addIssue({
          code: "custom",
          path: ["rows", index],
          message: "Every table row must match the column count.",
        });
      }
    });
  });

const LegacySemanticFigureRequestSchema = z
  .object({
    slotId: IdentifierSchema,
    title: z.string().trim().min(1).max(500),
    caption: z.string().trim().min(1).max(2_000),
    altText: z.string().trim().min(1).max(1_000),
    contentBrief: z.string().trim().min(1).max(4_000),
    placementAfterParagraphIndex: z.number().int().min(0).max(499),
  })
  .strict();

const TitleOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
  })
  .strict();

const AbstractOutputSchema = z
  .object({
    paragraphs: z.array(SemanticTextParagraphSchema).length(1),
  })
  .strict();

const KeywordsOutputSchema = z
  .object({
    keywords: z.array(z.string().trim().min(1).max(100)).min(3).max(8),
  })
  .strict();

const LegacyBodyOutputSchema = z
  .object({
    paragraphs: z.array(SemanticParagraphSchema).min(1).max(500),
    tables: z.array(LegacySemanticTableSchema).max(50).default([]),
    figureRequests: z
      .array(LegacySemanticFigureRequestSchema)
      .max(100)
      .default([]),
  })
  .strict();

const SemanticTableSchema = z
  .object({
    caption: z.string().trim().min(1),
    columns: z.array(z.string().trim().min(1)).min(1).max(50),
    rows: z.array(z.array(z.string()).min(1).max(50)).min(1).max(500),
    anchorCitationIds: CitationIdsSchema,
    preferredPlacement: z
      .enum([
        "after_relevant_claim",
        "after_section_discussion",
        "before_section_summary",
      ])
      .default("after_relevant_claim"),
  })
  .strict()
  .superRefine((table, context) => {
    table.rows.forEach((row, index) => {
      if (row.length !== table.columns.length) {
        context.addIssue({
          code: "custom",
          path: ["rows", index],
          message: "Every table row must match the column count.",
        });
      }
    });
  });

const SemanticFigureRequestSchema = z
  .object({
    slotId: IdentifierSchema,
    title: z.string().trim().min(1).max(500),
    caption: z.string().trim().min(1).max(2_000),
    altText: z.string().trim().min(1).max(1_000),
    contentBrief: z.string().trim().min(1).max(4_000),
  })
  .strict();

const BodyOutputSchema = z
  .object({
    paragraphs: z.array(SemanticParagraphSchema).min(1).max(500),
    tables: z.array(SemanticTableSchema).max(50).default([]),
    figureRequests: z
      .array(SemanticFigureRequestSchema)
      .max(100)
      .default([]),
  })
  .strict();

const ConclusionOutputSchema = z
  .object({
    paragraphs: z.array(SemanticTextParagraphSchema).min(1).max(500),
  })
  .strict();

const ReferenceListOutputSchema = z
  .object({
    referenceIds: z.array(IdentifierSchema).max(500),
  })
  .strict();

export type ComponentContractContext = {
  component: PlannedComponent;
  figureSlots: ReadonlyArray<FigureSlot>;
  allowedCitationIds: ReadonlyArray<string>;
};

export type FieldOwnership =
  | "model_semantic"
  | "program_generated"
  | "program_derived"
  | "model_selects_from_allowed";

export type ComponentAssemblyResult = {
  payload: GeneratedComponentPayload;
  normalizationRecords: ContentNormalizationRecord[];
};

export type ComponentContractDefinition = {
  contractId: string;
  contractVersion: 2 | 3 | 4;
  schemaName: string;
  modelOutputSchema: ZodType;
  example: unknown;
  modelOwnedFields: readonly string[];
  programOwnedFields: readonly string[];
  fieldOwnership: Readonly<Record<string, FieldOwnership>>;
  assemble(
    modelOutput: unknown,
    context: ComponentContractContext,
  ): ComponentAssemblyResult;
};

function assembled(payload: GeneratedComponentPayload): ComponentAssemblyResult {
  return { payload, normalizationRecords: [] };
}

function normalizationRecord(input: {
  fieldPath: string;
  rawValue: number | string;
  normalizedValue: number | string;
  rule: string;
}): ContentNormalizationRecord {
  const rawValue = String(input.rawValue);
  return {
    fieldPath: input.fieldPath,
    rawValueHash: createHash("sha256").update(rawValue).digest("hex"),
    rawPreview: rawValue.slice(0, 240),
    normalizedValue: String(input.normalizedValue),
    rulesApplied: [input.rule],
    normalizerVersion: "layout-contract-v1",
  };
}

function projectSegments(
  segments: ReadonlyArray<{ text: string; citationIds: string[] }>,
) {
  return {
    text: joinCitationSegmentTexts(segments),
    citationIds: [
      ...new Set(segments.flatMap((segment) => segment.citationIds)),
    ],
    citationGranularity: "segment" as const,
    segments: segments.map((segment) => ({
      text: segment.text,
      citationIds: [...segment.citationIds],
    })),
  };
}

type ResolvedTable = {
  caption: string;
  columns: string[];
  rows: string[][];
  placementAfterParagraphIndex: number;
};

type ResolvedFigureRequest = {
  slotId: string;
  title: string;
  caption: string;
  altText: string;
  contentBrief: string;
  placementAfterParagraphIndex: number;
};

function assembleResolvedBody(
  output: {
    paragraphs: z.infer<typeof SemanticParagraphSchema>[];
    tables: ResolvedTable[];
    figureRequests: ResolvedFigureRequest[];
  },
  context: ComponentContractContext,
  paragraphRole: "body" | "conclusion",
  normalizationRecords: ContentNormalizationRecord[],
): ComponentAssemblyResult {
  const heading = context.component.heading;
  if (!heading) {
    throw new Error(
      `Component "${context.component.componentKey}" requires a planned heading.`,
    );
  }

  const slotById = new Map(
    context.figureSlots.map((slot) => [slot.slotId, slot]),
  );
  const requestIndexBySlotId = new Map(
    output.figureRequests.map((request, index) => [request.slotId, index]),
  );
  const tablesByParagraph = new Map<number, ResolvedTable[]>();
  for (const table of output.tables) {
    const current = tablesByParagraph.get(table.placementAfterParagraphIndex);
    if (current) current.push(table);
    else tablesByParagraph.set(table.placementAfterParagraphIndex, [table]);
  }

  const blocks: Array<
    | { type: "heading"; level: 1; text: string }
    | {
        type: "paragraph";
        role: "body" | "conclusion";
        text: string;
        citationIds: string[];
        citationGranularity: "segment";
        segments: Array<{ text: string; citationIds: string[] }>;
        figureRequestIndexes: number[];
      }
    | {
        type: "table";
        caption: string;
        columns: string[];
        rows: string[][];
      }
  > = [{ type: "heading", level: 1, text: heading }];
  const blockIndexAfterParagraph = new Map<number, number>();

  output.paragraphs.forEach((paragraph, paragraphIndex) => {
    const figureRequestIndexes = paragraph.figureReferenceIds.map((slotId) => {
      const requestIndex = requestIndexBySlotId.get(slotId);
      if (requestIndex === undefined) {
        throw new Error(
          `Paragraph references figure slot "${slotId}" without a completed figure request.`,
        );
      }
      return requestIndex;
    });
    blocks.push({
      type: "paragraph",
      role: paragraphRole,
      ...projectSegments(paragraph.segments),
      figureRequestIndexes,
    });
    blockIndexAfterParagraph.set(paragraphIndex, blocks.length - 1);
    for (const table of tablesByParagraph.get(paragraphIndex) ?? []) {
      blocks.push({
        type: "table",
        caption: table.caption,
        columns: table.columns,
        rows: table.rows,
      });
    }
  });

  const figureRequests = output.figureRequests.map((request) => {
    const slot = slotById.get(request.slotId);
    if (!slot) {
      throw new Error(
        `Figure request references unplanned slot "${request.slotId}".`,
      );
    }
    const placementAfterBlockIndex = blockIndexAfterParagraph.get(
      request.placementAfterParagraphIndex,
    )!;
    return {
      slotId: slot.slotId,
      figureType: slot.figureType,
      title: request.title,
      caption: request.caption,
      altText: request.altText,
      contentBrief: request.contentBrief,
      questionAnswered: slot.questionAnswered,
      evidenceMode: slot.evidenceMode,
      claimsRepresented: slot.claimsRepresented,
      placementAfterBlockIndex,
      sourceEvidenceIds: slot.requiredEvidenceIds,
    };
  });

  return {
    payload: { kind: "blocks", blocks, figureRequests },
    normalizationRecords,
  };
}

function assembleLegacyBody(
  raw: unknown,
  context: ComponentContractContext,
): ComponentAssemblyResult {
  const output = LegacyBodyOutputSchema.parse(raw);
  const lastParagraphIndex = output.paragraphs.length - 1;
  const normalizationRecords: ContentNormalizationRecord[] = [];
  const tables = output.tables.map((table, index) => {
    const resolvedIndex = Math.min(
      table.placementAfterParagraphIndex,
      lastParagraphIndex,
    );
    if (resolvedIndex !== table.placementAfterParagraphIndex) {
      normalizationRecords.push(
        normalizationRecord({
          fieldPath: `tables[${index}].placementAfterParagraphIndex`,
          rawValue: table.placementAfterParagraphIndex,
          normalizedValue: resolvedIndex,
          rule: "legacy_table_placement_clamped",
        }),
      );
    }
    return { ...table, placementAfterParagraphIndex: resolvedIndex };
  });
  const figureRequests = output.figureRequests.map((request, index) => {
    const resolvedIndex = Math.min(
      request.placementAfterParagraphIndex,
      lastParagraphIndex,
    );
    if (resolvedIndex !== request.placementAfterParagraphIndex) {
      normalizationRecords.push(
        normalizationRecord({
          fieldPath: `figureRequests[${index}].placementAfterParagraphIndex`,
          rawValue: request.placementAfterParagraphIndex,
          normalizedValue: resolvedIndex,
          rule: "legacy_figure_placement_clamped",
        }),
      );
    }
    return { ...request, placementAfterParagraphIndex: resolvedIndex };
  });
  return assembleResolvedBody(
    { paragraphs: output.paragraphs, tables, figureRequests },
    context,
    "body",
    normalizationRecords,
  );
}

function assembleCurrentBody(
  raw: unknown,
  context: ComponentContractContext,
): ComponentAssemblyResult {
  const output = BodyOutputSchema.parse(raw);
  const lastParagraphIndex = output.paragraphs.length - 1;
  const allowedCitationIds = new Set(context.allowedCitationIds);
  const normalizationRecords: ContentNormalizationRecord[] = [];
  const tables = output.tables.map((table, index) => {
    const authorizedAnchors = table.anchorCitationIds.filter((citationId) =>
      allowedCitationIds.has(citationId),
    );
    if (authorizedAnchors.length !== table.anchorCitationIds.length) {
      normalizationRecords.push(
        normalizationRecord({
          fieldPath: `tables[${index}].anchorCitationIds`,
          rawValue: table.anchorCitationIds.join(","),
          normalizedValue: authorizedAnchors.join(","),
          rule: "drop_unallowed_table_anchor",
        }),
      );
    }
    const anchorSet = new Set(authorizedAnchors);
    const relevantParagraphIndex = output.paragraphs.findIndex((paragraph) =>
      paragraph.segments.some((segment) =>
        segment.citationIds.some((citationId) => anchorSet.has(citationId)),
      ),
    );
    const resolvedIndex =
      relevantParagraphIndex >= 0
        ? relevantParagraphIndex
        : table.preferredPlacement === "before_section_summary" &&
            output.paragraphs.length > 1
          ? lastParagraphIndex - 1
          : lastParagraphIndex;
    if (relevantParagraphIndex < 0) {
      normalizationRecords.push(
        normalizationRecord({
          fieldPath: `tables[${index}].anchorCitationIds`,
          rawValue: authorizedAnchors.join(","),
          normalizedValue: resolvedIndex,
          rule: "table_placement_section_fallback",
        }),
      );
    }
    return {
      caption: table.caption,
      columns: table.columns,
      rows: table.rows,
      placementAfterParagraphIndex: resolvedIndex,
    };
  });
  const figureRequests = output.figureRequests.map((request, index) => {
    const referencedParagraphIndex = output.paragraphs.findIndex((paragraph) =>
      paragraph.figureReferenceIds.includes(request.slotId),
    );
    const resolvedIndex =
      referencedParagraphIndex >= 0
        ? referencedParagraphIndex
        : lastParagraphIndex;
    if (referencedParagraphIndex < 0) {
      normalizationRecords.push(
        normalizationRecord({
          fieldPath: `figureRequests[${index}].slotId`,
          rawValue: request.slotId,
          normalizedValue: resolvedIndex,
          rule: "figure_placement_section_fallback",
        }),
      );
    }
    return { ...request, placementAfterParagraphIndex: resolvedIndex };
  });
  return assembleResolvedBody(
    { paragraphs: output.paragraphs, tables, figureRequests },
    context,
    "body",
    normalizationRecords,
  );
}

const sharedProgramOwnedFields = [
  "kind",
  "componentId",
  "componentRevision",
  "componentOrder",
  "heading",
  "headingLevel",
] as const;

const sharedProgramOwnership = Object.fromEntries(
  sharedProgramOwnedFields.map((field) => [field, "program_generated"]),
) as Readonly<Record<string, FieldOwnership>>;

const legacySectionContract: ComponentContractDefinition = {
  contractId: "section_body",
  contractVersion: 3,
  schemaName: "document_section_body_v3",
  modelOutputSchema: LegacyBodyOutputSchema,
  example: {
    paragraphs: [
      {
        segments: [
          { text: "Publication-ready body paragraph.", citationIds: [] },
        ],
        figureReferenceIds: [],
      },
    ],
    tables: [],
    figureRequests: [],
  },
  modelOwnedFields: [
    "paragraphs[].segments[].text",
    "paragraphs[].segments[].citationIds",
    "paragraphs[].figureReferenceIds",
    "tables",
    "figureRequests[].title",
    "figureRequests[].caption",
    "figureRequests[].altText",
    "figureRequests[].contentBrief",
    "figureRequests[].placementAfterParagraphIndex",
  ],
  programOwnedFields: [
    ...sharedProgramOwnedFields,
    "paragraphRole",
    "figureType",
  ],
  fieldOwnership: {
    ...sharedProgramOwnership,
    "paragraphs[].segments[].text": "model_semantic",
    "paragraphs[].segments[].citationIds": "model_selects_from_allowed",
    "paragraphs[].figureReferenceIds": "model_selects_from_allowed",
    tables: "model_semantic",
    "tables[].placementAfterParagraphIndex": "program_derived",
    figureRequests: "model_semantic",
    "figureRequests[].slotId": "model_selects_from_allowed",
    "figureRequests[].placementAfterParagraphIndex": "program_derived",
    paragraphRole: "program_generated",
    figureType: "program_derived",
  },
  assemble(raw, context) {
    return assembleLegacyBody(raw, context);
  },
};

const contracts: Record<
  PlannedComponent["type"],
  ComponentContractDefinition
> = {
  title: {
    contractId: "title",
    contractVersion: 2,
    schemaName: "document_title_v2",
    modelOutputSchema: TitleOutputSchema,
    example: { title: "Physical Gel Preparation and Structural Control" },
    modelOwnedFields: ["title"],
    programOwnedFields: sharedProgramOwnedFields,
    fieldOwnership: {
      ...sharedProgramOwnership,
      title: "model_semantic",
    },
    assemble(raw) {
      const output = TitleOutputSchema.parse(raw);
      return assembled({ kind: "title", title: output.title });
    },
  },
  abstract: {
    contractId: "abstract",
    contractVersion: 3,
    schemaName: "document_abstract_v3",
    modelOutputSchema: AbstractOutputSchema,
    example: {
      paragraphs: [
        {
          segments: [
            {
              text: "Publication-ready abstract content.",
              citationIds: [],
            },
          ],
        },
      ],
    },
    modelOwnedFields: [
      "paragraphs[].segments[].text",
      "paragraphs[].segments[].citationIds",
    ],
    programOwnedFields: [...sharedProgramOwnedFields, "paragraphRole"],
    fieldOwnership: {
      ...sharedProgramOwnership,
      "paragraphs[].segments[].text": "model_semantic",
      "paragraphs[].segments[].citationIds": "model_selects_from_allowed",
      paragraphRole: "program_generated",
    },
    assemble(raw) {
      const output = AbstractOutputSchema.parse(raw);
      return assembled({
        kind: "blocks",
        blocks: output.paragraphs.map((paragraph) => ({
          type: "paragraph" as const,
          role: "abstract" as const,
          ...projectSegments(paragraph.segments),
          figureRequestIndexes: [],
        })),
        figureRequests: [],
      });
    },
  },
  keywords: {
    contractId: "keywords",
    contractVersion: 2,
    schemaName: "document_keywords_v2",
    modelOutputSchema: KeywordsOutputSchema,
    example: {
      keywords: ["physical gels", "reversible junctions", "self-assembly"],
    },
    modelOwnedFields: ["keywords"],
    programOwnedFields: [...sharedProgramOwnedFields, "blockType"],
    fieldOwnership: {
      ...sharedProgramOwnership,
      keywords: "model_semantic",
      blockType: "program_generated",
    },
    assemble(raw) {
      const output = KeywordsOutputSchema.parse(raw);
      return assembled({
        kind: "blocks",
        blocks: [{ type: "keywords", values: output.keywords }],
        figureRequests: [],
      });
    },
  },
  section: {
    contractId: "section_body",
    contractVersion: 4,
    schemaName: "document_section_body_v4",
    modelOutputSchema: BodyOutputSchema,
    example: {
      paragraphs: [
        {
          segments: [
            {
              text: "Publication-ready body paragraph.",
              citationIds: [],
            },
          ],
          figureReferenceIds: [],
        },
      ],
      tables: [],
      figureRequests: [],
    },
    modelOwnedFields: [
      "paragraphs[].segments[].text",
      "paragraphs[].segments[].citationIds",
      "paragraphs[].figureReferenceIds",
      "tables[].caption",
      "tables[].columns",
      "tables[].rows",
      "tables[].anchorCitationIds",
      "tables[].preferredPlacement",
      "figureRequests[].slotId",
      "figureRequests[].title",
      "figureRequests[].caption",
      "figureRequests[].altText",
      "figureRequests[].contentBrief",
    ],
    programOwnedFields: [
      ...sharedProgramOwnedFields,
      "paragraphRole",
      "figureType",
      "tables[].placementAfterParagraphIndex",
      "figureRequests[].placementAfterParagraphIndex",
    ],
    fieldOwnership: {
      ...sharedProgramOwnership,
      "paragraphs[].segments[].text": "model_semantic",
      "paragraphs[].segments[].citationIds": "model_selects_from_allowed",
      "paragraphs[].figureReferenceIds": "model_selects_from_allowed",
      "tables[].caption": "model_semantic",
      "tables[].columns": "model_semantic",
      "tables[].rows": "model_semantic",
      "tables[].anchorCitationIds": "model_selects_from_allowed",
      "tables[].preferredPlacement": "model_semantic",
      "tables[].placementAfterParagraphIndex": "program_derived",
      "figureRequests[].slotId": "model_selects_from_allowed",
      "figureRequests[].title": "model_semantic",
      "figureRequests[].caption": "model_semantic",
      "figureRequests[].altText": "model_semantic",
      "figureRequests[].contentBrief": "model_semantic",
      "figureRequests[].placementAfterParagraphIndex": "program_derived",
      paragraphRole: "program_generated",
      figureType: "program_derived",
    },
    assemble(raw, context) {
      return assembleCurrentBody(raw, context);
    },
  },
  conclusion: {
    contractId: "conclusion_body",
    contractVersion: 3,
    schemaName: "document_conclusion_body_v3",
    modelOutputSchema: ConclusionOutputSchema,
    example: {
      paragraphs: [
        {
          segments: [
            {
              text: "Publication-ready conclusion content.",
              citationIds: [],
            },
          ],
        },
      ],
    },
    modelOwnedFields: [
      "paragraphs[].segments[].text",
      "paragraphs[].segments[].citationIds",
    ],
    programOwnedFields: [...sharedProgramOwnedFields, "paragraphRole"],
    fieldOwnership: {
      ...sharedProgramOwnership,
      "paragraphs[].segments[].text": "model_semantic",
      "paragraphs[].segments[].citationIds": "model_selects_from_allowed",
      paragraphRole: "program_generated",
    },
    assemble(raw, context) {
      const output = ConclusionOutputSchema.parse(raw);
      const heading = context.component.heading;
      if (!heading) {
        throw new Error(
          `Component "${context.component.componentKey}" requires a planned heading.`,
        );
      }
      return assembled({
        kind: "blocks",
        blocks: [
          { type: "heading", level: 1, text: heading },
          ...output.paragraphs.map((paragraph) => ({
            type: "paragraph" as const,
            role: "conclusion" as const,
            ...projectSegments(paragraph.segments),
            figureRequestIndexes: [],
          })),
        ],
        figureRequests: [],
      });
    },
  },
  reference_list: {
    contractId: "reference_list",
    contractVersion: 2,
    schemaName: "document_reference_list_v2",
    modelOutputSchema: ReferenceListOutputSchema,
    example: { referenceIds: ["reference-01"] },
    modelOwnedFields: [],
    programOwnedFields: [...sharedProgramOwnedFields, "referenceIds"],
    fieldOwnership: {
      ...sharedProgramOwnership,
      referenceIds: "program_derived",
    },
    assemble(raw) {
      const output = ReferenceListOutputSchema.parse(raw);
      return assembled({ kind: "references", referenceIds: output.referenceIds });
    },
  },
};

export function getComponentContract(
  component: PlannedComponent,
  componentContractEpoch: 3 | 4 = 4,
): ComponentContractDefinition {
  if (component.type === "section" && componentContractEpoch === 3) {
    return legacySectionContract;
  }
  return contracts[component.type];
}

export function assertCurrentComponentContractOwnership(): void {
  for (const contract of Object.values(contracts)) {
    const modelFields = new Set(contract.modelOwnedFields);
    const programFields = new Set(contract.programOwnedFields);
    for (const field of modelFields) {
      if (programFields.has(field)) {
        throw new Error(
          `Component contract "${contract.contractId}" assigns "${field}" to both model and program.`,
        );
      }
      const ownership = contract.fieldOwnership[field];
      if (
        ownership !== "model_semantic" &&
        ownership !== "model_selects_from_allowed"
      ) {
        throw new Error(
          `Model field "${field}" in "${contract.contractId}" lacks valid ownership metadata.`,
        );
      }
    }
    for (const field of programFields) {
      const ownership = contract.fieldOwnership[field];
      if (
        ownership !== "program_generated" &&
        ownership !== "program_derived"
      ) {
        throw new Error(
          `Program field "${field}" in "${contract.contractId}" lacks valid ownership metadata.`,
        );
      }
    }
  }

  const currentSectionSchema = JSON.stringify(z.toJSONSchema(BodyOutputSchema));
  if (currentSectionSchema.includes("placementAfterParagraphIndex")) {
    throw new Error(
      "The current section model schema must not expose absolute placement indexes.",
    );
  }
}
