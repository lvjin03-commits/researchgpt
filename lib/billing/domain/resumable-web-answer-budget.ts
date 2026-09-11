import { z } from "zod";

const PointsSchema = z.number().int().nonnegative().safe();
const PositivePointsSchema = z.number().int().positive().safe();

export const ResumableWebAnswerBudgetStatusSchema = z.enum([
  "running",
  "awaiting_budget",
  "delivering_existing_results",
  "delivered_complete",
  "delivered_partial",
  "failed_no_delivery",
  "expired",
]);
export type ResumableWebAnswerBudgetStatus = z.infer<typeof ResumableWebAnswerBudgetStatusSchema>;

export const ResumableWebAnswerBudgetEnvelopeSchema = z.enum(["decision", "execution", "delivery"]);
export type ResumableWebAnswerBudgetEnvelope = z.infer<typeof ResumableWebAnswerBudgetEnvelopeSchema>;

export const ResumableWebAnswerBudgetStateSchema = z.object({
  budgetId: z.string().uuid(),
  ownerId: z.string().uuid(),
  documentId: z.string().uuid(),
  turnId: z.string().uuid(),
  policyVersion: z.literal("grant-web-user-budget-v1"),
  version: PointsSchema,
  status: ResumableWebAnswerBudgetStatusSchema,
  authorizedPoints: PositivePointsSchema,
  settledPoints: PointsSchema,
  decisionHardMaximumPoints: PointsSchema,
  deliveryHardMaximumPoints: PositivePointsSchema,
  decisionDisposition: z.enum(["available", "consumed", "waived"]),
  authorizations: z.array(z.object({
    authorizationId: z.string().uuid(),
    authorizedPoints: PositivePointsSchema,
  }).strict()).min(1),
  completedPhaseIds: z.array(z.string().uuid()),
  activePhase: z.object({
    phaseId: z.string().uuid(),
    envelope: ResumableWebAnswerBudgetEnvelopeSchema,
    maximumChargePoints: PositivePointsSchema,
    pricePolicyVersion: z.string().min(1),
  }).strict().nullable(),
  requiredAdditionalPoints: PositivePointsSchema.nullable(),
}).strict().superRefine((state, context) => {
  if (new Set(state.authorizations.map((entry) => entry.authorizationId)).size !== state.authorizations.length) {
    context.addIssue({ code: "custom", path: ["authorizations"], message: "Budget authorization IDs must be unique." });
  }
  if (state.authorizations.reduce((sum, entry) => sum + entry.authorizedPoints, 0) !== state.authorizedPoints) {
    context.addIssue({ code: "custom", path: ["authorizedPoints"], message: "Authorized points must equal immutable authorization records." });
  }
  if (new Set(state.completedPhaseIds).size !== state.completedPhaseIds.length) {
    context.addIssue({ code: "custom", path: ["completedPhaseIds"], message: "Completed phase IDs must be unique." });
  }
  if (state.settledPoints > state.authorizedPoints) {
    context.addIssue({ code: "custom", path: ["settledPoints"], message: "Settled points exceed authorized points." });
  }
  if (state.status === "awaiting_budget" && state.requiredAdditionalPoints == null) {
    context.addIssue({ code: "custom", path: ["requiredAdditionalPoints"], message: "A paused budget requires an additional-point amount." });
  }
  if (state.status !== "awaiting_budget" && state.requiredAdditionalPoints != null) {
    context.addIssue({ code: "custom", path: ["requiredAdditionalPoints"], message: "Only a paused budget may request additional points." });
  }
  if (state.activePhase && state.status !== "running" && state.status !== "delivering_existing_results") {
    context.addIssue({ code: "custom", path: ["activePhase"], message: "A terminal or paused budget cannot have an active phase." });
  }
  if (state.status === "delivering_existing_results" && state.activePhase?.envelope !== "delivery") {
    context.addIssue({ code: "custom", path: ["activePhase"], message: "Delivery state requires an active delivery phase." });
  }
});
export type ResumableWebAnswerBudgetState = z.infer<typeof ResumableWebAnswerBudgetStateSchema>;

