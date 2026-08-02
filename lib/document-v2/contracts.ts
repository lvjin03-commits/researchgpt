import { z } from "zod";
import { FigureAssetSchema } from "./assets/contracts.ts";
import { joinCitationSegmentTexts } from "./citations/segments.ts";

const IdentifierSchema = z.string().min(1).max(120);

export const CitationPlacementPolicySchema = z
  .object({
    policyVersion: z.string().min(1).max(40),
    placement: z.enum([
      "before_terminal_punctuation",
      "after_terminal_punctuation",
    ]),
    display: z.enum(["bracketed", "superscript"]),
    includeAbstract: z.boolean(),
    includeFigureCaptions: z.boolean(),
    includeTableCaptions: z.boolean(),
    includeAppendices: z.boolean(),
  })
  .strict();

const LEGACY_CITATION_POLICY = {
  policyVersion: "legacy-v1",
  placement: "after_terminal_punctuation",
  display: "bracketed",
  includeAbstract: true,
  includeFigureCaptions: false,
  includeTableCaptions: false,
  includeAppendices: true,
} as const;

export const ResolvedTemplateSnapshotSchema = z
  .object({
    templateId: IdentifierSchema,
    templateVersion: z.string().min(1).max(40),
    checksum: z.string().regex(/^[a-f0-9]{64}$/i),
    origin: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("system") }).strict(),
      z
        .object({
          kind: z.literal("user_upload"),
          uploadId: IdentifierSchema,
          analysisVersion: z.string().min(1).max(40),
        })
        .strict(),
    ]),
    renderingProfile: z.literal("sci_word_v1"),
    contentProfile: z.literal("sci_review_v1"),
    typography: z
      .object({
        titleStyle: IdentifierSchema,
        heading1Style: IdentifierSchema,
        heading2Style: IdentifierSchema,
        heading3Style: IdentifierSchema,
        bodyStyle: IdentifierSchema,
        captionStyle: IdentifierSchema,
        referenceStyle: IdentifierSchema,
      })
      .strict(),
    layout: z
      .object({
        pageSize: z.literal("A4"),
        orientation: z.literal("portrait"),
        columns: z.literal(1),
      })
      .strict(),
    rules: z
      .object({
        headingDepth: z.literal(3),
        figureCaptionPosition: z.literal("below"),
        tableCaptionPosition: z.literal("above"),
      })
      .strict(),
    citationPolicy: CitationPlacementPolicySchema.default(
      LEGACY_CITATION_POLICY,
    ),
  })
  .strict();

export type ResolvedTemplateSnapshot = z.infer<
  typeof ResolvedTemplateSnapshotSchema
>;

export const DocumentRequestSchema = z
  .object({
    requestId: z.uuid(),
    schemaVersion: z.literal(1),
    action: z.enum(["generate", "export", "transform"]),
    source: z
      .object({
        kind: z.enum([
          "prompt",
          "previous_message",
          "attachments",
          "existing_document",
        ]),
        sourceIds: z.array(IdentifierSchema).max(100),
      })
      .strict(),
    outputFormat: z.literal("docx"),
    language: z.enum(["zh", "en"]),
    templateIntent: z.literal("sci_review"),
    userRequirements: z
      .object({
        topic: z.string().trim().min(1).max(500).optional(),
        targetLength: z.number().int().min(100).max(100_000).optional(),
        visualIntent: z
          .enum(["auto", "required", "forbidden"])
          .default("auto"),
        citationRequirement: z
          .enum(["required", "optional", "forbidden"])
          .default("optional"),
        referencePolicy: z
          .enum([
            "user_sources_only",
            "user_sources_plus_web",
            "web_search_only",
          ])
          .default("user_sources_plus_web"),
        referenceSearchQuery: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional(),
        specialInstructions: z
          .array(z.string().trim().min(1).max(500))
          .max(20)
          .optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.source.kind !== "prompt" &&
      request.source.sourceIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["source", "sourceIds"],
        message: `${request.source.kind} requires at least one source ID.`,
      });
    }
    if (
      request.action === "generate" &&
      request.source.kind === "prompt" &&
      !request.userRequirements.topic
    ) {
      context.addIssue({
        code: "custom",
        path: ["userRequirements", "topic"],
        message: "Prompt-based generation requires a topic.",
      });
    }
  });

