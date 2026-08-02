import { z, type ZodType } from "zod";
import type { DocumentPlan } from "../contracts";
import type { GeneratedComponentPayload } from "../orchestration/contracts";
import { joinCitationSegmentTexts } from "../citations/segments";

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

const SemanticTableSchema = z
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

const SemanticFigureRequestSchema = z
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
};

export type ComponentContractDefinition = {
  contractId: string;
  contractVersion: 2 | 3;
  schemaName: string;
  modelOutputSchema: ZodType;
  example: unknown;
  modelOwnedFields: readonly string[];
  programOwnedFields: readonly string[];
  assemble(
    modelOutput: unknown,
    context: ComponentContractContext,
  ): GeneratedComponentPayload;
};

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

function assembleBody(
  raw: unknown,
  context: ComponentContractContext,
  paragraphRole: "body" | "conclusion",
): GeneratedComponentPayload {
  const output = BodyOutputSchema.parse(raw);
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
  const tablesByParagraph = new Map<number, typeof output.tables>();
  for (const table of output.tables) {
    if (table.placementAfterParagraphIndex >= output.paragraphs.length) {
      throw new Error(
        `Table placement ${table.placementAfterParagraphIndex} is outside the paragraph list.`,
      );
    }
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
    );
    if (placementAfterBlockIndex === undefined) {
      throw new Error(
        `Figure placement ${request.placementAfterParagraphIndex} is outside the paragraph list.`,
      );
    }
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

  return { kind: "blocks", blocks, figureRequests };
}

const sharedProgramOwnedFields = [
  "kind",
  "componentId",
  "componentRevision",
  "componentOrder",
  "heading",
  "headingLevel",
] as const;

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
    assemble(raw) {
      const output = TitleOutputSchema.parse(raw);
      return { kind: "title", title: output.title };
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
    assemble(raw) {
      const output = AbstractOutputSchema.parse(raw);
      return {
        kind: "blocks",
        blocks: output.paragraphs.map((paragraph) => ({
          type: "paragraph" as const,
          role: "abstract" as const,
          ...projectSegments(paragraph.segments),
          figureRequestIndexes: [],
        })),
        figureRequests: [],
      };
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
    assemble(raw) {
      const output = KeywordsOutputSchema.parse(raw);
      return {
        kind: "blocks",
        blocks: [{ type: "keywords", values: output.keywords }],
        figureRequests: [],
      };
    },
  },
  section: {
    contractId: "section_body",
    contractVersion: 3,
    schemaName: "document_section_body_v3",
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
    assemble(raw, context) {
      return assembleBody(raw, context, "body");
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
    assemble(raw, context) {
      const output = ConclusionOutputSchema.parse(raw);
      const heading = context.component.heading;
      if (!heading) {
        throw new Error(
          `Component "${context.component.componentKey}" requires a planned heading.`,
        );
      }
      return {
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
      };
    },
  },
  reference_list: {
    contractId: "reference_list",
    contractVersion: 2,
    schemaName: "document_reference_list_v2",
    modelOutputSchema: ReferenceListOutputSchema,
    example: { referenceIds: ["reference-01"] },
    modelOwnedFields: ["referenceIds"],
    programOwnedFields: sharedProgramOwnedFields,
    assemble(raw) {
      const output = ReferenceListOutputSchema.parse(raw);
      return { kind: "references", referenceIds: output.referenceIds };
    },
  },
};

export function getComponentContract(
  component: PlannedComponent,
): ComponentContractDefinition {
  return contracts[component.type];
}
