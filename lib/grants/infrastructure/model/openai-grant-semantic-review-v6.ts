import type OpenAI from "openai";
import {
  GrantFactMapCoverageReportV1Schema,
  GrantFactMapV1Schema,
  GrantNarrativeFindingContentV1Schema,
  GrantScientificFindingContentV1Schema,
  type GrantFactMapCoverageReportV1,
  type GrantFactMapV1,
  type GrantNarrativeFindingContentV1,
  type GrantScientificFindingContentV1,
} from "../../diagnostics/semantic-review-v6-contracts.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "../../diagnostics/semantic-review-v6-input.ts";
import {
  textOnlyGrantDiagnosticImageAdmission,
  type GrantDiagnosticImageAdmissionProvider,
  type GrantDiagnosticImageCoverage,
} from "../../diagnostics/multimodal-diagnostic-input.ts";
import { executeGrantFactMapV1, GrantFactMapExecutionErrorV1 } from "./openai-grant-fact-map-v6.ts";
import { executeGrantScientificReviewV1, GrantScientificReviewExecutionErrorV1 } from "./openai-grant-scientific-review-v6.ts";
import { executeGrantNarrativeReviewV1, GrantNarrativeReviewExecutionErrorV1 } from "./openai-grant-narrative-review-v6.ts";

export const GRANT_SEMANTIC_REVIEW_V6_BUDGET = {
  factMapMaxCalls: 1,
  scientificReviewMaxCalls: 2,
  narrativeReviewMaxCalls: 2,
  totalMaxCalls: 4,
  normalCallCount: 3,
  maxCompletionTokenAllocation: 46_000,
  factMapCompletionTokens: 6_000,
  scientificCompletionTokens: 12_000,
  scientificCapacityRetryTokens: 18_000,
  narrativeCompletionTokens: 8_000,
  narrativeCapacityRetryTokens: 14_000,
} as const;

type Usage = { inputTokens: number; outputTokens: number; reasoningTokens: number };
export type GrantSemanticReviewV6Stage = "fact_mapping" | "scientific_review" | "narrative_review";
export type GrantSemanticReviewV6StageState = {
  stage: GrantSemanticReviewV6Stage;
  status: "not_started" | "succeeded" | "failed" | "skipped";
  attemptCount: number;
  failureCode: string | null;
};

export type GrantSemanticReviewV6Checkpoint = {
  sourceRevisionId: string;
  inputFingerprint: string;
  locationScopeFingerprint: string;
  factMap: GrantFactMapV1;
  scientificReview?: {
    scientificFindings: GrantScientificFindingContentV1[];
    coverageReport: GrantFactMapCoverageReportV1;
  };
};

export type GrantSemanticReviewV6ExecutionResult = {
  factMap: GrantFactMapV1;
  scientificFindings: GrantScientificFindingContentV1[];
  coverageReport: GrantFactMapCoverageReportV1;
  narrativeFindings: GrantNarrativeFindingContentV1[];
  imageCoverage: GrantDiagnosticImageCoverage;
  providerCallCount: number;
  completionTokenAllocation: number;
  usage: Usage;
  stages: GrantSemanticReviewV6StageState[];
  resumedFrom: "none" | "fact_map" | "scientific_review";
};

export class GrantSemanticReviewV6ExecutionError extends Error {
  readonly failureCode: string;
  readonly failedStage: GrantSemanticReviewV6Stage;
  readonly providerCallCount: number;
  readonly completionTokenAllocation: number;
  readonly usage: Usage;
  readonly stages: GrantSemanticReviewV6StageState[];
  readonly checkpoint?: GrantSemanticReviewV6Checkpoint;
  readonly imageCoverage: GrantDiagnosticImageCoverage;

  constructor(input: {
    failureCode: string;
    failedStage: GrantSemanticReviewV6Stage;
    message: string;
    providerCallCount: number;
    completionTokenAllocation: number;
    usage: Usage;
    stages: GrantSemanticReviewV6StageState[];
    checkpoint?: GrantSemanticReviewV6Checkpoint;
    imageCoverage: GrantDiagnosticImageCoverage;
  }) {
    super(input.message);
    this.name = "GrantSemanticReviewV6ExecutionError";
    this.failureCode = input.failureCode;
    this.failedStage = input.failedStage;
    this.providerCallCount = input.providerCallCount;
    this.completionTokenAllocation = input.completionTokenAllocation;
    this.usage = input.usage;
    this.stages = input.stages;
    this.checkpoint = input.checkpoint;
    this.imageCoverage = input.imageCoverage;
  }
}