export type WebAnswerPhaseAdmission =
  | { decision: "admitted"; state: ResumableWebAnswerBudgetState }
  | { decision: "awaiting_budget"; state: ResumableWebAnswerBudgetState; requiredAdditionalPoints: number };

const terminal = new Set<ResumableWebAnswerBudgetStatus>([
  "delivered_complete", "delivered_partial", "failed_no_delivery", "expired",
]);

export function createResumableWebAnswerBudget(input: {
  budgetId: string;
  ownerId: string;
  documentId: string;
  turnId: string;
  authorizationId: string;
  authorizedPoints: number;
  decisionHardMaximumPoints: number;
  deliveryHardMaximumPoints: number;
}): ResumableWebAnswerBudgetState {
  if (input.authorizedPoints < input.decisionHardMaximumPoints + input.deliveryHardMaximumPoints) {
    throw new Error("Initial authorization cannot protect decision and final delivery.");
  }
  const { authorizationId, ...budget } = input;
  return ResumableWebAnswerBudgetStateSchema.parse({
    ...budget,
    policyVersion: "grant-web-user-budget-v1",
    version: 0,
    settledPoints: 0,
    status: "running",
    decisionDisposition: input.decisionHardMaximumPoints === 0 ? "waived" : "available",
    authorizations: [{ authorizationId, authorizedPoints: input.authorizedPoints }],
    completedPhaseIds: [],
    activePhase: null,
    requiredAdditionalPoints: null,
  });
}

export function admitResumableWebAnswerPhase(input: {
  state: ResumableWebAnswerBudgetState;
  phaseId: string;
  envelope: ResumableWebAnswerBudgetEnvelope;
  maximumChargePoints: number;
  pricePolicyVersion: string;
}): WebAnswerPhaseAdmission {
  const state = ResumableWebAnswerBudgetStateSchema.parse(input.state);
  if (terminal.has(state.status)) throw new Error("A terminal web-answer budget cannot admit another phase.");
  if (state.activePhase) throw new Error("A web-answer budget already has an active phase.");
  if (state.completedPhaseIds.includes(input.phaseId)) throw new Error("A completed web-answer phase cannot be replayed.");
  const maximumChargePoints = PositivePointsSchema.parse(input.maximumChargePoints);
  if (input.envelope === "decision" && state.decisionDisposition !== "available") {
    throw new Error("The decision envelope is no longer available.");
  }
  if (input.envelope === "delivery" && state.status !== "running" && state.status !== "awaiting_budget") {
    throw new Error("Final delivery cannot start from the current state.");
  }
  if (input.envelope === "delivery" && maximumChargePoints > state.deliveryHardMaximumPoints) {
    throw new Error("Final delivery exceeds its protected hard maximum.");
  }

  const protectedDecision = input.envelope === "decision" || state.decisionDisposition !== "available"
    ? 0 : state.decisionHardMaximumPoints;
  const protectedDelivery = input.envelope === "delivery" ? 0 : state.deliveryHardMaximumPoints;
  const required = state.settledPoints + maximumChargePoints + protectedDecision + protectedDelivery;
  if (required > state.authorizedPoints) {
    if (input.envelope === "delivery") throw new Error("Protected final delivery is not funded by the authorized budget.");
    const requiredAdditionalPoints = required - state.authorizedPoints;
    const paused = ResumableWebAnswerBudgetStateSchema.parse({ ...state,
      version: state.version + 1,
      status: "awaiting_budget", activePhase: null, requiredAdditionalPoints });
    return { decision: "awaiting_budget", state: paused, requiredAdditionalPoints };
  }

  const admitted = ResumableWebAnswerBudgetStateSchema.parse({ ...state,
    version: state.version + 1,
    status: input.envelope === "delivery" ? "delivering_existing_results" : "running",
    activePhase: { phaseId: input.phaseId, envelope: input.envelope, maximumChargePoints,
      pricePolicyVersion: input.pricePolicyVersion },
    requiredAdditionalPoints: null,
  });
  return { decision: "admitted", state: admitted };
}

