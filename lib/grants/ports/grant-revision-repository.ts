import type {
  GrantAuditEvent,
  GrantDocument,
  GrantRevision,
  GrantRevisionSummary,
  TemplateSnapshot,
} from "../domain/contracts.ts";
import type { GrantImportedFigureAsset } from "../domain/figure-assets.ts";

export type GrantAggregate = {
  document: GrantDocument;
  currentRevision: GrantRevision;
  templateSnapshot: TemplateSnapshot;
};

export type CreateGrantAggregateInput = GrantAggregate & {
  auditEvent: GrantAuditEvent;
  figureAssets: GrantImportedFigureAsset[];
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

export type ArchiveGrantDocumentInput = {
  documentId: string;
  expectedRevisionId: string;
  auditEvent: GrantAuditEvent;
};

export type ArchiveGrantDocumentResult =
  | { status: "archived" }
  | { status: "revision_conflict"; currentRevisionId: string }
  | { status: "not_found" };

export interface GrantRevisionRepository {
  create(input: CreateGrantAggregateInput): Promise<GrantAggregate>;
  listFigureAssets(documentId: string): Promise<GrantImportedFigureAsset[]>;
  listDocuments(): Promise<GrantDocument[]>;
  get(documentId: string): Promise<GrantAggregate | null>;
  getRevision(documentId: string, revisionId: string): Promise<GrantRevision | null>;
  listRevisions(documentId: string): Promise<GrantRevisionSummary[]>;
  compareAndSwap(input: CommitGrantRevisionInput): Promise<CommitGrantRevisionResult>;
  archive(input: ArchiveGrantDocumentInput): Promise<ArchiveGrantDocumentResult>;
  listAuditEvents(documentId: string): Promise<GrantAuditEvent[]>;
}
