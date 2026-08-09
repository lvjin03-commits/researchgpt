import { z } from "zod";
import {
  GrantAuditEventSchema,
  GrantDocumentSchema,
  GrantRevisionSchema,
  GrantRevisionSummarySchema,
  TemplateSnapshotSchema,
} from "../../domain/contracts.ts";
import type {
  CommitGrantRevisionInput,
  CommitGrantRevisionResult,
  CreateGrantAggregateInput,
  GrantAggregate,
  GrantRevisionRepository,
} from "../../ports/grant-revision-repository.ts";

type RpcError = { message: string };
type RpcResult = PromiseLike<{ data: unknown; error: RpcError | null }>;

export type GrantSupabaseRpcClient = {
  rpc(name: string, arguments_: Record<string, unknown>): RpcResult;
};

const AggregateSchema = z.object({
  document: GrantDocumentSchema,
  currentRevision: GrantRevisionSchema,
  templateSnapshot: TemplateSnapshotSchema,
}).strict();

function throwRpcError(operation: string, error: RpcError | null): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

export class SupabaseGrantRevisionRepository implements GrantRevisionRepository {
  private readonly client: GrantSupabaseRpcClient;
  private readonly ownerId: string;

  constructor(client: GrantSupabaseRpcClient, ownerId: string) {
    this.client = client;
    this.ownerId = ownerId;
  }

  async create(input: CreateGrantAggregateInput): Promise<GrantAggregate> {
    if (input.document.ownerId !== this.ownerId) {
      throw new Error("Grant repository owner mismatch.");
    }
    const { error } = await this.client.rpc("create_grant_document_foundation", {
      p_owner_id: this.ownerId,
      p_document_id: input.document.documentId,
      p_title: input.document.title,
      p_template_snapshot_id: input.templateSnapshot.templateSnapshotId,
      p_template_key: input.templateSnapshot.templateKey,
      p_template_version: input.templateSnapshot.templateVersion,
      p_template_rules: input.templateSnapshot.rules,
      p_template_checksum: input.templateSnapshot.checksum,
      p_revision_id: input.currentRevision.revisionId,
      p_content_hash: input.currentRevision.contentHash,
      p_snapshot: input.currentRevision.snapshot,
      p_actor_id: input.auditEvent.actorId,
      p_audit_event_id: input.auditEvent.auditEventId,
      p_audit_metadata: input.auditEvent.metadata,
    });
    throwRpcError("create_grant_document_foundation", error);
    return structuredClone({
      document: input.document,
      currentRevision: input.currentRevision,
      templateSnapshot: input.templateSnapshot,
    });
  }

  async get(documentId: string): Promise<GrantAggregate | null> {
    const { data, error } = await this.client.rpc("get_grant_document_aggregate", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
    });
    throwRpcError("get_grant_document_aggregate", error);
    if (data === null) return null;
    return AggregateSchema.parse(data);
  }

  async listDocuments() {
    const { data, error } = await this.client.rpc("list_grant_documents", { p_owner_id: this.ownerId });
    throwRpcError("list_grant_documents", error);
    return z.array(GrantDocumentSchema).parse(data ?? []);
  }

  async getRevision(documentId: string, revisionId: string) {
    const { data, error } = await this.client.rpc("get_grant_document_revision", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
      p_revision_id: revisionId,
    });
    throwRpcError("get_grant_document_revision", error);
    return data === null ? null : GrantRevisionSchema.parse(data);
  }

  async listRevisions(documentId: string) {
    const { data, error } = await this.client.rpc("list_grant_document_revisions", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
    });
    throwRpcError("list_grant_document_revisions", error);
    return z.array(GrantRevisionSummarySchema).parse(data ?? []);
  }

  async compareAndSwap(input: CommitGrantRevisionInput): Promise<CommitGrantRevisionResult> {
    const operation = input.evidencePatchProposalId
      ? "commit_grant_evidence_patch_revision"
      : "commit_grant_document_revision";
    const arguments_: Record<string, unknown> = {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_expected_revision_id: input.expectedRevisionId,
      p_revision_id: input.revision.revisionId,
      p_content_hash: input.revision.contentHash,
      p_snapshot: input.revision.snapshot,
      p_actor_id: input.auditEvent.actorId,
      p_actor_kind: input.auditEvent.actorKind,
      p_audit_event_id: input.auditEvent.auditEventId,
      p_audit_metadata: input.auditEvent.metadata,
    };
    if (input.evidencePatchProposalId) {
      arguments_.p_proposal_id = input.evidencePatchProposalId;
    }
    const { data, error } = await this.client.rpc(operation, arguments_);
    throwRpcError(operation, error);
    const current = await this.get(input.documentId);
    if (!current) throw new Error("Committed grant document could not be reloaded.");
    if (data !== true) {
      return { status: "revision_conflict", currentRevisionId: current.document.currentRevisionId };
    }
    return { status: "committed", aggregate: current };
  }

  async listAuditEvents(documentId: string) {
    const { data, error } = await this.client.rpc("list_grant_audit_events", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
    });
    throwRpcError("list_grant_audit_events", error);
    return z.array(GrantAuditEventSchema).parse(data ?? []);
  }
}
