import { z } from "zod";

export const GrantResearchScopeSignalsSchema = z.object({
  coreQuestionMatch: z.number().int().min(0).max(2),
  researchObjectMatch: z.number().int().min(0).max(2),
  mechanismMatch: z.number().int().min(0).max(2),
  plannedMethodMatch: z.number().int().min(0).max(1),
  introducesNewObject: z.boolean(),
  introducesNewMethodChain: z.boolean(),
  introducesNewEvaluationSystem: z.boolean(),
  workloadImpact: z.number().int().min(0).max(3),
}).strict();

export type GrantResearchScopeSignals = z.infer<typeof GrantResearchScopeSignalsSchema>;
export type GrantResearchScopeDecision = {
  finalDecision: "main_suggestion" | "supporting_evidence" | "optional_reference" | "reject";
  relevance: "direct" | "supporting" | "adjacent";
  scopeImpact: "none" | "small" | "major";
  rejectionReason: "adjacent_topic" | "major_scope_expansion" | null;
};

/** The model may propose bounded signals, but only this function owns the
 * decision that controls whether a candidate can enter the final answer. */
export function decideGrantResearchSuggestionScope(value: unknown): GrantResearchScopeDecision {
  const signals = GrantResearchScopeSignalsSchema.parse(value);
  const matchScore = signals.coreQuestionMatch + signals.researchObjectMatch
    + signals.mechanismMatch + signals.plannedMethodMatch;
  const expansionCount = Number(signals.introducesNewObject) + Number(signals.introducesNewMethodChain)
    + Number(signals.introducesNewEvaluationSystem);
  const scopeImpact = expansionCount >= 2 || signals.workloadImpact >= 3 ? "major"
    : expansionCount === 1 || signals.workloadImpact >= 1 ? "small" : "none";
  const relevance = signals.coreQuestionMatch === 2 && signals.researchObjectMatch === 2
    && signals.mechanismMatch === 2 ? "direct" : matchScore >= 4 ? "supporting" : "adjacent";

  if (relevance === "adjacent") {
    return { finalDecision: "reject", relevance, scopeImpact, rejectionReason: "adjacent_topic" };
  }
  if (scopeImpact === "major") {
    return { finalDecision: "reject", relevance, scopeImpact, rejectionReason: "major_scope_expansion" };
  }
  if (relevance === "direct") {
    return { finalDecision: "main_suggestion", relevance, scopeImpact, rejectionReason: null };
  }
  return { finalDecision: scopeImpact === "none" ? "supporting_evidence" : "optional_reference",
    relevance, scopeImpact, rejectionReason: null };
}
