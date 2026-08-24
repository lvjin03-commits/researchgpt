import { z } from "zod";
import { AI_OPERATIONS } from "../../ai/operation-registry.ts";

export const GRANT_EDIT_TURN_BILLING_CONTRACT_VERSION = "grant-edit-turn-billing-v1" as const;

export const GrantEditTurnBillingBundleSchema = z.object({
  contractVersion: z.literal(GRANT_EDIT_TURN_BILLING_CONTRACT_VERSION),
  bundleKind: z.literal("single_edit_turn"),
  operation: z.literal(AI_OPERATIONS.grant.editSessionTurn),
  billingOperationId: z.string().uuid(),
  editSessionId: z.string().uuid(),
  turnId: z.string().uuid(),
  pricePolicyVersion: z.string().trim().min(1),
}).strict().superRefine((bundle, context) => {
  if (bundle.billingOperationId !== bundle.turnId) {
    context.addIssue({
      code: "custom",
      path: ["billingOperationId"],
      message: "An Edit Session turn uses its turn ID as the at-most-once billing operation ID.",
    });
  }
});

export type GrantEditTurnBillingBundle = z.infer<typeof GrantEditTurnBillingBundleSchema>;

export function createGrantEditTurnBillingBundle(input: {
  editSessionId: string;
  turnId: string;
  pricePolicyVersion: string;
}): GrantEditTurnBillingBundle {
  return GrantEditTurnBillingBundleSchema.parse({
    contractVersion: GRANT_EDIT_TURN_BILLING_CONTRACT_VERSION,
    bundleKind: "single_edit_turn",
    operation: AI_OPERATIONS.grant.editSessionTurn,
    billingOperationId: input.turnId,
    editSessionId: input.editSessionId,
    turnId: input.turnId,
    pricePolicyVersion: input.pricePolicyVersion,
  });
}

export const GRANT_EDIT_SESSION_NON_BILLABLE_ACTIONS = Object.freeze([
  "session.create",
  "session.read",
  "candidate.list",
  "candidate.diff.read",
  "candidate.apply",
  "session.discard",
] as const);
