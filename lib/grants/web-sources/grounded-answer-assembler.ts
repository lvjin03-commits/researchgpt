import type { GrantAssistantAnswer } from "../assistant/answer-contract.ts";
import { validateGrantAssistantGroundedAnswer } from "../assistant/grounded-answer-validator.ts";
import { GrantWebAnswerProposalSchema, validateGrantWebSourceAssessments,
  type GrantWebSourceRecord } from "./contracts.ts";

export type GrantWebGroundingFailureCategory =
  | "assessment_invalid" | "claim_reference_invalid" | "claim_copying_detected"
  | "grounded_answer_empty";

export class GrantWebGroundingError extends Error {
  readonly category: GrantWebGroundingFailureCategory;
  constructor(category: GrantWebGroundingFailureCategory, message: string) {
    super(message); this.category = category; this.name = "GrantWebGroundingError";
  }
}

function compactCharacters(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function words(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function hasExcessiveGrantWebSnippetOverlap(statement: string, snippet: string): boolean {
  const claim = compactCharacters(statement);
  const source = compactCharacters(snippet);
  const characterWindow = Math.min(30, claim.length);
  if (characterWindow >= 24) {
    for (let index = 0; index <= claim.length - characterWindow; index += 1) {
      if (source.includes(claim.slice(index, index + characterWindow))) return true;
    }
  }
  const claimWords = words(statement);
  const sourceWords = words(snippet);
  if (claimWords.length >= 10 && sourceWords.length >= 10) {
    const sourceText = sourceWords.join(" ");
    for (let index = 0; index <= claimWords.length - 10; index += 1) {
      if (sourceText.includes(claimWords.slice(index, index + 10).join(" "))) return true;
    }
  }
  return false;
}

export function assembleGrantWebGroundedAnswer(input: {
  sources: readonly GrantWebSourceRecord[];
  assessmentProposal: unknown;
  answerProposal: unknown;
}): {
  answer: GrantAssistantAnswer;
  searchedCount: number;
  recommendedCount: number;
  excludedCount: number;
  usedSourceIds: string[];
} {
  let assessments;
  try { assessments = validateGrantWebSourceAssessments({ proposal: input.assessmentProposal, sources: input.sources }); }
  catch (error) { throw new GrantWebGroundingError("assessment_invalid", error instanceof Error ? error.message : "Web assessment is invalid."); }
  const proposal = GrantWebAnswerProposalSchema.parse(input.answerProposal);
  const recommended = new Set(assessments.filter((item) => item.disposition === "recommended").map((item) => item.sourceId));
  const byId = new Map(input.sources.map((source) => [source.sourceId, source]));
  if (proposal.claims.length === 0) throw new GrantWebGroundingError("grounded_answer_empty", "Web-grounded answer contains no supported claim.");
  for (const claim of proposal.claims) {
    if (new Set(claim.sourceIds).size !== claim.sourceIds.length || claim.sourceIds.some((id) => !recommended.has(id) || !byId.has(id))) {
      throw new GrantWebGroundingError("claim_reference_invalid", "A web claim references an unknown, excluded or duplicate source.");
    }
    if (claim.sourceIds.some((id) => hasExcessiveGrantWebSnippetOverlap(claim.statement, byId.get(id)!.snippet))) {
      throw new GrantWebGroundingError("claim_copying_detected", "A web claim copies too much text from its source snippet.");
    }
  }
  const orderedUsedIds = [...new Set(proposal.claims.flatMap((claim) => claim.sourceIds))];
  const aliasById = new Map(orderedUsedIds.map((id, index) => [id, `W${index + 1}`]));
  const citationById = new Map(orderedUsedIds.map((id, index) => [id, `web-citation-${index + 1}`]));
  const content = proposal.claims.map((claim) => `${claim.statement} ${claim.sourceIds.map((id) => `[${aliasById.get(id)}]`).join("")}`).join("\n\n");
  const admittedContext = orderedUsedIds.map((id) => ({
    sourceAlias: aliasById.get(id)!, sourceType: "web_source" as const,
    label: byId.get(id)!.title, excerpt: byId.get(id)!.snippet, url: byId.get(id)!.canonicalUrl,
  }));
  const answer = validateGrantAssistantGroundedAnswer({
    content,
    admittedContext,
    claims: proposal.claims.map((claim) => ({ claimId: claim.claimId, statement: claim.statement,
      citationIds: claim.sourceIds.map((id) => citationById.get(id)!) })),
    citations: orderedUsedIds.map((id) => ({ citationId: citationById.get(id)!, sourceAlias: aliasById.get(id)!, excerpt: byId.get(id)!.snippet })),
  });
  return { answer, searchedCount: input.sources.length, recommendedCount: recommended.size,
    excludedCount: input.sources.length - recommended.size, usedSourceIds: orderedUsedIds };
}