function addUsage(target: Usage, source: Usage): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningTokens += source.reasoningTokens;
}

function validateCheckpoint(input: {
  prepared: GrantSemanticReviewV6PreparedInputV1;
  checkpoint: GrantSemanticReviewV6Checkpoint;
}): GrantSemanticReviewV6Checkpoint {
  const checkpoint = input.checkpoint;
  if (checkpoint.sourceRevisionId !== input.prepared.sourceRevisionId
    || checkpoint.inputFingerprint !== input.prepared.inputFingerprint
    || checkpoint.locationScopeFingerprint !== input.prepared.locationScopeFingerprint) {
    throw new Error("Semantic Review checkpoint does not match the frozen execution input.");
  }
  const factMap = GrantFactMapV1Schema.parse(checkpoint.factMap);
  if (factMap.sourceRevisionId !== input.prepared.sourceRevisionId
    || factMap.locationScopeFingerprint !== input.prepared.locationScopeFingerprint) {
    throw new Error("Semantic Review checkpoint Fact Map crossed the frozen scope.");
  }
  const scientificReview = checkpoint.scientificReview ? {
    scientificFindings: checkpoint.scientificReview.scientificFindings.map((finding) => GrantScientificFindingContentV1Schema.parse(finding)),
    coverageReport: GrantFactMapCoverageReportV1Schema.parse(checkpoint.scientificReview.coverageReport),
  } : undefined;
  if (scientificReview?.coverageReport.sourceRevisionId !== input.prepared.sourceRevisionId) {
    throw new Error("Scientific Review checkpoint crossed the frozen revision.");
  }
  return { ...checkpoint, factMap, scientificReview };
}

function stageStates(input: {
  fact: GrantSemanticReviewV6StageState;
  scientific: GrantSemanticReviewV6StageState;
  narrative: GrantSemanticReviewV6StageState;
}): GrantSemanticReviewV6StageState[] {
  return [input.fact, input.scientific, input.narrative];
}

function canRecoverScientific(error: GrantScientificReviewExecutionErrorV1): number | null {
  if (error.code === "scientific_review_output_truncated") return GRANT_SEMANTIC_REVIEW_V6_BUDGET.scientificCapacityRetryTokens;
  if (error.code === "scientific_review_provider_failure" && error.metadata.retryableProviderFailure === true) {
    return GRANT_SEMANTIC_REVIEW_V6_BUDGET.scientificCompletionTokens;
  }
  return null;
}

function canRecoverNarrative(error: GrantNarrativeReviewExecutionErrorV1): number | null {
  if (error.code === "narrative_review_output_truncated") return GRANT_SEMANTIC_REVIEW_V6_BUDGET.narrativeCapacityRetryTokens;
  if (error.code === "narrative_review_provider_failure" && error.metadata.retryableProviderFailure === true) {
    return GRANT_SEMANTIC_REVIEW_V6_BUDGET.narrativeCompletionTokens;
  }
  return null;
}

/** Single call/token budget authority for Fact Map + Scientific + Narrative.
 * No persistence or rollout decision is made here. */
