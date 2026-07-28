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
  });

export type SemanticOutlineProposal = z.infer<
  typeof SemanticOutlineProposalSchema
>;
