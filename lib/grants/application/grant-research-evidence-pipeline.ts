import type { GrantResearchSourceGroup } from "../web-sources/research-source-acquisition.ts";
import { validateGrantResearchSourceAssessments } from "../web-sources/research-source-assessment.ts";
import { assembleGrantResearchGapComparisons } from "../web-sources/research-gap-comparison.ts";
import { assembleGrantResearchAnswer } from "../web-sources/research-answer-contract.ts";

/** Single application boundary for research judgment. Routes and renderers may
 * not call the individual semantic assemblers independently. */
export function executeGrantResearchEvidencePipeline(input: {
  sourceGroups: readonly GrantResearchSourceGroup[];
  sourceAssessmentProposal: unknown;
  gapComparisonProposal: unknown;
  locationByRef: ReadonlyMap<string, { sectionId: string; nodeId: string }>;
  answerSelection: unknown;
  trace: unknown;
}) {
  const assessments = validateGrantResearchSourceAssessments({
    proposal: input.sourceAssessmentProposal,
    sourceGroups: input.sourceGroups,
  });
  const comparisons = assembleGrantResearchGapComparisons({
    providerResult: input.gapComparisonProposal,
    assessments,
    locationByRef: input.locationByRef,
  });
  const answer = assembleGrantResearchAnswer({
    selection: input.answerSelection,
    comparisons,
    sourceGroups: input.sourceGroups,
    trace: input.trace,
  });
  return Object.freeze({ assessments, comparisons, answer });
}

