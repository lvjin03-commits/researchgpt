import type {
  GrantAssistantAdmittedContext,
  GrantAssistantGroundedCitation,
  GrantAssistantGroundedClaim,
} from "../ports/grant-assistant-model.ts";
import type { GrantAssistantAnswer } from "./answer-contract.ts";
import { createGrantAssistantFailureReason, type GrantAssistantFailureReason,
  type GrantAssistantFailureReasonCode } from "../model-execution/assistant-failure-reasons.ts";

export class GrantAssistantGroundingError extends Error {
  readonly code = "grant_assistant_grounding_invalid";
  readonly failureStage = "answer_generation" as const;
  readonly failureReason: GrantAssistantFailureReason;
  readonly requestDispatched = true;
  readonly usageKnown = false;

  constructor(reasonCode: GrantAssistantFailureReasonCode, message: string, safeFacts?: {
    admittedSourceCount?: number; claimCount?: number; citationCount?: number }) {
    super(message);
    this.name = "GrantAssistantGroundingError";
    this.failureReason = createGrantAssistantFailureReason({ reasonCode, stage: "answer_generation",
      safeFacts: { ...safeFacts, requestDispatched: true, usageKnown: false } });
  }
}

export function validateGrantAssistantGroundedAnswer(input: {
  content: string;
  admittedContext: GrantAssistantAdmittedContext[];
  claims: GrantAssistantGroundedClaim[];
  citations: GrantAssistantGroundedCitation[];
}): GrantAssistantAnswer {
  if (input.admittedContext.length === 0) {
    if (input.claims.length > 0 || input.citations.length > 0) {
      throw new GrantAssistantGroundingError("answer.ungrounded_claims_present",
        "An ungrounded answer cannot declare source-backed claims.", {
          admittedSourceCount: 0, claimCount: input.claims.length, citationCount: input.citations.length });
    }
    return {
      content: input.content,
      grounding: "general_reasoning",
      claims: [],
      citations: [],
      referencedObjects: [],
      suggestedActions: [],
    };
  }
  if (input.claims.length === 0 || input.citations.length === 0) {
    throw new GrantAssistantGroundingError("answer.grounded_bindings_missing",
      "A grounded answer must bind its substantive response to admitted context.", {
        admittedSourceCount: input.admittedContext.length, claimCount: input.claims.length,
        citationCount: input.citations.length });
  }
  const admitted = new Map(input.admittedContext.map((item) => [item.sourceAlias, item]));
  const citations = new Map<string, GrantAssistantGroundedCitation>();
  for (const citation of input.citations) {
    if (citations.has(citation.citationId) || !admitted.has(citation.sourceAlias)) {
      throw new GrantAssistantGroundingError("answer.citation_source_invalid",
        "The answer cited an unknown or duplicate source alias.", {
          admittedSourceCount: input.admittedContext.length, claimCount: input.claims.length,
          citationCount: input.citations.length });
    }
    citations.set(citation.citationId, citation);
  }
  for (const claim of input.claims) {
    if (claim.citationIds.length === 0 || claim.citationIds.some((id) => !citations.has(id))) {
      throw new GrantAssistantGroundingError("answer.claim_citation_invalid",
        "A grounded claim has no valid citation binding.", {
          admittedSourceCount: input.admittedContext.length, claimCount: input.claims.length,
          citationCount: input.citations.length });
    }
  }
  return {
    content: input.content,
    grounding: "evidence_grounded",
    claims: input.claims,
    citations: input.citations.map((citation) => ({
      ...citation,
      sourceType: admitted.get(citation.sourceAlias)!.sourceType,
      label: admitted.get(citation.sourceAlias)!.label,
      ...(admitted.get(citation.sourceAlias)!.url ? { url: admitted.get(citation.sourceAlias)!.url } : {}),
    })),
    referencedObjects: input.admittedContext.map(({ sourceAlias, sourceType, label, url }) => ({
      sourceAlias,
      sourceType,
      label,
      ...(url ? { url } : {}),
    })),
    unsupportedClaims: [],
    warnings: [],
    suggestedActions: [],
  };
}
