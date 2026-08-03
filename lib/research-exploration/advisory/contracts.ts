import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1).max(160);
const TextSchema = z.string().trim().min(1).max(4_000);

export const ResearchExplorationAdvisoryHintsSchema = z
  .object({
    schemaVersion: z.literal(1),
    explorationId: IdentifierSchema,
    proposalStatus: z.enum(["complete", "partial"]),
    suggestedPerspectives: z.array(TextSchema).max(12),
    suggestedQuestions: z.array(TextSchema).max(100),
    suggestedSections: z
      .array(
        z
          .object({
            heading: TextSchema,
            purpose: z.string().trim().min(1).max(8_000),
          })
          .strict(),
      )
      .max(40),
    unresolvedQuestions: z.array(TextSchema).max(100),
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(100),
  })
  .strict();

export const ResearchExplorationAdvisoryResolutionSchema = z
  .object({
    mode: z.literal("advisory"),
    outcome: z.enum(["available", "fallback"]),
    hints: ResearchExplorationAdvisoryHintsSchema.optional(),
    warningCode: z
      .enum([
        "runtime_disabled",
        "exploration_pending",
        "exploration_failed",
        "exploration_result_unavailable",
      ])
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome === "available" && !value.hints) {
      context.addIssue({
        code: "custom",
        path: ["hints"],
        message: "Available advisory resolution requires hints.",
      });
    }
    if (value.outcome === "fallback" && !value.warningCode) {
      context.addIssue({
        code: "custom",
        path: ["warningCode"],
        message: "Fallback advisory resolution requires a warning code.",
      });
    }
  });

export type ResearchExplorationAdvisoryHints = z.infer<
  typeof ResearchExplorationAdvisoryHintsSchema
>;
export type ResearchExplorationAdvisoryResolution = z.infer<
  typeof ResearchExplorationAdvisoryResolutionSchema
>;
