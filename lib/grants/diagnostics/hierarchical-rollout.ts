import { z } from "zod";

export const GrantHierarchicalDiagnosticRolloutPolicySchema = z.object({
  mode: z.enum(["off", "canary", "on"]),
  databaseSchemaVersion: z.enum(["not_ready", "047"]),
  canaryOwnerIds: z.array(z.string().uuid()).max(100),
}).strict();

export type GrantHierarchicalDiagnosticRolloutDecision = {
  selected: boolean;
  reason: "disabled" | "database_not_ready" | "canary_not_selected" | "canary_selected" | "enabled";
};

/** Fail-closed cohort selection. A code flag alone cannot activate the paid
 * two-stage path before its additive database projection is declared ready. */
export function selectGrantHierarchicalDiagnosticRollout(input: {
  ownerId: string;
  policy: z.infer<typeof GrantHierarchicalDiagnosticRolloutPolicySchema>;
}): GrantHierarchicalDiagnosticRolloutDecision {
  const policy = GrantHierarchicalDiagnosticRolloutPolicySchema.parse(input.policy);
  if (policy.mode === "off") return { selected: false, reason: "disabled" };
  if (policy.databaseSchemaVersion !== "047") return { selected: false, reason: "database_not_ready" };
  if (policy.mode === "on") return { selected: true, reason: "enabled" };
  return policy.canaryOwnerIds.includes(z.string().uuid().parse(input.ownerId))
    ? { selected: true, reason: "canary_selected" }
    : { selected: false, reason: "canary_not_selected" };
}
