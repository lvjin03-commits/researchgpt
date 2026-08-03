import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ResearchExplorationExecutionSchema,
  ResearchExplorationInputSchema,
  ResearchExplorationProposalSchema,
  type ResearchExplorationExecution,
  type ResearchExplorationInput,
  type ResearchExplorationProposal,
} from "@/lib/research-exploration/contracts";

type ExecutionRow = {
  execution_id: string;
  exploration_id: string;
  exploration_revision: number;
  execution_revision: number;
  document_job_id: string | null;
  requirement: "optional" | "required";
  adapter: "storm";
  versions: ResearchExplorationExecution["versions"];
  input_fingerprint: string;
  input_payload: unknown;
  status: ResearchExplorationExecution["status"];
  remote_execution_id: string | null;
  result_location: string | null;
  result_payload: unknown;
  failure: ResearchExplorationExecution["failure"] | null;
  next_check_at: string | null;
  inspection_count: number;
  maximum_inspection_count: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

function toExecution(row: ExecutionRow): ResearchExplorationExecution {
  return ResearchExplorationExecutionSchema.parse({
    schemaVersion: 1,
    executionId: row.execution_id,
    explorationId: row.exploration_id,
    explorationRevision: row.exploration_revision,
    executionRevision: row.execution_revision,
    jobId: row.document_job_id ?? undefined,
    requirement: row.requirement,
    adapter: row.adapter,
    versions: row.versions,
    inputFingerprint: row.input_fingerprint,
    status: row.status,
    remoteExecutionId: row.remote_execution_id ?? undefined,
    resultLocation: row.result_location ?? undefined,
    nextCheckAt: row.next_check_at ?? undefined,
    inspectionCount: row.inspection_count,
    maximumInspectionCount: row.maximum_inspection_count,
    expiresAt: row.expires_at,
    failure: row.failure ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SupabaseResearchExplorationStore {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly ownerId: string,
  ) {}

  async countActive(): Promise<number> {
    const { count, error } = await this.supabase
      .from("research_exploration_executions")
      .select("execution_id", { count: "exact", head: true })
      .in("status", ["queued", "running"]);
    if (error) throw error;
    return count ?? 0;
  }

  async findByFingerprint(fingerprint: string): Promise<ResearchExplorationExecution | null> {
    const { data, error } = await this.supabase
      .from("research_exploration_executions")
      .select("*")
      .eq("owner_id", this.ownerId)
      .eq("input_fingerprint", fingerprint)
      .maybeSingle();
    if (error) throw error;
    return data ? toExecution(data as ExecutionRow) : null;
  }

  async insert(input: {
    execution: ResearchExplorationExecution;
    request: ResearchExplorationInput;
  }): Promise<{ execution: ResearchExplorationExecution; created: boolean }> {
    const execution = ResearchExplorationExecutionSchema.parse(input.execution);
    const request = ResearchExplorationInputSchema.parse(input.request);
    const { data, error } = await this.supabase
      .from("research_exploration_executions")
      .insert({
        execution_id: execution.executionId,
        owner_id: this.ownerId,
        exploration_id: execution.explorationId,
        exploration_revision: execution.explorationRevision,
        execution_revision: execution.executionRevision,
        document_job_id: execution.jobId,
        requirement: execution.requirement,
        adapter: execution.adapter,
        versions: execution.versions,
        input_fingerprint: execution.inputFingerprint,
        input_payload: { schemaVersion: "storm-exploration-request-v1", ...request },
        status: execution.status,
        maximum_inspection_count: execution.maximumInspectionCount,
        expires_at: execution.expiresAt,
        created_at: execution.createdAt,
        updated_at: execution.updatedAt,
      })
      .select("*")
      .single();
    if (!error) return { execution: toExecution(data as ExecutionRow), created: true };
    if (error.code !== "23505") throw error;
    const existing = await this.findByFingerprint(execution.inputFingerprint);
    if (!existing) throw error;
    return { execution: existing, created: false };
  }

  async get(executionId: string): Promise<ResearchExplorationExecution | null> {
    const { data, error } = await this.supabase
      .from("research_exploration_executions")
      .select("*")
      .eq("owner_id", this.ownerId)
      .eq("execution_id", executionId)
      .maybeSingle();
    if (error) throw error;
    return data ? toExecution(data as ExecutionRow) : null;
  }

  async loadResult(executionId: string): Promise<ResearchExplorationProposal> {
    const { data, error } = await this.supabase
      .from("research_exploration_executions")
      .select("result_payload")
      .eq("owner_id", this.ownerId)
      .eq("execution_id", executionId)
      .single();
    if (error) throw error;
    return ResearchExplorationProposalSchema.parse(data.result_payload);
  }

  async markDispatchFailure(executionId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const { error: updateError } = await this.supabase
      .from("research_exploration_executions")
      .update({
        status: "failed",
        phase: "dispatch_failed",
        failure: {
          code: "storm_dispatch_failed",
          category: "infrastructure",
          retryability: "safe",
          technicalMessage: message.slice(0, 8_000),
          userMessageCode: "research_exploration_unavailable",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("owner_id", this.ownerId)
      .eq("execution_id", executionId)
      .eq("status", "queued");
    if (updateError) throw updateError;
  }
}
