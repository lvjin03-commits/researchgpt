import type { ResearchExplorationProposal } from "../contracts.ts";
import {
  ResearchExplorationAdvisoryHintsSchema,
  type ResearchExplorationAdvisoryHints,
} from "./contracts.ts";

function unique(values: ReadonlyArray<string>, maximum: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.normalize("NFKC").toLocaleLowerCase("en-US");
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= maximum) break;
  }
  return result;
}

export function deriveResearchExplorationAdvisoryHints(
  proposal: ResearchExplorationProposal,
): ResearchExplorationAdvisoryHints {
  if (proposal.status === "failed") {
    throw new Error("Only complete or partial exploration proposals can become advisory hints.");
  }
  const seenSections = new Set<string>();
  const suggestedSections = proposal.outlineCandidates
    .flatMap((outline) => outline.sections)
    .filter((section) => {
      const key = section.heading.normalize("NFKC").toLocaleLowerCase("en-US").trim();
      if (!key || seenSections.has(key)) return false;
      seenSections.add(key);
      return true;
    })
    .slice(0, 40)
    .map(({ heading, purpose }) => ({ heading, purpose }));
  return ResearchExplorationAdvisoryHintsSchema.parse({
    schemaVersion: 1,
    explorationId: proposal.explorationId,
    proposalStatus: proposal.status,
    suggestedPerspectives: unique(
      proposal.perspectives.map((item) => item.title),
      12,
    ),
    suggestedQuestions: unique(
      proposal.researchQuestions.map((item) => item.question),
      100,
    ),
    suggestedSections,
    unresolvedQuestions: unique(proposal.unresolvedQuestions, 100),
    warnings: unique(proposal.warnings, 100),
  });
}
