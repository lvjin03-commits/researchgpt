import { z } from "zod";
import {
  GrantDiagnosticConflictSchema,
  GrantDiagnosticRunSchema,
  GrantFindingSchema,
} from "../../diagnostics/contracts.ts";
import type { GrantDiagnosticExecution, GrantDiagnosticRepository } from "../../ports/grant-diagnostic-repository.ts";
import type { GrantSemanticDiagnosticV3Execution } from "../../ports/grant-diagnostic-repository.ts";
import { GrantNormalizedFindingSchema } from "../../diagnostics/normalized-finding.ts";
import { AssembledGrantSemanticFindingV3Schema } from "../../diagnostics/semantic-v3-assembler.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

type RpcError = { message: string };

function throwRpcError(operation: string, error: RpcError | null): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

const ExecutionSchema = z.object({
  runs: z.array(GrantDiagnosticRunSchema),
  findings: z.array(GrantFindingSchema),
  conflicts: z.array(GrantDiagnosticConflictSchema),
}).strict();

export class SupabaseGrantDiagnosticRepository implements GrantDiagnosticRepository {
  constructor(private readonly client: GrantSupabaseRpcClient, private readonly ownerId: string) {}

  async saveExecution(input: GrantDiagnosticExecution) {
    const parsed = ExecutionSchema.parse(input);
    const documentId = parsed.runs[0]?.documentId ?? parsed.findings[0]?.documentId;
    if (!documentId) throw new Error("Diagnostic execution requires at least one checker run.");
    const { data, error } = await this.client.rpc("save_grant_diagnostic_execution", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
      p_runs: parsed.runs,
      p_findings: parsed.findings,
      p_conflicts: parsed.conflicts,
    });
    throwRpcError("save_grant_diagnostic_execution", error);
    if (data !== true) throw new Error("Diagnostic execution was not persisted.");
    return structuredClone(parsed);
  }

  async listFindings(documentId: string) {
    const { data, error } = await this.client.rpc("list_grant_findings", { p_owner_id: this.ownerId, p_document_id: documentId });
    throwRpcError("list_grant_findings", error);
    return z.array(GrantFindingSchema).parse(data ?? []);
  }

  async listConflicts(documentId: string) {
    const { data, error } = await this.client.rpc("list_grant_diagnostic_conflicts", { p_owner_id: this.ownerId, p_document_id: documentId });
    throwRpcError("list_grant_diagnostic_conflicts", error);
    return z.array(GrantDiagnosticConflictSchema).parse(data ?? []);
  }

  async listRuns(documentId: string) {
    const { data, error } = await this.client.rpc("list_grant_diagnostic_runs", { p_owner_id: this.ownerId, p_document_id: documentId });
    throwRpcError("list_grant_diagnostic_runs", error);
    return z.array(GrantDiagnosticRunSchema).parse(data ?? []);
  }

  async saveSemanticV3Execution(input: GrantSemanticDiagnosticV3Execution) {
    const parsed = {
      run: GrantDiagnosticRunSchema.parse(input.run),
      findings: z.array(AssembledGrantSemanticFindingV3Schema).parse(input.findings),
    };
    if (parsed.findings.some((finding) => finding.runId !== parsed.run.runId || finding.documentId !== parsed.run.documentId)) {
      throw new Error("Semantic V3 execution contains a Finding outside its run.");
    }
    const { data, error } = await this.client.rpc("save_grant_semantic_v3_execution", {
      p_owner_id: this.ownerId,
      p_document_id: parsed.run.documentId,
      p_run: parsed.run,
      p_findings: parsed.findings,
    });
    throwRpcError("save_grant_semantic_v3_execution", error);
    if (data !== true) throw new Error("Semantic V3 execution was not persisted.");
    return structuredClone(parsed);
  }

  async listNormalizedFindings(documentId: string) {
    const { data, error } = await this.client.rpc("list_grant_normalized_findings", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
    });
    throwRpcError("list_grant_normalized_findings", error);
    return z.array(GrantNormalizedFindingSchema).parse(data ?? []);
  }
}
