import type { GrantWebAnswerProposal, GrantWebQueryRewriteProposal,
  GrantWebSourceAssessmentProposal, GrantWebSourceRecord } from "../web-sources/contracts.ts";
import { GrantWebResumableCheckpointSchema, nextGrantWebCheckpointOperation,
  type GrantWebResumableCheckpoint } from "../web-sources/resumable-checkpoint.ts";
import type { GrantWebBudgetedPhaseOrchestrator, GrantWebPhaseQuote,
  GrantWebPlannedCall } from "./grant-web-budgeted-phase-orchestrator.ts";

export type GrantWebCheckpointArtifact =
  | { operation: "query_rewrite"; value: GrantWebQueryRewriteProposal }
  | { operation: "search_query"; value: { searchAuditId: string; searchAuditIds?: string[]; sources: GrantWebSourceRecord[] } }
  | { operation: "source_assessment"; value: GrantWebSourceAssessmentProposal }
  | { operation: "answer_synthesis" | "existing_results_delivery"; value: GrantWebAnswerProposal };

export function applyGrantWebCheckpointArtifact(checkpointInput: GrantWebResumableCheckpoint,
  artifact: GrantWebCheckpointArtifact): GrantWebResumableCheckpoint {
  const checkpoint = GrantWebResumableCheckpointSchema.parse(checkpointInput);
  if (artifact.operation === "query_rewrite") return GrantWebResumableCheckpointSchema.parse({ ...checkpoint, query: artifact.value });
  if (artifact.operation === "search_query") return GrantWebResumableCheckpointSchema.parse({ ...checkpoint, search: artifact.value });
  if (artifact.operation === "source_assessment") return GrantWebResumableCheckpointSchema.parse({ ...checkpoint, assessment: artifact.value });
  return GrantWebResumableCheckpointSchema.parse({ ...checkpoint, answer: artifact.value });
}

export class GrantWebResumableFlow {
  next(input: { checkpoint: GrantWebResumableCheckpoint; deliverExisting?: boolean }) {
    return nextGrantWebCheckpointOperation({ checkpoint: input.checkpoint,
      deliverExisting: input.deliverExisting === true });
  }

  deliverySources(checkpointInput: GrantWebResumableCheckpoint): GrantWebSourceRecord[] {
    const checkpoint = GrantWebResumableCheckpointSchema.parse(checkpointInput);
    if (!checkpoint.search?.sources.length) throw new Error("Existing-results delivery requires saved search results.");
    const recommended = new Set(checkpoint.assessment?.assessments
      .filter((item) => item.disposition === "recommended").map((item) => item.sourceId) ?? []);
    return checkpoint.search.sources.filter((source) => recommended.size === 0 || recommended.has(source.sourceId));
  }
}

export class GrantWebResumablePhaseExecutor {
  private readonly phases: GrantWebBudgetedPhaseOrchestrator;
  constructor(phases: GrantWebBudgetedPhaseOrchestrator) { this.phases = phases; }

  execute<T>(input: {
    state: Parameters<GrantWebBudgetedPhaseOrchestrator["execute"]>[0]["state"];
    checkpoint: GrantWebResumableCheckpoint;
    phaseId: string;
    quote: GrantWebPhaseQuote;
    plannedCall: GrantWebPlannedCall;
    artifactOperation: GrantWebCheckpointArtifact["operation"];
    invoke: () => Promise<{ value: T; artifact: GrantWebCheckpointArtifact; chargedPoints: number;
      deliveryOutcome?: "complete" | "partial" }>;
  }) {
    return this.phases.execute({ state: input.state, phaseId: input.phaseId,
      operationKey: input.artifactOperation,
      quote: input.quote, plannedCall: input.plannedCall,
      invoke: async () => {
        const result = await input.invoke();
        const checkpoint = applyGrantWebCheckpointArtifact(input.checkpoint, result.artifact);
        return { value: { value: result.value, artifact: result.artifact, checkpoint }, chargedPoints: result.chargedPoints,
          deliveryOutcome: result.deliveryOutcome, checkpointArtifact: checkpoint };
      } });
  }
}
