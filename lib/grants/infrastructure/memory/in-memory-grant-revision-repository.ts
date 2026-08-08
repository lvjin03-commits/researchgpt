import type {
  CreateGrantAggregateInput,
  GrantAggregate,
  GrantRevisionRepository,
  CommitGrantRevisionInput,
  CommitGrantRevisionResult,
} from "../../ports/grant-revision-repository.ts";
import type { GrantAuditEvent, GrantRevision } from "../../domain/contracts.ts";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryGrantRevisionRepository implements GrantRevisionRepository {
  private readonly aggregates = new Map<string, GrantAggregate>();
  private readonly audits = new Map<string, GrantAuditEvent[]>();
  private readonly revisions = new Map<string, GrantRevision[]>();
  private commitQueue: Promise<void> = Promise.resolve();

  async create(input: CreateGrantAggregateInput): Promise<GrantAggregate> {
    if (this.aggregates.has(input.document.documentId)) {
      throw new Error("Grant document already exists.");
    }
    const aggregate = clone({
      document: input.document,
      currentRevision: input.currentRevision,
      templateSnapshot: input.templateSnapshot,
    });
    this.aggregates.set(input.document.documentId, aggregate);
    this.audits.set(input.document.documentId, [clone(input.auditEvent)]);
    this.revisions.set(input.document.documentId, [clone(input.currentRevision)]);
    return clone(aggregate);
  }

  async listDocuments() {
    return clone([...this.aggregates.values()].map((aggregate) => aggregate.document));
  }

  async getRevision(documentId: string, revisionId: string) {
    const revision = this.revisions.get(documentId)?.find((candidate) => candidate.revisionId === revisionId);
    return revision ? clone(revision) : null;
  }

  async listRevisions(documentId: string) {
    return clone((this.revisions.get(documentId) ?? [])
      .map((revision) => ({
        revisionId: revision.revisionId,
        documentId: revision.documentId,
        revisionNumber: revision.revisionNumber,
        parentRevisionId: revision.parentRevisionId,
        templateSnapshotId: revision.templateSnapshotId,
        contentHash: revision.contentHash,
        createdBy: revision.createdBy,
        createdAt: revision.createdAt,
      }))
      .sort((left, right) => right.revisionNumber - left.revisionNumber));
  }

  async get(documentId: string): Promise<GrantAggregate | null> {
    const aggregate = this.aggregates.get(documentId);
    return aggregate ? clone(aggregate) : null;
  }

  async compareAndSwap(input: CommitGrantRevisionInput): Promise<CommitGrantRevisionResult> {
    const previousCommit = this.commitQueue;
    let releaseCommit!: () => void;
    this.commitQueue = new Promise<void>((resolve) => { releaseCommit = resolve; });
    await previousCommit;
    try {
      const current = this.aggregates.get(input.documentId);
      if (!current) throw new Error("Grant document does not exist.");
      if (current.document.currentRevisionId !== input.expectedRevisionId) {
        return { status: "revision_conflict", currentRevisionId: current.document.currentRevisionId };
      }
      const aggregate: GrantAggregate = {
        document: {
          ...current.document,
          title: input.revision.snapshot.title,
          currentRevisionId: input.revision.revisionId,
          currentRevisionNumber: input.revision.revisionNumber,
          updatedAt: input.revision.createdAt,
        },
        currentRevision: input.revision,
        templateSnapshot: current.templateSnapshot,
      };
      this.aggregates.set(input.documentId, clone(aggregate));
      this.audits.set(input.documentId, [...(this.audits.get(input.documentId) ?? []), clone(input.auditEvent)]);
      this.revisions.set(input.documentId, [...(this.revisions.get(input.documentId) ?? []), clone(input.revision)]);
      return { status: "committed", aggregate: clone(aggregate) };
    } finally {
      releaseCommit();
    }
  }

  async listAuditEvents(documentId: string): Promise<GrantAuditEvent[]> {
    return clone(this.audits.get(documentId) ?? []);
  }
}
