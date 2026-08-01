import { z } from "zod";

const IdentifierSchema = z.string().min(1).max(120);

const FigureTypeSchema = z.enum([
  "mechanism_diagram",
  "process_flow",
  "conceptual_framework",
  "comparison_diagram",
  "data_plot",
]);

export const DocumentThesisDraftSchema = z
  .object({
    reviewThesis: z.string().trim().min(1).max(1_200),
    scopeBoundary: z.string().trim().min(1).max(1_200),
    reviewQuestions: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
    conclusionHeading: z.string().trim().min(1).max(300),
  })
  .strict();

export const DocumentSectionIndexDraftSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(300),
            question: z.string().trim().min(1).max(300),
            purpose: z.string().trim().min(1).max(500),
            owns: z.array(z.string().trim().min(1).max(240)).max(5).default([]),
            excludes: z.array(z.string().trim().min(1).max(240)).max(5).default([]),
            relativeWeight: z.number().positive().max(100),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

export const DocumentFigureIntentsDraftSchema = z
  .object({
    figures: z
      .array(
        z
          .object({
            sectionOrder: z.number().int().min(1).max(12),
            figureType: FigureTypeSchema.exclude(["data_plot"]),
            purpose: z.string().trim().min(1).max(600),
            questionAnswered: z.string().trim().min(1).max(300),
            claimsRepresented: z
              .array(z.string().trim().min(1).max(300))
              .min(1)
              .max(6),
            evidenceRequired: z.boolean(),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export const DocumentSkeletonDraftSchema = z
  .object({
    reviewThesis: z.string().trim().min(1).max(2_000),
    scopeBoundary: z.string().trim().min(1).max(2_000),
    reviewQuestions: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(500),
            question: z.string().trim().min(1).max(500),
            purpose: z.string().trim().min(1).max(650),
            owns: z.array(z.string().trim().min(1).max(240)).max(5).default([]),
            excludes: z.array(z.string().trim().min(1).max(240)).max(5).default([]),
            relativeWeight: z.number().positive().max(100),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    conclusionHeading: z.string().trim().min(1).max(500),
    figures: z
      .array(
        z
          .object({
            sectionIndex: z.number().int().min(0).max(99),
            figureType: FigureTypeSchema,
            purpose: z.string().trim().min(1).max(1_000),
            questionAnswered: z.string().trim().min(1).max(500),
            claimsRepresented: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
            evidenceRequired: z.boolean(),
          })
          .strict(),
      )
      .max(4),
  })
  .strict()
  .superRefine((skeleton, context) => {
    const headings = new Set<string>();
    skeleton.sections.forEach((section, index) => {
      const heading = section.heading.toLocaleLowerCase();
      if (headings.has(heading)) {
        context.addIssue({ code: "custom", path: ["sections", index, "heading"], message: "Section headings must be unique." });
      }
      headings.add(heading);
    });
    skeleton.figures.forEach((figure, index) => {
      if (figure.sectionIndex >= skeleton.sections.length) {
        context.addIssue({ code: "custom", path: ["figures", index, "sectionIndex"], message: "Figure must reference an existing section." });
      }
      if (figure.figureType === "data_plot") {
        context.addIssue({ code: "custom", path: ["figures", index, "figureType"], message: "data_plot requires a verified dataset and is unavailable in skeleton planning." });
      }
    });
  });

export const DocumentSkeletonSchema = DocumentSkeletonDraftSchema.safeExtend({
  schemaVersion: z.literal(1),
  sections: z.array(
    DocumentSkeletonDraftSchema.shape.sections.element.extend({
      sectionId: IdentifierSchema,
      order: z.number().int().nonnegative(),
    }),
  ),
  figures: z.array(
    DocumentSkeletonDraftSchema.shape.figures.element.extend({
      figureIntentId: IdentifierSchema,
    }),
  ),
}).strict();

export const SectionPlanDraftSchema = z
  .object({
    contributionToThesis: z.string().trim().min(1).max(1_000),
    comparisonDimensions: z.array(z.string().trim().min(1).max(300)).max(12),
    applicableConditions: z.array(z.string().trim().min(1).max(500)).max(12),
    failureModes: z.array(z.string().trim().min(1).max(500)).max(12),
    requiredEvidenceIds: z.array(IdentifierSchema).max(500),
  })
  .strict();

export const SectionPlanSchema = SectionPlanDraftSchema.extend({
  schemaVersion: z.literal(1),
  sectionId: IdentifierSchema,
  skeletonVersion: z.literal(1),
}).strict();

export type DocumentSkeleton = z.infer<typeof DocumentSkeletonSchema>;
export type SectionPlan = z.infer<typeof SectionPlanSchema>;

export const SemanticOutlineProposalSchema = z
  .object({
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
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(500),
            question: z
              .string()
              .trim()
              .min(1)
              .max(500)
              .default("What does this section establish?"),
            purpose: z.string().trim().min(1).max(1_000),
            owns: z.array(z.string().trim().min(1).max(240)).max(5).default([]),
            excludes: z.array(z.string().trim().min(1).max(240)).max(5).default([]),
            contributionToThesis: z
              .string()
              .trim()
              .min(1)
              .max(1_000)
              .default("Develop the central review argument."),
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
            relativeWeight: z.number().positive().max(100),
            requiredEvidenceIds: z.array(IdentifierSchema).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    conclusionHeading: z.string().trim().min(1).max(500),
    figures: z
      .array(
        z
          .object({
            sectionIndex: z.number().int().min(0).max(99),
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
            claimsRepresented: z
              .array(z.string().trim().min(1).max(500))
              .min(1)
              .max(12)
              .default(["Conceptual relationship described by the figure."]),
            requiredEvidenceIds: z.array(IdentifierSchema).max(500).default([]),
          })
          .strict(),
      )
      .max(4)
      .default([]),
  })
  .strict()
  .superRefine((proposal, context) => {
    const normalizedHeadings = new Set<string>();
    proposal.sections.forEach((section, index) => {
      const normalized = section.heading.trim().toLocaleLowerCase();
      if (normalizedHeadings.has(normalized)) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "heading"],
          message: "Section headings must be unique.",
        });
      }
      normalizedHeadings.add(normalized);
    });
    proposal.figures.forEach((figure, index) => {
      if (figure.sectionIndex >= proposal.sections.length) {
        context.addIssue({
          code: "custom",
          path: ["figures", index, "sectionIndex"],
          message: "Figure sectionIndex must reference a planned body section.",
        });
      }
    });
  });

export type SemanticOutlineProposal = z.infer<
  typeof SemanticOutlineProposalSchema
>;
