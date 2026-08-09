import { randomUUID } from "node:crypto";
import {
  CanonicalGrantSnapshotSchema,
  GrantAuditEventSchema,
  GrantDocumentDraftSchema,
  GrantDocumentSchema,
  GrantRevisionSchema,
  TemplateSnapshotSchema,
  type CanonicalGrantSnapshot,
  type GrantDocumentDraft,
  type GrantRevisionSummary,
} from "../domain/contracts.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import type {
  GrantAggregate,
  GrantRevisionRepository,
} from "../ports/grant-revision-repository.ts";

export class GrantDocumentNotFoundError extends Error {
  constructor(documentId: string) {
    super(`Grant document ${documentId} was not found.`);
    this.name = "GrantDocumentNotFoundError";
  }
}

export class GrantRevisionConflictError extends Error {
  readonly currentRevisionId: string;

  constructor(currentRevisionId: string) {
    super("The grant document changed after this operation began.");
    this.name = "GrantRevisionConflictError";
    this.currentRevisionId = currentRevisionId;
  }
}

type RevisionServiceDependencies = {
  repository: GrantRevisionRepository;
  createId?: () => string;
  now?: () => string;
};

type CreateDocumentInput = {
  ownerId: string;
  actorId: string;
  draft: GrantDocumentDraft;
  template: {
    templateKey: string;
    templateVersion: string;
    rules: Record<string, unknown>;
  };
  auditMetadata?: Record<string, unknown>;
};

type CommitRevisionInput = {
  documentId: string;
  expectedRevisionId: string;
  actorId: string;
  actorKind: "user" | "system" | "ai";
  snapshot: CanonicalGrantSnapshot;
  reason: string;
  auditMetadata?: Record<string, unknown>;
  evidencePatchProposalId?: string;
};

type RestoreRevisionInput = {
  documentId: string;
  expectedRevisionId: string;
  sourceRevisionId: string;
  actorId: string;
};

export class GrantRevisionService {
  private readonly repository: GrantRevisionRepository;
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor({ repository, createId = randomUUID, now = () => new Date().toISOString() }: RevisionServiceDependencies) {
    this.repository = repository;
    this.createId = createId;
    this.now = now;
  }

