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
  content_input_fingerprint: string | null;
  generation_config_fingerprint: string | null;
  attempt_number: number;
  parent_execution_key: string | null;
  escalation_reason: string | null;
  budget_escalation_count: number;
  expected_output_tokens: number | null;
  model_physical_max_output_tokens: number | null;
  product_max_output_tokens: number | null;
  operation_hard_max_output_tokens: number | null;
  generation_budget_policy_version: string | null;
  model_capability_version: string | null;
  provider: string;
  requested_model_id: string;
  resolved_model_id: string;
  requested_reasoning_effort: string | null;
  effective_reasoning_effort: string | null;
  reasoning_tokens_observed: boolean;
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
  finish_reason: string | null;
  choice_count: number;
  content_state: string | null;
  content_length: number;
  reasoning_content_present: boolean;
  reasoning_content_length: number;
  auxiliary_content_hash: string | null;
  auxiliary_content_length: number;
  auxiliary_content_types: unknown;
  response_source: string | null;
  recovery_mode: string | null;
  requested_max_tokens: number | null;
  effective_max_tokens: number | null;
  visible_output_tokens: number | null;
  refusal_present: boolean;
  tool_call_count: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  calculated_cost_usd: number | null;
  pricing_version: string | null;
  cost_status: string | null;
  raw_content_hash: string | null;
  sanitized_preview: string | null;
  provider_response_saved_at: string | null;
  parse_started_at: string | null;
  parse_completed_at: string | null;
  parse_status: string | null;
  parse_error_message: string | null;
  parse_error_position: number | null;
  candidate_count: number;
  json_valid_candidate_count: number;
  schema_valid_candidate_count: number;
  repair_steps: unknown;
  candidate_diagnostics: unknown;
  parser_version: string | null;
  repair_pipeline_version: string | null;
  schema_version: string | null;
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
  "content_input_fingerprint",
  "generation_config_fingerprint",
  "attempt_number",
  "parent_execution_key",
  "escalation_reason",
  "budget_escalation_count",
  "expected_output_tokens",
  "model_physical_max_output_tokens",
  "product_max_output_tokens",
  "operation_hard_max_output_tokens",
  "generation_budget_policy_version",
  "model_capability_version",
  "provider",
  "requested_model_id",
  "resolved_model_id",
  "requested_reasoning_effort",
  "effective_reasoning_effort",
  "reasoning_tokens_observed",
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
  "finish_reason",
  "choice_count",
  "content_state",
  "content_length",
  "reasoning_content_present",
  "reasoning_content_length",
  "auxiliary_content_hash",
  "auxiliary_content_length",
  "auxiliary_content_types",
  "response_source",
  "recovery_mode",
  "requested_max_tokens",
  "effective_max_tokens",
  "visible_output_tokens",
  "refusal_present",
  "tool_call_count",
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "calculated_cost_usd",
  "pricing_version",
  "cost_status",
  "raw_content_hash",
  "sanitized_preview",
  "provider_response_saved_at",
  "parse_started_at",
  "parse_completed_at",
  "parse_status",
  "parse_error_message",
  "parse_error_position",
  "candidate_count",
  "json_valid_candidate_count",
  "schema_valid_candidate_count",
  "repair_steps",
  "candidate_diagnostics",
  "parser_version",
  "repair_pipeline_version",
  "schema_version",
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
