import { randomUUID } from "node:crypto";
import {
  ResearchExplorationExecutionSchema,
  type ResearchExplorationExecution,
  type ResearchExplorationStatus,
  type ResearchExplorationVersionSnapshot,
} from "./contracts.ts";

const ALLOWED_TRANSITIONS: Readonly<Record<ResearchExplorationStatus, ReadonlySet<ResearchExplorationStatus>>> = {
  queued: new Set(["running", "failed", "unknown_outcome", "expired", "cancelled"]),
  running: new Set(["partial", "complete", "failed", "unknown_outcome", "expired", "cancelled"]),
  unknown_outcome: new Set(["partial", "complete", "failed", "expired", "cancelled"]),
  partial: new Set(),
  complete: new Set(),
  failed: new Set(),
  expired: new Set(),
  cancelled: new Set(),
};

export class ResearchExplorationTransitionError extends Error {
  constructor(from: ResearchExplorationStatus, to: ResearchExplorationStatus) {
    super(`Research exploration cannot transition from ${from} to ${to}.`);
    this.name = "ResearchExplorationTransitionError";
  }
}

export function createQueuedResearchExplorationExecution(input: {
  explorationId: string;
  explorationRevision: number;
  inputFingerprint: string;
  requirement: "optional" | "required";
  versions: ResearchExplorationVersionSnapshot;
  maximumInspectionCount: number;
  expiresAt: string;
  jobId?: string;
  contextRevision?: number;
  now?: string;
}): ResearchExplorationExecution {
  const now = input.now ?? new Date().toISOString();
  return ResearchExplorationExecutionSchema.parse({
    schemaVersion: 1,
    executionId: randomUUID(),
    explorationId: input.explorationId,
    explorationRevision: input.explorationRevision,
    executionRevision: 0,
    jobId: input.jobId,
    contextRevision: input.contextRevision,
    requirement: input.requirement,
    adapter: "storm",
    versions: input.versions,
    inputFingerprint: input.inputFingerprint,
    status: "queued",
    inspectionCount: 0,
    maximumInspectionCount: input.maximumInspectionCount,
    expiresAt: input.expiresAt,
    createdAt: now,
    updatedAt: now,
  });
}

export function transitionResearchExplorationExecution(input: {
  execution: ResearchExplorationExecution;
  status: ResearchExplorationStatus;
  remoteExecutionId?: string;
  resultLocation?: string;
  nextCheckAt?: string;
  incrementInspectionCount?: boolean;
  failure?: ResearchExplorationExecution["failure"];
  now?: string;
}): ResearchExplorationExecution {
  const current = ResearchExplorationExecutionSchema.parse(input.execution);
  if (!ALLOWED_TRANSITIONS[current.status].has(input.status)) {
    throw new ResearchExplorationTransitionError(current.status, input.status);
  }
  return ResearchExplorationExecutionSchema.parse({
    ...current,
    executionRevision: current.executionRevision + 1,
    status: input.status,
    remoteExecutionId: input.remoteExecutionId ?? current.remoteExecutionId,
    resultLocation: input.resultLocation ?? current.resultLocation,
    nextCheckAt: input.nextCheckAt,
    inspectionCount:
      current.inspectionCount + (input.incrementInspectionCount ? 1 : 0),
    failure: input.failure,
    updatedAt: input.now ?? new Date().toISOString(),
  });
}

export function isTerminalResearchExplorationStatus(
  status: ResearchExplorationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[status].size === 0;
}
