import { z } from "zod";
import { ResearchExplorationAdvisoryHintsSchema } from "../advisory/contracts.ts";

export const ResearchExplorationRequiredResolutionSchema = z
  .object({
    mode: z.literal("required"),
    outcome: z.enum(["available", "waiting", "blocked"]),
    executionId: z.string().uuid(),
    executionStatus: z.enum([
      "queued",
      "running",
      "partial",
      "complete",
      "failed",
      "unknown_outcome",
      "expired",
      "cancelled",
    ]),
    hints: ResearchExplorationAdvisoryHintsSchema.optional(),
    nextCheckAt: z.iso.datetime({ offset: true }).optional(),
    failureCode: z
      .enum([
        "exploration_failed",
        "exploration_unknown_outcome",
        "exploration_expired",
        "exploration_cancelled",
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
        message: "Available required exploration needs planning hints.",
      });
    }
    if (
      value.outcome === "available" &&
      !["partial", "complete"].includes(value.executionStatus)
    ) {
      context.addIssue({
        code: "custom",
        path: ["executionStatus"],
        message: "Available required exploration must be partial or complete.",
      });
    }
    if (value.outcome === "waiting" && !["queued", "running"].includes(value.executionStatus)) {
      context.addIssue({
        code: "custom",
        path: ["executionStatus"],
        message: "Only queued or running exploration can remain waiting.",
      });
    }
    if (value.outcome === "blocked" && !value.failureCode) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Blocked required exploration needs a failure code.",
      });
    }
    if (value.outcome !== "available" && value.hints) {
      context.addIssue({
        code: "custom",
        path: ["hints"],
        message: "Only available required exploration may expose planning hints.",
      });
    }
    if (value.outcome !== "blocked" && value.failureCode) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Only blocked required exploration may expose a failure code.",
      });
    }
  });

export type ResearchExplorationRequiredResolution = z.infer<
  typeof ResearchExplorationRequiredResolutionSchema
>;

export class ResearchExplorationRequiredPlanningError extends Error {
  readonly resolution: ResearchExplorationRequiredResolution;

  constructor(resolution: ResearchExplorationRequiredResolution) {
    const code = resolution.failureCode ?? "exploration_pending";
    super(`Required research exploration cannot release planning: ${code}.`);
    this.name = "ResearchExplorationRequiredPlanningError";
    this.resolution = resolution;
  }
}
