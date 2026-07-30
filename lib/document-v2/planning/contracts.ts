import { z } from "zod";

const IdentifierSchema = z.string().min(1).max(120);

export const SemanticOutlineProposalSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(500),
            purpose: z.string().trim().min(1).max(1_000),
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