export function settleResumableWebAnswerPhase(input: {
  state: ResumableWebAnswerBudgetState;
  phaseId: string;
  chargedPoints: number;
  deliveryOutcome?: "complete" | "partial";
}): ResumableWebAnswerBudgetState {
  const state = ResumableWebAnswerBudgetStateSchema.parse(input.state);
  if (!state.activePhase || state.activePhase.phaseId !== input.phaseId) throw new Error("The phase is not active.");
  const chargedPoints = PointsSchema.parse(input.chargedPoints);
  if (chargedPoints > state.activePhase.maximumChargePoints) throw new Error("Phase charge exceeds its admitted maximum.");
  if (state.settledPoints + chargedPoints > state.authorizedPoints) throw new Error("Phase settlement exceeds user authorization.");
  if (state.activePhase.envelope === "delivery" && !input.deliveryOutcome) throw new Error("Final delivery requires a terminal outcome.");
  if (state.activePhase.envelope !== "delivery" && input.deliveryOutcome) throw new Error("Only final delivery may set a delivery outcome.");
  return ResumableWebAnswerBudgetStateSchema.parse({ ...state,
    version: state.version + 1,
    settledPoints: state.settledPoints + chargedPoints,
    decisionDisposition: state.activePhase.envelope === "decision" ? "consumed" : state.decisionDisposition,
    completedPhaseIds: [...state.completedPhaseIds, input.phaseId],
    activePhase: null,
    status: input.deliveryOutcome === "complete" ? "delivered_complete"
      : input.deliveryOutcome === "partial" ? "delivered_partial" : "running",
    requiredAdditionalPoints: null,
  });
}

export function releaseFailedResumableWebAnswerPhase(input: {
  state: ResumableWebAnswerBudgetState;
  phaseId: string;
}): ResumableWebAnswerBudgetState {
  const state = ResumableWebAnswerBudgetStateSchema.parse(input.state);
  if (!state.activePhase || state.activePhase.phaseId !== input.phaseId) throw new Error("The phase is not active.");
  return ResumableWebAnswerBudgetStateSchema.parse({ ...state,
    version: state.version + 1,
    decisionDisposition: state.activePhase.envelope === "decision" ? "consumed" : state.decisionDisposition,
    completedPhaseIds: [...state.completedPhaseIds, input.phaseId],
    activePhase: null,
    status: state.activePhase.envelope === "delivery" ? "failed_no_delivery" : "running",
    requiredAdditionalPoints: null,
  });
}

export function authorizeResumableWebAnswerBudgetIncrease(input: {
  state: ResumableWebAnswerBudgetState;
  authorizationId: string;
  additionalPoints: number;
}): ResumableWebAnswerBudgetState {
  const state = ResumableWebAnswerBudgetStateSchema.parse(input.state);
  const additionalPoints = PositivePointsSchema.parse(input.additionalPoints);
  const existing = state.authorizations.find((entry) => entry.authorizationId === input.authorizationId);
  if (existing) {
    if (existing.authorizedPoints !== additionalPoints) {
      throw new Error("A budget authorization cannot be replayed with a different amount.");
    }
    return state;
  }
  if (state.status !== "awaiting_budget") throw new Error("Only a paused budget can be increased.");
  return ResumableWebAnswerBudgetStateSchema.parse({ ...state,
    version: state.version + 1,
    authorizedPoints: state.authorizedPoints + additionalPoints,
    authorizations: [...state.authorizations, { authorizationId: input.authorizationId, authorizedPoints: additionalPoints }],
    status: "running",
    requiredAdditionalPoints: null,
  });
}

export function waiveDecisionEnvelopeForDelivery(stateInput: ResumableWebAnswerBudgetState): ResumableWebAnswerBudgetState {
  const state = ResumableWebAnswerBudgetStateSchema.parse(stateInput);
  if (terminal.has(state.status) || state.activePhase) throw new Error("Decision envelope cannot be waived now.");
  return ResumableWebAnswerBudgetStateSchema.parse({ ...state,
    version: state.version + 1,
    decisionDisposition: state.decisionDisposition === "available" ? "waived" : state.decisionDisposition,
    status: "running",
    requiredAdditionalPoints: null,
  });
}
