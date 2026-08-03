import type { ResearchExplorationExecution } from "./contracts.ts";

export type ResearchExplorationInsertResult = Readonly<{
  execution: ResearchExplorationExecution;
  created: boolean;
}>;

/**
 * Persistence boundary only. A later database adapter must implement
 * insertIfAbsent atomically with a unique inputFingerprint constraint.
 */
export interface ResearchExplorationExecutionRepository {
  findByFingerprint(inputFingerprint: string): Promise<ResearchExplorationExecution | null>;
  get(executionId: string): Promise<ResearchExplorationExecution | null>;
  insertIfAbsent(
    execution: ResearchExplorationExecution,
  ): Promise<ResearchExplorationInsertResult>;
  save(
    execution: ResearchExplorationExecution,
    expectedExecutionRevision: number,
  ): Promise<ResearchExplorationExecution>;
}
