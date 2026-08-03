import { createHash, randomUUID } from "node:crypto";
import type { ResearchExplorationProposal } from "../contracts.ts";
import {
  ResearchExplorationShadowBaselineSchema,
  ResearchExplorationShadowEvaluationSchema,
  type ResearchExplorationShadowBaseline,
  type ResearchExplorationShadowEvaluation,
} from "./contracts.ts";

function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

function baselineFingerprint(baseline: ResearchExplorationShadowBaseline): string {
  return createHash("sha256")
    .update(JSON.stringify(baseline))
    .digest("hex");
}

function canonicalSourceKey(source: ResearchExplorationProposal["sourceCandidates"][number]): string {
  if (source.doi) return `doi:${source.doi.trim().toLocaleLowerCase("en-US")}`;
  if (source.url) return `url:${source.url.trim().toLocaleLowerCase("en-US")}`;
  return `title:${normalizedText(source.title)}`;
}

export function evaluateResearchExplorationShadow(input: {
  baseline: ResearchExplorationShadowBaseline;
  proposal: ResearchExplorationProposal;
  explorationRevision: number;
  now?: string;
}): ResearchExplorationShadowEvaluation {
  const baseline = ResearchExplorationShadowBaselineSchema.parse(input.baseline);
  const baselineHeadings = new Set(baseline.sectionHeadings.map(normalizedText));
  const proposedHeadings = input.proposal.outlineCandidates.flatMap((outline) =>
    outline.sections.map((section) => normalizedText(section.heading)),
  );
  const uniqueProposedHeadings = new Set(proposedHeadings);
  const matchedBaselineHeadings = [...baselineHeadings].filter((heading) =>
    uniqueProposedHeadings.has(heading),
  ).length;
  const sourceKeys = input.proposal.sourceCandidates.map(canonicalSourceKey);
  const duplicateSourceCount = sourceKeys.length - new Set(sourceKeys).size;
  const urlCount = input.proposal.sourceCandidates.filter((source) => source.url).length;

  return ResearchExplorationShadowEvaluationSchema.parse({
    schemaVersion: 1,
    evaluationId: randomUUID(),
    explorationId: input.proposal.explorationId,
    explorationRevision: input.explorationRevision,
    baselineId: baseline.baselineId,
    baselineRevision: baseline.baselineRevision,
    baselineFingerprint: baselineFingerprint(baseline),
    proposalStatus: input.proposal.status,
    metrics: {
      proposedPerspectiveCount: input.proposal.perspectives.length,
      proposedQuestionCount: input.proposal.researchQuestions.length,
      proposedOutlineSectionCount: uniqueProposedHeadings.size,
      novelOutlineSectionCount: [...uniqueProposedHeadings].filter(
        (heading) => !baselineHeadings.has(heading),
      ).length,
      baselineHeadingCoverageRatio: ratio(
        matchedBaselineHeadings,
        baselineHeadings.size,
      ),
      sourceCandidateCount: input.proposal.sourceCandidates.length,
      sourceUrlAvailabilityRatio: ratio(urlCount, input.proposal.sourceCandidates.length),
      duplicateSourceRatio: ratio(duplicateSourceCount, sourceKeys.length),
      unresolvedQuestionCount: input.proposal.unresolvedQuestions.length,
      modelCalls: input.proposal.usage.modelCalls,
      searchCalls: input.proposal.usage.searchCalls,
      estimatedCostUsd: input.proposal.usage.estimatedCostUsd,
    },
    warnings: input.proposal.warnings,
    evaluatedAt: input.now ?? new Date().toISOString(),
  });
}
