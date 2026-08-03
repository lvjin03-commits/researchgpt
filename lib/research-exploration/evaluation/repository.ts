import type { ResearchExplorationShadowEvaluation } from "./contracts.ts";

/** Shadow observations are stored separately from document checkpoints. */
export interface ResearchExplorationShadowEvaluationRepository {
  save(
    evaluation: ResearchExplorationShadowEvaluation,
  ): Promise<ResearchExplorationShadowEvaluation>;
  listByBaseline(
    baselineId: string,
    baselineRevision: number,
  ): Promise<ReadonlyArray<ResearchExplorationShadowEvaluation>>;
}
