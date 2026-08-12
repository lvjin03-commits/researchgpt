import { z } from "zod";

export const GrantSemanticReviewV6RolloutPolicySchema = z.object({
  mode: z.enum(["off", "canary", "on"]),
  databaseSchemaVersion: z.enum(["not_ready", "051"]),
  canaryOwnerIds: z.array(z.string().uuid()).max(100),
}).strict();

export type GrantSemanticReviewV6RolloutDecision = {
  selected: boolean;
  reason: "disabled" | "database_not_ready" | "canary_not_selected" | "canary_selected" | "enabled";
};

/** Fail-closed paid-runtime selection. Migration 051 must be explicitly
 * declared ready; the code flag alone cannot activate V6. */
export function selectGrantSemanticReviewV6Rollout(input: {
  ownerId: string;
  policy: z.infer<typeof GrantSemanticReviewV6RolloutPolicySchema>;
}): GrantSemanticReviewV6RolloutDecision {
  const policy = GrantSemanticReviewV6RolloutPolicySchema.parse(input.policy);
  if (policy.mode === "off") return { selected: false, reason: "disabled" };
  if (policy.databaseSchemaVersion !== "051") return { selected: false, reason: "database_not_ready" };
  if (policy.mode === "on") return { selected: true, reason: "enabled" };
  return policy.canaryOwnerIds.includes(z.string().uuid().parse(input.ownerId))
    ? { selected: true, reason: "canary_selected" }
    : { selected: false, reason: "canary_not_selected" };
}
