import type {
  ResearchExplorationExecution,
  ResearchExplorationInput,
  ResearchExplorationProposal,
} from "./contracts.ts";

export type ResearchExplorationHandle = Readonly<
  Pick<
    ResearchExplorationExecution,
    | "executionId"
    | "explorationId"
    | "explorationRevision"
    | "inputFingerprint"
    | "status"
    | "remoteExecutionId"
    | "resultLocation"
  >
>;

export interface ResearchExplorationCapability {
  startOrReuse(input: ResearchExplorationInput): Promise<ResearchExplorationHandle>;
  inspect(executionId: string): Promise<ResearchExplorationExecution>;
  loadResult(executionId: string): Promise<ResearchExplorationProposal>;
  cancel(executionId: string): Promise<ResearchExplorationExecution>;
}

export type ResearchExplorationProviderStart = Readonly<{
  remoteExecutionId: string;
  status: "queued" | "running";
  nextCheckAt?: string;
}>;

export type ResearchExplorationProviderInspection = Readonly<{
  status:
    | "queued"
    | "running"
    | "partial"
    | "complete"
    | "failed"
    | "unknown_outcome"
    | "expired"
    | "cancelled";
  resultLocation?: string;
  nextCheckAt?: string;
  failure?: {
    code: string;
    category: "contract" | "provider" | "infrastructure" | "unknown_outcome";
    retryability: "none" | "safe" | "unknown";
    technicalMessage: string;
    userMessageCode: string;
  };
}>;

export interface ResearchExplorationProviderAdapter {
  start(input: ResearchExplorationInput): Promise<ResearchExplorationProviderStart>;
  inspect(remoteExecutionId: string): Promise<ResearchExplorationProviderInspection>;
  loadResult(resultLocation: string): Promise<ResearchExplorationProposal>;
  cancel(remoteExecutionId: string): Promise<void>;
}