  async createDocument(input: CreateDocumentInput): Promise<GrantAggregate> {
    const draft = GrantDocumentDraftSchema.parse(input.draft);
    const timestamp = this.now();
    const documentId = this.createId();
    const templateSnapshotId = this.createId();
    const revisionId = this.createId();
    const snapshot = this.materializeDraft(draft);
    const templateSnapshot = TemplateSnapshotSchema.parse({
      templateSnapshotId,
      ownerId: input.ownerId,
      templateKey: input.template.templateKey,
      templateVersion: input.template.templateVersion,
      rules: input.template.rules,
      checksum: sha256Canonical(input.template),
      createdAt: timestamp,
    });
    const revision = GrantRevisionSchema.parse({
      revisionId,
      documentId,
      revisionNumber: 1,
      templateSnapshotId,
      contentHash: sha256Canonical(snapshot),
      snapshot,
      createdBy: input.actorId,
      createdAt: timestamp,
    });
    const document = GrantDocumentSchema.parse({
      documentId,
      ownerId: input.ownerId,
      title: draft.title,
      templateSnapshotId,
      currentRevisionId: revisionId,
      currentRevisionNumber: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const auditEvent = GrantAuditEventSchema.parse({
      auditEventId: this.createId(),
      documentId,
      revisionId,
      actorId: input.actorId,
      actorKind: "user",
      eventType: "document_created",
      metadata: {
        ...input.auditMetadata,
        templateKey: input.template.templateKey,
        templateVersion: input.template.templateVersion,
      },
      createdAt: timestamp,
    });
    return this.repository.create({ document, currentRevision: revision, templateSnapshot, auditEvent });
  }

  async listDocuments() {
    return this.repository.listDocuments();
  }

  async getDocument(documentId: string): Promise<GrantAggregate> {
    const aggregate = await this.repository.get(documentId);
    if (!aggregate) throw new GrantDocumentNotFoundError(documentId);
    return aggregate;
  }

  async listRevisionHistory(documentId: string): Promise<GrantRevisionSummary[]> {
    await this.getDocument(documentId);
    return this.repository.listRevisions(documentId);
  }

  async listAuditEvents(documentId: string) {
    await this.getDocument(documentId);
    return this.repository.listAuditEvents(documentId);
  }

  async getRevision(documentId: string, revisionId: string) {
    await this.getDocument(documentId);
    const revision = await this.repository.getRevision(documentId, revisionId);
    if (!revision) throw new GrantDocumentNotFoundError(documentId);
    return revision;
  }

  async restoreRevision(input: RestoreRevisionInput): Promise<GrantAggregate> {
    const source = await this.repository.getRevision(input.documentId, input.sourceRevisionId);
    if (!source) throw new GrantDocumentNotFoundError(input.documentId);
    return this.commitRevision({
      documentId: input.documentId,
      expectedRevisionId: input.expectedRevisionId,
      actorId: input.actorId,
      actorKind: "user",
      snapshot: source.snapshot,
      reason: `restore_revision:${source.revisionId}`,
    });
  }

  async commitRevision(input: CommitRevisionInput): Promise<GrantAggregate> {
    const current = await this.repository.get(input.documentId);
    if (!current) throw new GrantDocumentNotFoundError(input.documentId);
    if (current.document.currentRevisionId !== input.expectedRevisionId) {
      throw new GrantRevisionConflictError(current.document.currentRevisionId);
    }
    const snapshot = CanonicalGrantSnapshotSchema.parse(input.snapshot);
    const timestamp = this.now();
    const revisionId = this.createId();
    const revision = GrantRevisionSchema.parse({
      revisionId,
      documentId: current.document.documentId,
      revisionNumber: current.document.currentRevisionNumber + 1,
      parentRevisionId: current.document.currentRevisionId,
      templateSnapshotId: current.document.templateSnapshotId,
      contentHash: sha256Canonical(snapshot),
      snapshot,
      createdBy: input.actorId,
      createdAt: timestamp,
    });
    const auditEvent = GrantAuditEventSchema.parse({
      auditEventId: this.createId(),
      documentId: current.document.documentId,
      revisionId,
      actorId: input.actorId,
      actorKind: input.actorKind,
      eventType: "revision_committed",
      metadata: {
        ...input.auditMetadata,
        reason: input.reason,
        parentRevisionId: current.document.currentRevisionId,
      },
      createdAt: timestamp,
    });
    const result = await this.repository.compareAndSwap({
      documentId: input.documentId,
      expectedRevisionId: input.expectedRevisionId,
      revision,
      auditEvent,
      evidencePatchProposalId: input.evidencePatchProposalId,
    });
    if (result.status === "revision_conflict") {
      throw new GrantRevisionConflictError(result.currentRevisionId);
    }
    return result.aggregate;
  }

  private materializeDraft(draft: GrantDocumentDraft): CanonicalGrantSnapshot {
    const sectionIdByLocalKey = new Map(draft.sections.map((section) => [section.localKey, this.createId()]));
    const nodes: CanonicalGrantSnapshot["nodes"] = [];
    const sections: CanonicalGrantSnapshot["sections"] = draft.sections.map((section) => {
      const sectionId = sectionIdByLocalKey.get(section.localKey)!;
      const nodeIds = section.nodes.map((node, order) => {
        const nodeId = this.createId();
        nodes.push({
          nodeId,
          sectionId,
          order,
          nodeType: node.nodeType,
          content: node.content,
        } as CanonicalGrantSnapshot["nodes"][number]);
        return nodeId;
      });
      return {
        sectionId,
        semanticRole: section.semanticRole,
        title: section.title,
        parentSectionId: section.parentLocalKey ? sectionIdByLocalKey.get(section.parentLocalKey) : undefined,
        order: section.order,
        nodeIds,
      };
    });
    return CanonicalGrantSnapshotSchema.parse({
      schemaVersion: "grant-canonical-v1",
      title: draft.title,
      sections,
      nodes,
    });
  }
}
