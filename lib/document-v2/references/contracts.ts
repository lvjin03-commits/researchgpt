import { z } from "zod";
import { VerifiedReferenceSchema } from "../contracts";

const IdentifierSchema = z.string().trim().min(1).max(120);

export const ReferenceExecutionProfileSchema = z
  .object({
    enabled: z.boolean(),
    requirement: z.enum(["required", "optional", "forbidden"]),
    policy: z.enum([
      "user_sources_only",
      "user_sources_plus_web",
      "web_search_only",
    ]),
    failurePolicy: z.enum([
      "deliver_without_references",
      "deliver_partial_references",
      "pause_before_delivery",
    ]),
    pipelineVersion: z.literal("reference-v1"),
  })
  .strict();

export type ReferenceExecutionProfile = z.infer<
  typeof ReferenceExecutionProfileSchema
>;

export const ReferenceWarningSchema = z
  .object({
    code: IdentifierSchema,
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export type ReferenceWarning = z.infer<typeof ReferenceWarningSchema>;

export const ReferenceEvidenceSchema = z
  .object({
    evidenceId: IdentifierSchema,
    reference: VerifiedReferenceSchema,
    excerpt: z.string().trim().min(1).max(20_000),
    locator: z
      .object({
        page: z.number().int().positive().optional(),
        section: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.evidenceId !== item.reference.id) {
      context.addIssue({
        code: "custom",
        path: ["evidenceId"],
        message: "Reference evidence ID must equal its reference ID.",
      });
    }
  });

export const ReferencePipelineResultSchema = z
  .object({
    status: z.enum([
      "disabled",
      "complete",
      "partial",
      "unavailable",
      "timed_out",
      "failed",
    ]),
    outcome: z.enum(["complete", "partial", "unavailable"]),
    verifiedReferences: z.array(VerifiedReferenceSchema).max(500),
    evidence: z.array(ReferenceEvidenceSchema).max(2_000),
    candidateCount: z.number().int().nonnegative(),
    relevanceRejectedCount: z.number().int().nonnegative().default(0),
    providerCalls: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    manifestRevision: z.number().int().positive(),
    warnings: z.array(ReferenceWarningSchema).max(50),
  })
  .strict();

export type ReferencePipelineResult = z.infer<
  typeof ReferencePipelineResultSchema
>;

export function createReferenceExecutionProfile(input: {
  requirement: "required" | "optional" | "forbidden";
  policy:
    | "user_sources_only"
    | "user_sources_plus_web"
    | "web_search_only";
  hasUserReferences: boolean;
  runtimeEnabled?: boolean;
}): ReferenceExecutionProfile {
  const enabled =
    input.runtimeEnabled !== false &&
    input.requirement !== "forbidden" &&
    (input.requirement === "required" || input.hasUserReferences);
  return ReferenceExecutionProfileSchema.parse({
    enabled,
    requirement: input.requirement,
    policy: input.policy,
    failurePolicy:
      input.requirement === "required"
        ? "deliver_partial_references"
        : "deliver_without_references",
    pipelineVersion: "reference-v1",
  });
}