export async function executeGrantSemanticReviewV6(input: {
  client: OpenAI;
  modelId: string;
  prepared: GrantSemanticReviewV6PreparedInputV1;
  checkpoint?: GrantSemanticReviewV6Checkpoint;
  imageAdmission?: GrantDiagnosticImageAdmissionProvider;
}): Promise<GrantSemanticReviewV6ExecutionResult> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  let providerCallCount = 0;
  let completionTokenAllocation = 0;
  let exceptionalRecoveryUsed = false;
  const emptyImageCoverage = textOnlyGrantDiagnosticImageAdmission({
    candidateCount: input.prepared.figureLocationRefByAssetId.size,
    reasons: input.prepared.figureLocationRefByAssetId.size === 0 ? ["no_figures_in_scope"] : ["not_authorized"],
  }).coverage;
  let imageCoverage = emptyImageCoverage;
  const checkpoint = input.checkpoint ? validateCheckpoint({ prepared: input.prepared, checkpoint: input.checkpoint }) : undefined;
  const resumedFrom = checkpoint?.scientificReview ? "scientific_review" : checkpoint ? "fact_map" : "none";

  let factMap: GrantFactMapV1;
  let factAttempts = 0;
  if (checkpoint) {
    factMap = checkpoint.factMap;
  } else {
    factAttempts = 1;
    completionTokenAllocation += GRANT_SEMANTIC_REVIEW_V6_BUDGET.factMapCompletionTokens;
    providerCallCount += 1;
    try {
      const mapped = await executeGrantFactMapV1({
        client: input.client,
        modelId: input.modelId,
        prepared: input.prepared,
        maxCompletionTokens: GRANT_SEMANTIC_REVIEW_V6_BUDGET.factMapCompletionTokens,
      });
      addUsage(usage, mapped.usage);
      factMap = mapped.factMap;
    } catch (error) {
      if (error instanceof GrantFactMapExecutionErrorV1) addUsage(usage, error.metadata);
      const failureCode = error instanceof GrantFactMapExecutionErrorV1 ? error.code : "fact_map_provider_failure";
      throw new GrantSemanticReviewV6ExecutionError({
        failureCode, failedStage: "fact_mapping", message: error instanceof Error ? error.message : "Fact mapping failed.",
        providerCallCount, completionTokenAllocation, usage, imageCoverage,
        stages: stageStates({
          fact: { stage: "fact_mapping", status: "failed", attemptCount: factAttempts, failureCode },
          scientific: { stage: "scientific_review", status: "skipped", attemptCount: 0, failureCode: null },
          narrative: { stage: "narrative_review", status: "skipped", attemptCount: 0, failureCode: null },
        }),
      });
    }
  }

  const factCheckpoint: GrantSemanticReviewV6Checkpoint = {
    sourceRevisionId: input.prepared.sourceRevisionId,
    inputFingerprint: input.prepared.inputFingerprint,
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    factMap,
  };
  let scientificFindings: GrantScientificFindingContentV1[];
  let coverageReport: GrantFactMapCoverageReportV1;
  let scientificAttempts = 0;
  if (checkpoint?.scientificReview) {
    scientificFindings = checkpoint.scientificReview.scientificFindings;
    coverageReport = checkpoint.scientificReview.coverageReport;
  } else {
    let lastError: GrantScientificReviewExecutionErrorV1 | undefined;
    while (scientificAttempts < GRANT_SEMANTIC_REVIEW_V6_BUDGET.scientificReviewMaxCalls) {
      const budget = lastError ? canRecoverScientific(lastError) : GRANT_SEMANTIC_REVIEW_V6_BUDGET.scientificCompletionTokens;
      if (budget === null || (lastError && exceptionalRecoveryUsed)) break;
      if (providerCallCount >= GRANT_SEMANTIC_REVIEW_V6_BUDGET.totalMaxCalls
        || completionTokenAllocation + budget > GRANT_SEMANTIC_REVIEW_V6_BUDGET.maxCompletionTokenAllocation) break;
      if (lastError) exceptionalRecoveryUsed = true;
      scientificAttempts += 1;
      providerCallCount += 1;
      completionTokenAllocation += budget;
      try {
        const reviewed = await executeGrantScientificReviewV1({ client: input.client, modelId: input.modelId, prepared: input.prepared, factMap, maxCompletionTokens: budget });
        addUsage(usage, reviewed.usage);
        scientificFindings = reviewed.scientificFindings;
        coverageReport = reviewed.coverageReport;
        lastError = undefined;
        break;
      } catch (error) {
        if (!(error instanceof GrantScientificReviewExecutionErrorV1)) throw error;
        addUsage(usage, error.metadata);
        lastError = error;
      }
    }
    if (lastError || scientificFindings! === undefined || coverageReport! === undefined) {
      const failureCode = lastError?.code ?? "scientific_review_provider_failure";
      throw new GrantSemanticReviewV6ExecutionError({
        failureCode, failedStage: "scientific_review", message: lastError?.message ?? "Scientific Review exhausted the aggregate budget.",
        providerCallCount, completionTokenAllocation, usage, checkpoint: factCheckpoint, imageCoverage,
        stages: stageStates({
          fact: { stage: "fact_mapping", status: "succeeded", attemptCount: factAttempts, failureCode: null },
          scientific: { stage: "scientific_review", status: "failed", attemptCount: scientificAttempts, failureCode },
          narrative: { stage: "narrative_review", status: "skipped", attemptCount: 0, failureCode: null },
        }),
      });
    }
  }

  const scientificCheckpoint: GrantSemanticReviewV6Checkpoint = {
    ...factCheckpoint,
    scientificReview: { scientificFindings, coverageReport },
  };
  let narrativeAttempts = 0;
  let lastNarrativeError: GrantNarrativeReviewExecutionErrorV1 | undefined;
  let narrativeFindings: GrantNarrativeFindingContentV1[] | undefined;
  while (narrativeAttempts < GRANT_SEMANTIC_REVIEW_V6_BUDGET.narrativeReviewMaxCalls) {
    const budget = lastNarrativeError ? canRecoverNarrative(lastNarrativeError) : GRANT_SEMANTIC_REVIEW_V6_BUDGET.narrativeCompletionTokens;
    if (budget === null || (lastNarrativeError && exceptionalRecoveryUsed)) break;
    if (providerCallCount >= GRANT_SEMANTIC_REVIEW_V6_BUDGET.totalMaxCalls
      || completionTokenAllocation + budget > GRANT_SEMANTIC_REVIEW_V6_BUDGET.maxCompletionTokenAllocation) break;
    if (lastNarrativeError) exceptionalRecoveryUsed = true;
    narrativeAttempts += 1;
    providerCallCount += 1;
    completionTokenAllocation += budget;
    const admission = input.imageAdmission
      ? await input.imageAdmission()
      : textOnlyGrantDiagnosticImageAdmission({
        candidateCount: input.prepared.figureLocationRefByAssetId.size,
        reasons: input.prepared.figureLocationRefByAssetId.size === 0 ? ["no_figures_in_scope"] : ["not_authorized"],
      });
    imageCoverage = admission.coverage;
    try {
      const reviewed = await executeGrantNarrativeReviewV1({ client: input.client, modelId: input.modelId, prepared: input.prepared, imageAdmission: admission, maxCompletionTokens: budget });
      addUsage(usage, reviewed.usage);
      narrativeFindings = reviewed.narrativeFindings;
      lastNarrativeError = undefined;
      break;
    } catch (error) {
      if (!(error instanceof GrantNarrativeReviewExecutionErrorV1)) throw error;
      addUsage(usage, error.metadata);
      lastNarrativeError = error;
    }
  }
  if (lastNarrativeError || narrativeFindings === undefined) {
    const failureCode = lastNarrativeError?.code ?? "narrative_review_provider_failure";
    throw new GrantSemanticReviewV6ExecutionError({
      failureCode, failedStage: "narrative_review", message: lastNarrativeError?.message ?? "Narrative Review exhausted the aggregate budget.",
      providerCallCount, completionTokenAllocation, usage, checkpoint: scientificCheckpoint, imageCoverage,
      stages: stageStates({
        fact: { stage: "fact_mapping", status: "succeeded", attemptCount: factAttempts, failureCode: null },
        scientific: { stage: "scientific_review", status: "succeeded", attemptCount: scientificAttempts, failureCode: null },
        narrative: { stage: "narrative_review", status: "failed", attemptCount: narrativeAttempts, failureCode },
      }),
    });
  }

  return {
    factMap, scientificFindings, coverageReport, narrativeFindings, imageCoverage,
    providerCallCount, completionTokenAllocation, usage, resumedFrom,
    stages: stageStates({
      fact: { stage: "fact_mapping", status: "succeeded", attemptCount: factAttempts, failureCode: null },
      scientific: { stage: "scientific_review", status: "succeeded", attemptCount: scientificAttempts, failureCode: null },
      narrative: { stage: "narrative_review", status: "succeeded", attemptCount: narrativeAttempts, failureCode: null },
    }),
  };
}