export type DocumentRequest = z.infer<typeof DocumentRequestSchema>;

export const DocumentPlanSchema = z
  .object({
    requestId: z.uuid(),
    schemaVersion: z.literal(1),
    templateSnapshot: ResolvedTemplateSnapshotSchema,
    components: z
      .array(
        z
          .object({
            componentKey: IdentifierSchema,
            type: z.enum([
              "title",
              "abstract",
              "keywords",
              "section",
              "conclusion",
              "reference_list",
            ]),
            purpose: z.string().trim().min(1).max(1000),
            owns: z.array(z.string().trim().min(1).max(240)).max(5).default([]),
            excludes: z.array(z.string().trim().min(1).max(240)).max(5).default([]),
            heading: z.string().trim().min(1).max(500).optional(),
            question: z.string().trim().min(1).max(500).optional(),
            contributionToThesis: z
              .string()
              .trim()
              .min(1)
              .max(1_000)
              .optional(),
            comparisonDimensions: z
              .array(z.string().trim().min(1).max(300))
              .max(12)
              .default([]),
            applicableConditions: z
              .array(z.string().trim().min(1).max(500))
              .max(12)
              .default([]),
            failureModes: z
              .array(z.string().trim().min(1).max(500))
              .max(12)
              .default([]),
            targetLength: z.number().int().min(1).max(100_000).optional(),
            requiredEvidenceIds: z.array(IdentifierSchema).max(500).optional(),
            dependsOnComponentKeys: z.array(IdentifierSchema).max(100).default([]),
          })
          .strict(),
      )
      .min(1)
      .superRefine((components, context) => {
        const keys = new Set<string>();
        for (const [index, component] of components.entries()) {
          if (keys.has(component.componentKey)) {
            context.addIssue({
              code: "custom",
              path: [index, "componentKey"],
              message: "Component keys must be unique.",
            });
          }
          keys.add(component.componentKey);
          if (
            (component.type === "section" ||
              component.type === "conclusion") &&
            !component.heading
          ) {
            context.addIssue({
              code: "custom",
              path: [index, "heading"],
              message: `${component.type} components require a planned heading.`,
            });
          }
          if (
            component.type !== "section" &&
            component.type !== "conclusion" &&
            component.heading
          ) {
            context.addIssue({
              code: "custom",
              path: [index, "heading"],
              message: `${component.type} components cannot define a heading.`,
            });
          }
        }
        for (const [index, component] of components.entries()) {
          const dependencies = new Set(component.dependsOnComponentKeys);
          if (dependencies.size !== component.dependsOnComponentKeys.length) {
            context.addIssue({
              code: "custom",
              path: [index, "dependsOnComponentKeys"],
              message: "Component dependencies must be unique.",
            });
          }
          for (const dependency of dependencies) {
            if (!keys.has(dependency) || dependency === component.componentKey) {
              context.addIssue({
                code: "custom",
                path: [index, "dependsOnComponentKeys"],
                message: `Invalid component dependency "${dependency}".`,
              });
            }
          }
        }
      }),
    figureSlots: z
      .array(
        z
          .object({
            slotId: IdentifierSchema,
            componentKey: IdentifierSchema,
            figureType: z.enum([
              "mechanism_diagram",
              "process_flow",
              "conceptual_framework",
              "comparison_diagram",
              "data_plot",
            ]),
            purpose: z.string().trim().min(1).max(1_000),
            questionAnswered: z
              .string()
              .trim()
              .min(1)
              .max(500)
              .default("Explain the planned scientific relationship."),
            evidenceMode: z.enum(["verified", "conceptual"]).default("conceptual"),
            claimsRepresented: z
              .array(z.string().trim().min(1).max(500))
              .min(1)
              .max(12)
              .default(["Conceptual relationship described by the figure."]),
            requiredEvidenceIds: z
              .array(IdentifierSchema)
              .max(500)
              .default([]),
          })
          .strict(),
      )
      .max(4)
      .default([]),
    reviewThesis: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .default("Synthesize the requested topic through a coherent review argument."),
    scopeBoundary: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .default("Stay within the scientific scope defined by the user request."),
    reviewQuestions: z
      .array(z.string().trim().min(1).max(500))
      .min(1)
      .max(12)
      .default(["What conclusions are supported within the requested scope?"]),
    figurePlanningCompleted: z.boolean().default(false),
    evidenceRequirements: z.array(
      z
        .object({
          claimType: IdentifierSchema,
          required: z.boolean(),
          allowedSourceIds: z.array(IdentifierSchema).max(500),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((plan, context) => {
    const componentByKey = new Map(
      plan.components.map((component) => [component.componentKey, component]),
    );
    const slotIds = new Set<string>();
    plan.figureSlots.forEach((slot, index) => {
      if (slotIds.has(slot.slotId)) {
        context.addIssue({
          code: "custom",
          path: ["figureSlots", index, "slotId"],
          message: "Figure slot IDs must be unique.",
        });
      }
      slotIds.add(slot.slotId);
      const component = componentByKey.get(slot.componentKey);
      if (!component || component.type !== "section") {
        context.addIssue({
          code: "custom",
          path: ["figureSlots", index, "componentKey"],
          message: "Figure slots must reference a planned body section.",
        });
      }
      slot.requiredEvidenceIds.forEach((evidenceId) => {
        const requirement = plan.evidenceRequirements.find((candidate) =>
          candidate.allowedSourceIds.includes(evidenceId),
        );
        if (!requirement) {
          context.addIssue({
            code: "custom",
            path: ["figureSlots", index, "requiredEvidenceIds"],
            message: `Figure slot references unavailable evidence "${evidenceId}".`,
          });
        }
      });
      if (
        slot.evidenceMode === "verified" &&
        slot.requiredEvidenceIds.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["figureSlots", index, "requiredEvidenceIds"],
          message: "Verified figures require at least one evidence ID.",
        });
      }
      if (
        slot.figureType === "data_plot" &&
        slot.evidenceMode !== "verified"
      ) {
        context.addIssue({
          code: "custom",
          path: ["figureSlots", index, "evidenceMode"],
          message: "Data plots must use verified evidence mode.",
        });
      }
    });
  });

export type DocumentPlan = z.infer<typeof DocumentPlanSchema>;

export const VerifiedReferenceSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().trim().min(1).max(1000),
    authors: z.array(z.string().trim().min(1).max(300)).min(1).max(100),
    year: z.number().int().min(1000).max(3000).optional(),
    venue: z.string().trim().min(1).max(500).optional(),
    doi: z.string().trim().min(1).max(300).optional(),
    url: z.url().optional(),
    verifiedBy: z.enum(["user_material", "literature_service"]),
    sourceId: IdentifierSchema,
  })
  .strict();

export type VerifiedReference = z.infer<typeof VerifiedReferenceSchema>;

export const MatureCitationSegmentSchema = z
  .object({
    segmentId: IdentifierSchema,
    order: z.number().int().min(0).max(10_000),
    text: z.string().trim().min(1),
    citationIds: z.array(IdentifierSchema).max(500),
  })
  .strict();

export const ApprovedDocumentBlockSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: IdentifierSchema,
      type: z.literal("heading"),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      text: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      id: IdentifierSchema,
      type: z.literal("paragraph"),
      role: z.enum(["abstract", "body", "conclusion"]),
      text: z.string().trim().min(1),
      citationIds: z.array(IdentifierSchema),
      citationGranularity: z
        .enum(["paragraph_legacy", "segment"])
        .default("paragraph_legacy"),
      segments: z.array(MatureCitationSegmentSchema).max(2_000).default([]),
      figureAssetIds: z.array(IdentifierSchema).default([]),
    })
    .strict()
    .superRefine((paragraph, context) => {
      if (paragraph.citationGranularity === "paragraph_legacy") {
        if (paragraph.segments.length > 0) {
          context.addIssue({
            code: "custom",
            path: ["segments"],
            message: "Legacy paragraphs cannot contain citation segments.",
          });
        }
        return;
      }
      if (paragraph.segments.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["segments"],
          message: "Segment-level paragraphs require at least one segment.",
        });
        return;
      }
      const orders = paragraph.segments.map((segment) => segment.order);
      if (orders.some((order, index) => order !== index)) {
        context.addIssue({
          code: "custom",
          path: ["segments"],
          message: "Citation segment order must be continuous and start at zero.",
        });
      }
      const projectedText = joinCitationSegmentTexts(paragraph.segments);
      if (projectedText !== paragraph.text) {
        context.addIssue({
          code: "custom",
          path: ["text"],
          message: "Paragraph text must equal the ordered segment projection.",
        });
      }
      const projectedCitationIds = [
        ...new Set(paragraph.segments.flatMap((segment) => segment.citationIds)),
      ];
      if (
        projectedCitationIds.length !== paragraph.citationIds.length ||
        projectedCitationIds.some(
          (citationId, index) => citationId !== paragraph.citationIds[index],
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["citationIds"],
          message:
            "Paragraph citation IDs must equal the ordered segment projection.",
        });
      }
    }),
  z
    .object({
      id: IdentifierSchema,
      type: z.literal("keywords"),
      values: z.array(z.string().trim().min(1).max(100)).min(3).max(8),
    })
    .strict(),
  z
    .object({
      id: IdentifierSchema,
      type: z.literal("table"),
      caption: z.string().trim().min(1),
      columns: z.array(z.string().trim().min(1)).min(1),
      rows: z.array(z.array(z.string())).min(1),
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
    }),
  z
    .object({
      id: IdentifierSchema,
      type: z.literal("figure"),
      caption: z.string().trim().min(1),
      assetId: IdentifierSchema,
    })
    .strict(),
]);

