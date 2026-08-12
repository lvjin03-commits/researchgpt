import { z } from "zod";
import {
  GrantDiagnosticConflictSchema,
  GrantDiagnosticRunSchema,
  GrantFindingSchema,
} from "../../diagnostics/contracts.ts";
import type { GrantDiagnosticExecution, GrantDiagnosticRepository } from "../../ports/grant-diagnostic-repository.ts";
import type { GrantHierarchicalDiagnosticExecutionV1, GrantSemanticDiagnosticV3Execution } from "../../ports/grant-diagnostic-repository.ts";
import { GrantNormalizedFindingSchema } from "../../diagnostics/normalized-finding.ts";
import { AssembledGrantSemanticFindingV3Schema } from "../../diagnostics/semantic-v3-assembler.ts";
import { AssembledGrantHierarchicalFindingV1Schema } from "../../diagnostics/hierarchical-finding-assembler.ts";
import { GrantArgumentMapCheckpointV1Schema, GrantHierarchicalContinuityLinkV1Schema } from "../../diagnostics/hierarchical-semantic-contracts.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";
import { GrantSemanticReviewV6CheckpointRecordSchema, GrantSemanticReviewV6FindingDetailSchema } from "../../diagnostics/semantic-review-v6-persistence.ts";
import type { GrantSemanticReviewV6Execution } from "../../ports/grant-diagnostic-repository.ts";

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

  async saveArgumentMapCheckpoint(input: import("../../diagnostics/hierarchical-semantic-contracts.ts").GrantArgumentMapCheckpointV1) {
    const parsed = GrantArgumentMapCheckpointV1Schema.parse(input);
    const { data, error } = await this.client.rpc("save_grant_argument_map_checkpoint", {
      p_owner_id: this.ownerId,
      p_checkpoint: parsed,
    });
    throwRpcError("save_grant_argument_map_checkpoint", error);
    return GrantArgumentMapCheckpointV1Schema.parse(data);
  }

  async findArgumentMapCheckpoint(input: {
    documentId: string;
    sourceRevisionId: string;
    checkerId: string;
    checkerVersion: string;
    inputFingerprint: string;
    locationScopeFingerprint: string;
  }) {
    const { data, error } = await this.client.rpc("find_grant_argument_map_checkpoint", {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_source_revision_id: input.sourceRevisionId,
      p_checker_id: input.checkerId,
      p_checker_version: input.checkerVersion,
      p_input_fingerprint: input.inputFingerprint,
      p_location_scope_fingerprint: input.locationScopeFingerprint,
    });
    throwRpcError("find_grant_argument_map_checkpoint", error);
    return data ? GrantArgumentMapCheckpointV1Schema.parse(data) : null;
  }

  async saveHierarchicalExecution(input: GrantHierarchicalDiagnosticExecutionV1) {
    const parsed = {
      run: GrantDiagnosticRunSchema.parse(input.run),
      findings: z.array(AssembledGrantHierarchicalFindingV1Schema).parse(input.findings),
      argumentMapCheckpoint: GrantArgumentMapCheckpointV1Schema.parse(input.argumentMapCheckpoint),
      continuityLinks: z.array(GrantHierarchicalContinuityLinkV1Schema).parse(input.continuityLinks),
    };
    if (parsed.run.contractVersion !== parsed.argumentMapCheckpoint.contractVersion
      || parsed.run.sourceRevisionId !== parsed.argumentMapCheckpoint.sourceRevisionId
      || parsed.findings.some((finding) => finding.runId !== parsed.run.runId || finding.documentId !== parsed.run.documentId)) {
      throw new Error("Hierarchical diagnostic execution contains mismatched run, Finding or checkpoint identity.");
    }
    const { data, error } = await this.client.rpc("save_grant_hierarchical_diagnostic_execution", {
      p_owner_id: this.ownerId,
      p_document_id: parsed.run.documentId,
      p_run: parsed.run,
      p_findings: parsed.findings,
      p_argument_map_checkpoint: parsed.argumentMapCheckpoint,
      p_continuity_links: parsed.continuityLinks,
    });
    throwRpcError("save_grant_hierarchical_diagnostic_execution", error);
    if (data !== true) throw new Error("Hierarchical diagnostic execution was not persisted.");
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

  async saveSemanticReviewV6Checkpoint(input: import("../../diagnostics/semantic-review-v6-persistence.ts").GrantSemanticReviewV6CheckpointRecord) {
    const parsed = GrantSemanticReviewV6CheckpointRecordSchema.parse(input);
    const { data, error } = await this.client.rpc("save_grant_semantic_review_v6_checkpoint", {
      p_owner_id: this.ownerId,
      p_checkpoint: parsed,
    });
    throwRpcError("save_grant_semantic_review_v6_checkpoint", error);
    return GrantSemanticReviewV6CheckpointRecordSchema.parse(data);
  }

  async findSemanticReviewV6Checkpoint(input: {
    documentId: string;
    sourceRevisionId: string;
    checkerId: string;
    checkerVersion: string;
    inputFingerprint: string;
    locationScopeFingerprint: string;
  }) {
    const { data, error } = await this.client.rpc("find_grant_semantic_review_v6_checkpoint", {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_source_revision_id: input.sourceRevisionId,
      p_checker_id: input.checkerId,
      p_checker_version: input.checkerVersion,
      p_input_fingerprint: input.inputFingerprint,
      p_location_scope_fingerprint: input.locationScopeFingerprint,
    });
    throwRpcError("find_grant_semantic_review_v6_checkpoint", error);
    return data ? GrantSemanticReviewV6CheckpointRecordSchema.parse(data) : null;
  }

  async saveSemanticReviewV6Execution(input: GrantSemanticReviewV6Execution) {
    const parsed = {
      run: GrantDiagnosticRunSchema.parse(input.run),
      findings: z.array(GrantFindingSchema).parse(input.findings),
      findingDetails: z.array(GrantSemanticReviewV6FindingDetailSchema).parse(input.findingDetails),
      checkpoint: GrantSemanticReviewV6CheckpointRecordSchema.parse(input.checkpoint),
    };
    const findingIds = new Set(parsed.findings.map((finding) => finding.findingId));
    if (parsed.run.contractVersion !== parsed.checkpoint.contractVersion
      || parsed.run.sourceRevisionId !== parsed.checkpoint.sourceRevisionId
      || parsed.findings.some((finding) => finding.runId !== parsed.run.runId || finding.documentId !== parsed.run.documentId)
      || parsed.findingDetails.some((detail) => !findingIds.has(detail.findingId))) {
      throw new Error("Semantic Review V6 execution contains mismatched run, Finding or checkpoint identity.");
    }
    const { data, error } = await this.client.rpc("save_grant_semantic_review_v6_execution", {
      p_owner_id: this.ownerId,
      p_document_id: parsed.run.documentId,
      p_run: parsed.run,
      p_findings: parsed.findings,
      p_finding_details: parsed.findingDetails,
      p_checkpoint: parsed.checkpoint,
    });
    throwRpcError("save_grant_semantic_review_v6_execution", error);
    if (data !== true) throw new Error("Semantic Review V6 execution was not persisted.");
    return structuredClone(parsed);
  }
}
