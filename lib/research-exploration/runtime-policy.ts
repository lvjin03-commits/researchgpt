import { z } from "zod";

export const ResearchExplorationRuntimeModeSchema = z.enum([
  "off",
  "shadow",
  "advisory",
  "required",
]);

export const ResearchExplorationRuntimeDecisionSchema = z
  .object({
    policyVersion: z.literal("research-exploration-runtime-v1"),
    mode: ResearchExplorationRuntimeModeSchema,
    enabled: z.boolean(),
    reason: z.enum(["enabled", "globally_disabled", "mode_off"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.enabled !== (value.reason === "enabled")) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "Runtime enabled state must match its decision reason.",
      });
    }
  });

export type ResearchExplorationRuntimeMode = z.infer<
  typeof ResearchExplorationRuntimeModeSchema
>;
export type ResearchExplorationRuntimeDecision = z.infer<
  typeof ResearchExplorationRuntimeDecisionSchema
>;

export function resolveResearchExplorationRuntime(input: {
  globallyApproved: boolean;
  mode: ResearchExplorationRuntimeMode;
}): ResearchExplorationRuntimeDecision {
  const mode = ResearchExplorationRuntimeModeSchema.parse(input.mode);
  const reason = !input.globallyApproved
    ? "globally_disabled"
    : mode === "off"
      ? "mode_off"
      : "enabled";
  return ResearchExplorationRuntimeDecisionSchema.parse({
    policyVersion: "research-exploration-runtime-v1",
    mode,
    enabled: reason === "enabled",
    reason,
  });
}

/** The only TypeScript boundary allowed to read the global STORM switch. */
export function resolveResearchExplorationRuntimeFromEnvironment(input: {
  mode?: ResearchExplorationRuntimeMode;
  environment?: Readonly<Record<string, string | undefined>>;
}): ResearchExplorationRuntimeDecision {
  const environment = input.environment ?? process.env;
  return resolveResearchExplorationRuntime({
    globallyApproved:
      environment.STORM_RUNTIME_APPROVED?.trim().toLowerCase() === "true",
    mode: input.mode ?? ResearchExplorationRuntimeModeSchema.parse(
      environment.STORM_RUNTIME_MODE?.trim().toLowerCase() || "off",
    ),
  });
}