export type ApprovedDocumentBlock = z.infer<
  typeof ApprovedDocumentBlockSchema
>;

export const FinalDocumentSpecSchema = z
  .object({
    requestId: z.uuid(),
    schemaVersion: z.literal(1),
    templateSnapshot: ResolvedTemplateSnapshotSchema,
    metadata: z
      .object({
        title: z.string().trim().min(1).max(500),
        language: z.enum(["zh", "en"]),
        documentType: z.literal("sci_review"),
        referencesStatus: z.enum(["verified", "not_available"]),
      })
      .strict(),
    blocks: z.array(ApprovedDocumentBlockSchema).min(1),
    references: z.array(VerifiedReferenceSchema),
    assets: z.array(FigureAssetSchema).max(500).default([]),
  })
  .strict()
  .superRefine((spec, context) => {
    const manualCrossReferencePattern =
      /(?:\bfig(?:ure)?\.?\s*\d+\b|\btable\s*\d+\b|图\s*\d+|表\s*\d+|\[\s*(?:fig(?:ure)?\.?|table|图|表)\s*\d+\s*\])/i;
    const blockIds = new Set<string>();
    const referenceIds = new Set(spec.references.map((reference) => reference.id));
    const assetIds = new Set<string>();
    for (const [index, asset] of spec.assets.entries()) {
      if (assetIds.has(asset.id)) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "id"],
          message: "Figure asset IDs must be unique.",
        });
      }
      assetIds.add(asset.id);
    }
    const usedAssetIds = new Set<string>();
    for (const [index, block] of spec.blocks.entries()) {
      if (blockIds.has(block.id)) {
        context.addIssue({
          code: "custom",
          path: ["blocks", index, "id"],
          message: "Block IDs must be unique.",
        });
      }
      blockIds.add(block.id);
      if (block.type === "paragraph") {
        const visibleTexts = [
          block.text,
          ...block.segments.map((segment) => segment.text),
        ];
        const manualNumericCitationPattern =
          /\[\s*\d+(?:\s*[,\-\u2013]\s*\d+)*\s*\]/;
        const internalCitationMarkerPattern =
          /\[(?:citation|evidence|reference)\s*:[^\]]+\]/i;
        if (
          visibleTexts.some(
            (text) =>
              manualNumericCitationPattern.test(text) ||
              internalCitationMarkerPattern.test(text),
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["blocks", index, "text"],
            message:
              "Visible paragraph text cannot contain manual citations or internal citation markers.",
          });
        }
        for (const referenceId of referenceIds) {
          if (visibleTexts.some((text) => text.includes(referenceId))) {
            context.addIssue({
              code: "custom",
              path: ["blocks", index, "text"],
              message: `Internal reference ID ${referenceId} leaked into visible text.`,
            });
          }
        }
        if (
          block.role === "abstract" &&
          !spec.templateSnapshot.citationPolicy.includeAbstract &&
          block.citationIds.length > 0
        ) {
          context.addIssue({
            code: "custom",
            path: ["blocks", index, "citationIds"],
            message: "This template forbids citations in the abstract.",
          });
        }
        if (manualCrossReferencePattern.test(block.text)) {
          context.addIssue({
            code: "custom",
            path: ["blocks", index, "text"],
            message:
              "Final paragraph text cannot contain handwritten figure or table numbers.",
          });
        }
        for (const citationId of block.citationIds) {
          if (!referenceIds.has(citationId)) {
            context.addIssue({
              code: "custom",
              path: ["blocks", index, "citationIds"],
              message: `Citation ${citationId} has no verified reference.`,
            });
          }
        }
        for (const figureAssetId of block.figureAssetIds) {
          if (!assetIds.has(figureAssetId)) {
            context.addIssue({
              code: "custom",
              path: ["blocks", index, "figureAssetIds"],
              message: `Figure reference ${figureAssetId} has no mature asset.`,
            });
          }
        }
      }
      if (block.type === "figure") {
        if (!assetIds.has(block.assetId)) {
          context.addIssue({
            code: "custom",
            path: ["blocks", index, "assetId"],
            message: `Figure asset ${block.assetId} is missing.`,
          });
        }
        usedAssetIds.add(block.assetId);
      }
    }
    for (const [index, asset] of spec.assets.entries()) {
      if (!usedAssetIds.has(asset.id)) {
        context.addIssue({
          code: "custom",
          path: ["assets", index, "id"],
          message: `Figure asset ${asset.id} is not used by a figure block.`,
        });
      }
    }
    const figureBlockAssetIds = new Set(
      spec.blocks
        .filter((block) => block.type === "figure")
        .map((block) => block.assetId),
    );
    for (const [index, block] of spec.blocks.entries()) {
      if (block.type !== "paragraph") continue;
      for (const figureAssetId of block.figureAssetIds) {
        if (!figureBlockAssetIds.has(figureAssetId)) {
          context.addIssue({
            code: "custom",
            path: ["blocks", index, "figureAssetIds"],
            message: `Figure reference ${figureAssetId} has no figure block.`,
          });
        }
      }
    }
    if (
      spec.metadata.referencesStatus === "verified" &&
      spec.references.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["references"],
        message: "Verified reference status requires at least one reference.",
      });
    }
    if (
      spec.metadata.referencesStatus === "not_available" &&
      spec.references.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["references"],
        message: "References must be empty when references are unavailable.",
      });
    }
  });

export type FinalDocumentSpec = z.infer<typeof FinalDocumentSpecSchema>;
