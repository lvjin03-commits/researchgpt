import type {
  GrantAuditEvent,
  GrantDocument,
  GrantRevision,
  GrantRevisionSummary,
  TemplateSnapshot,
} from "../domain/contracts.ts";

export type GrantAggregate = {
  document: GrantDocument;
  currentRevision: GrantRevision;
  templateSnapshot: TemplateSnapshot;
};

export type CreateGrantAggregateInput = GrantAggregate & {
  auditEvent: GrantAuditEvent;
};

export type CommitGrantRevisionInput = {
  documentId: string;
  expectedRevisionId: string;
  revision: GrantRevision;
  auditEvent: GrantAuditEvent;
  evidencePatchProposalId?: string;
};

export type CommitGrantRevisionResult =
  | { status: "committed"; aggregate: GrantAggregate }
  | { status: "revision_conflict"; currentRevisionId: string };

export interface GrantRevisionRepository {
  create(input: CreateGrantAggregateInput): Promise<GrantAggregate>;
  listDocuments(): Promise<GrantDocument[]>;
  get(documentId: string): Promise<GrantAggregate | null>;
  getRevision(documentId: string, revisionId: string): Promise<GrantRevision | null>;
  listRevisions(documentId: string): Promise<GrantRevisionSummary[]>;
  compareAndSwap(input: CommitGrantRevisionInput): Promise<CommitGrantRevisionResult>;
  listAuditEvents(documentId: string): Promise<GrantAuditEvent[]>;
}
