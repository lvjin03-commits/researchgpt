import type { CanonicalGrantSnapshot, GrantDocumentDraft } from "../domain/contracts.ts";
import type { GrantImportedFigureAssetDraft } from "../domain/figure-assets.ts";
import { estimateGrantLength } from "./length-estimator.ts";
import { GrantRevisionService } from "./revision-service.ts";
import { createNsfcDraft, NSFC_DEFAULT_TEMPLATE } from "../templates/nsfc-default.ts";
import type { GrantFigureDisplayService } from "./figure-display-service.ts";
import type { GrantAggregate } from "../ports/grant-revision-repository.ts";

export class GrantEditorService {
  constructor(
    private readonly revisions: GrantRevisionService,
    private readonly figureDisplay?: GrantFigureDisplayService,
  ) {}

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

  async deleteDocument(input: { documentId: string; expectedRevisionId: string; actorId: string }) {
    await this.revisions.archiveDocument(input);
  }

  async importDocument(input: {
    ownerId: string;
    draft: GrantDocumentDraft;
    figureAssets?: GrantImportedFigureAssetDraft[];
    source: { fileName: string; checksum: string; storageBucket: string; storagePath: string; warningCodes: string[] };
  }) {
    return this.revisions.createDocument({
      ownerId: input.ownerId,
      actorId: input.ownerId,
      draft: input.draft,
      importedFigureAssets: input.figureAssets,
      template: NSFC_DEFAULT_TEMPLATE,
      auditMetadata: {
        creationMode: "docx_import",
        sourceFileName: input.source.fileName,
        sourceChecksum: input.source.checksum,
        sourceStorageBucket: input.source.storageBucket,
        sourceStoragePath: input.source.storagePath,
        importWarningCodes: input.source.warningCodes,
      },
    });
  }

  async loadDocument(documentId: string) {
    const aggregate = await this.revisions.getDocument(documentId);
    return this.presentDocument(aggregate);
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
      reason: "editor_user_save",
    });
    return this.presentDocument(aggregate);
  }

  async restoreRevision(input: {
    documentId: string;
    expectedRevisionId: string;
    sourceRevisionId: string;
    actorId: string;
  }) {
    const aggregate = await this.revisions.restoreRevision(input);
    return this.presentDocument(aggregate);
  }

  private async presentDocument(aggregate: GrantAggregate) {
    return {
      aggregate,
      figureAssets: this.figureDisplay
        ? await this.figureDisplay.listForSnapshot(
          aggregate.document.documentId,
          aggregate.currentRevision.snapshot,
        )
        : [],
      estimate: estimateGrantLength(aggregate.currentRevision.snapshot, aggregate.templateSnapshot.rules),
      revisionHistory: await this.revisions.listRevisionHistory(aggregate.document.documentId),
    };
  }
}
