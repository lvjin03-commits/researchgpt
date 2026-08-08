import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import { estimateGrantLength } from "./length-estimator.ts";
import { GrantRevisionService } from "./revision-service.ts";
import { createNsfcDraft, NSFC_DEFAULT_TEMPLATE } from "../templates/nsfc-default.ts";

export class GrantEditorService {
  constructor(private readonly revisions: GrantRevisionService) {}

  async listDocuments() {
    return this.revisions.listDocuments();
  }

  async createDocument(input: { ownerId: string; title: string }) {
    return this.revisions.createDocument({
      ownerId: input.ownerId,
      actorId: input.ownerId,
      draft: createNsfcDraft(input.title),
      template: NSFC_DEFAULT_TEMPLATE,
    });
  }

  async loadDocument(documentId: string) {
    const aggregate = await this.revisions.getDocument(documentId);
    return {
      aggregate,
      estimate: estimateGrantLength(aggregate.currentRevision.snapshot, aggregate.templateSnapshot.rules),
      revisionHistory: await this.revisions.listRevisionHistory(documentId),
    };
  }

  async saveDocument(input: {
    documentId: string;
    expectedRevisionId: string;
    actorId: string;
    snapshot: CanonicalGrantSnapshot;
  }) {
    const aggregate = await this.revisions.commitRevision({
      ...input,
      actorKind: "user",
      reason: "editor_autosave",
    });
    return {
      aggregate,
      estimate: estimateGrantLength(aggregate.currentRevision.snapshot, aggregate.templateSnapshot.rules),
      revisionHistory: await this.revisions.listRevisionHistory(input.documentId),
    };
  }

  async restoreRevision(input: {
    documentId: string;
    expectedRevisionId: string;
    sourceRevisionId: string;
    actorId: string;
  }) {
    const aggregate = await this.revisions.restoreRevision(input);
    return {
      aggregate,
      estimate: estimateGrantLength(aggregate.currentRevision.snapshot, aggregate.templateSnapshot.rules),
      revisionHistory: await this.revisions.listRevisionHistory(input.documentId),
    };
  }
}
