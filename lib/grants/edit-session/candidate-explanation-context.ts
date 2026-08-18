import type { GrantCandidateDiff } from "./candidate-diff.ts";

export const GRANT_CANDIDATE_EXPLANATION_CONTEXT_CHARACTER_BUDGET = 48_000;

type Source = { sourceTitle: string; currentlyAuthorized: boolean; status: "current" | "revoked" | "expired" | "changed" };

export class GrantCandidateExplanationContextBudgetError extends Error {
  readonly code = "context_budget_exceeded";
  constructor() {
    super("The Candidate Diff and required safety context exceed the explanation budget.");
    this.name = "GrantCandidateExplanationContextBudgetError";
  }
}

function size(value: unknown) {
  return JSON.stringify(value).length;
}

export function buildGrantCandidateExplanationContext(input: {
  diff: GrantCandidateDiff;
  blockingIssues: Array<{ code: string; message: string }>;
  sources: Source[];
  maximumCharacters?: number;
}) {
  const maximumCharacters = input.maximumCharacters ?? GRANT_CANDIDATE_EXPLANATION_CONTEXT_CHARACTER_BUDGET;
  const required = { diff: input.diff, blockingIssues: input.blockingIssues };
  const requiredCharacters = size(required);
  if (requiredCharacters > maximumCharacters) throw new GrantCandidateExplanationContextBudgetError();
  const sources: Source[] = [];
  for (const source of input.sources) {
    if (size({ ...required, sources: [...sources, source] }) > maximumCharacters) break;
    sources.push(source);
  }
  return {
    diff: input.diff,
    blockingIssues: input.blockingIssues,
    sources,
    budget: {
      maximumCharacters,
      usedCharacters: size({ ...required, sources }),
      admittedSourceCount: sources.length,
      omittedSourceCount: input.sources.length - sources.length,
    },
  };
}
