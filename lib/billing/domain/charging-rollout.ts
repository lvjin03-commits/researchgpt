import { z } from "zod";
import { REGISTERED_AI_OPERATIONS, type RegisteredAiOperation } from "../../ai/operation-registry.ts";

const DisabledPolicySchema = z.object({ mode: z.literal("disabled") }).strict();
const MeterOnlyPolicySchema = z.object({ mode: z.literal("meter_only") }).strict();
const CanaryPolicySchema = z.object({
  mode: z.literal("canary"),
  ownerIds: z.array(z.string().uuid()).min(1),
  operations: z.array(z.enum(REGISTERED_AI_OPERATIONS)).min(1),
  maximumDailyChargePointsPerOwner: z.number().int().positive().safe(),
  expiresAt: z.string().datetime({ offset: true }),
  policyVersion: z.string().trim().min(1).max(100),
}).strict();

export const ChargingRolloutPolicySchema = z.discriminatedUnion("mode", [DisabledPolicySchema, MeterOnlyPolicySchema, CanaryPolicySchema]);
export type ChargingRolloutPolicy = z.infer<typeof ChargingRolloutPolicySchema>;

export function resolveChargingRolloutPolicy(raw = process.env.AI_POINT_CHARGING_POLICY_JSON): ChargingRolloutPolicy {
  if (!raw?.trim()) return { mode: "disabled" };
  return ChargingRolloutPolicySchema.parse(JSON.parse(raw));
}

export function isCanarySubject(input: { policy: ChargingRolloutPolicy; ownerId: string; operation: RegisteredAiOperation; now: string }) {
  if (input.policy.mode !== "canary") return false;
  if (Date.parse(input.now) >= Date.parse(input.policy.expiresAt)) return false;
  return input.policy.ownerIds.includes(input.ownerId) && input.policy.operations.includes(input.operation);
}
