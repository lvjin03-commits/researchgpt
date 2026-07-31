import type { SupabaseClient } from "@supabase/supabase-js";

export type DiagnosticJobRow = {
  id: string;
  status: string;
  stage: string;
  revision: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  recovery_count: number;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DiagnosticEventRow = {
  sequence: number;
  stage: string;
  status: string;
  event_payload: Record<string, unknown>;
  created_at: string;
};

export type DiagnosticExecutionRow = {
  execution_key: string;
  component_key: string | null;
  operation: string;
  input_fingerprint: string;
  provider: string;
  requested_model_id: string;
  resolved_model_id: string;
  actual_model_id: string | null;
  provider_request_id: string | null;
  status: string;
  attempt: number;
  lease_expires_at: string | null;
  started_at: string | null;
  response_received_at: string | null;
  raw_saved_at: string | null;
  completed_at: string | null;
  failure_category: string | null;
  error_message: string | null;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
};

export type DiagnosticOutboxRow = {
  id: string;
  event_type: string;
  status: string;
  delivery_attempts: number;
  next_attempt_at: string;
  delivered_at: string | null;
  created_at: string;
};

export type DiagnosticSources = {
  job: DiagnosticJobRow;
  events: DiagnosticEventRow[];
  executions: DiagnosticExecutionRow[];
  outbox: DiagnosticOutboxRow[];
};

const JOB_FIELDS =
  "id,status,stage,revision,lease_owner,lease_expires_at,recovery_count,last_heartbeat_at,created_at,updated_at";
const EVENT_FIELDS =
  "sequence,stage,status,event_payload,created_at";
const EXECUTION_FIELDS = [
  "execution_key",
  "component_key",
  "operation",
  "input_fingerprint",
  "provider",
  "requested_model_id",
  "resolved_model_id",
  "actual_model_id",
  "provider_request_id",
  "status",
  "attempt",
  "lease_expires_at",
  "started_at",
  "response_received_at",
  "raw_saved_at",
  "completed_at",
  "failure_category",
  "error_message",
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_tokens",
].join(",");
const OUTBOX_FIELDS =
  "id,event_type,status,delivery_attempts,next_attempt_at,delivered_at,created_at";

export async function findOwnedDiagnosticJob(
  userClient: SupabaseClient,
  jobId: string,
) {
  const { data, error } = await userClient
    .from("document_v2_jobs")
    .select(JOB_FIELDS)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data as DiagnosticJobRow | null;
}

export async function readDocumentDiagnosticSources(input: {
  userClient: SupabaseClient;
  adminClient: SupabaseClient;
  ownedJob: DiagnosticJobRow;
}): Promise<DiagnosticSources> {
  const [eventResult, executionResult, outboxResult] = await Promise.all([
    input.userClient
      .from("document_v2_job_events")
      .select(EVENT_FIELDS)
      .eq("job_id", input.ownedJob.id)
      .order("sequence", { ascending: true })
      .limit(500),
    input.adminClient
      .from("document_v2_model_executions")
      .select(EXECUTION_FIELDS)
      .eq("job_id", input.ownedJob.id)
      .order("created_at", { ascending: true })
      .limit(500),
    input.adminClient
      .from("document_v2_outbox")
      .select(OUTBOX_FIELDS)
      .eq("job_id", input.ownedJob.id)
      .order("created_at", { ascending: true })
      .limit(500),
  ]);
  if (eventResult.error) throw eventResult.error;
  if (executionResult.error) throw executionResult.error;
  if (outboxResult.error) throw outboxResult.error;
  return {
    job: input.ownedJob,
    events: (eventResult.data ?? []) as DiagnosticEventRow[],
    executions: (executionResult.data ?? []) as unknown as DiagnosticExecutionRow[],
    outbox: (outboxResult.data ?? []) as DiagnosticOutboxRow[],
  };
}
