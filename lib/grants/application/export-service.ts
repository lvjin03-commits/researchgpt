import type { GrantDocxRenderer } from "../ports/grant-docx-renderer.ts";
import { GrantRevisionService } from "./revision-service.ts";

export class GrantExportService {
  constructor(
    private readonly revisions: GrantRevisionService,
    private readonly renderer: GrantDocxRenderer,
  ) {}

  async exportCurrentDocx(documentId: string) {
    const aggregate = await this.revisions.getDocument(documentId);
    return this.renderer.render({
      documentId,
      revisionId: aggregate.currentRevision.revisionId,
      snapshot: aggregate.currentRevision.snapshot,
      templateSnapshot: aggregate.templateSnapshot,
    });
  }
}
