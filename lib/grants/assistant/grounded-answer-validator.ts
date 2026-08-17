import type {
  GrantAssistantAdmittedContext,
  GrantAssistantGroundedCitation,
  GrantAssistantGroundedClaim,
} from "../ports/grant-assistant-model.ts";

export class GrantAssistantGroundingError extends Error {
  readonly code = "grant_assistant_grounding_invalid";
}

export function validateGrantAssistantGroundedAnswer(input: {
  admittedContext: GrantAssistantAdmittedContext[];
  claims: GrantAssistantGroundedClaim[];
  citations: GrantAssistantGroundedCitation[];
}) {
  if (input.admittedContext.length === 0) {
    if (input.claims.length > 0 || input.citations.length > 0) {
      throw new GrantAssistantGroundingError("An ungrounded answer cannot declare source-backed claims.");
    }
    return { grounding: "general_reasoning" as const, claims: [], citations: [] };
  }
  if (input.claims.length === 0 || input.citations.length === 0) {
    throw new GrantAssistantGroundingError("A grounded answer must bind its substantive response to admitted context.");
  }
  const admitted = new Map(input.admittedContext.map((item) => [item.sourceAlias, item]));
  const citations = new Map<string, GrantAssistantGroundedCitation>();
  for (const citation of input.citations) {
    if (citations.has(citation.citationId) || !admitted.has(citation.sourceAlias)) {
      throw new GrantAssistantGroundingError("The answer cited an unknown or duplicate source alias.");
    }
    citations.set(citation.citationId, citation);
  }
  for (const claim of input.claims) {
    if (claim.citationIds.length === 0 || claim.citationIds.some((id) => !citations.has(id))) {
      throw new GrantAssistantGroundingError("A grounded claim has no valid citation binding.");
    }
  }
  return {
    grounding: "evidence_grounded" as const,
    claims: input.claims,
    citations: input.citations.map((citation) => ({
      ...citation,
      sourceType: admitted.get(citation.sourceAlias)!.sourceType,
      label: admitted.get(citation.sourceAlias)!.label,
    })),
  };
}
