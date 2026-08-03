import { createHash } from "node:crypto";
import { z } from "zod";

export const ResearchExplorationShadowPolicySchema = z
  .object({
    policyVersion: z.literal("research-exploration-shadow-v1"),
    enabled: z.boolean(),
    environment: z.enum(["development", "test", "production"]),
    sampleRateBasisPoints: z.number().int().min(0).max(10_000),
    maximumConcurrentExecutions: z.number().int().min(1).max(100),
  })
  .strict();

export type ResearchExplorationShadowPolicy = z.infer<
  typeof ResearchExplorationShadowPolicySchema
>;

export type ResearchExplorationShadowSelection = Readonly<{
  selected: boolean;
  reason:
    | "selected"
    | "runtime_disabled"
    | "disabled"
    | "production_forbidden"
    | "sampled_out"
    | "capacity_exhausted";
  bucket: number;
}>;

function sampleBucket(policyVersion: string, sampleSubjectId: string): number {
  const digest = createHash("sha256")
    .update(`${policyVersion}:${sampleSubjectId}`)
    .digest();
  return digest.readUInt32BE(0) % 10_000;
}

export function selectResearchExplorationShadow(input: {
  policy: ResearchExplorationShadowPolicy;
  sampleSubjectId: string;
  activeExecutionCount: number;
}): ResearchExplorationShadowSelection {
  const policy = ResearchExplorationShadowPolicySchema.parse(input.policy);
  const bucket = sampleBucket(policy.policyVersion, input.sampleSubjectId);
  if (!policy.enabled) return { selected: false, reason: "disabled", bucket };
  if (policy.environment === "production") {
    return { selected: false, reason: "production_forbidden", bucket };
  }
  if (input.activeExecutionCount >= policy.maximumConcurrentExecutions) {
    return { selected: false, reason: "capacity_exhausted", bucket };
  }
  if (bucket >= policy.sampleRateBasisPoints) {
    return { selected: false, reason: "sampled_out", bucket };
  }
  return { selected: true, reason: "selected", bucket };
}
