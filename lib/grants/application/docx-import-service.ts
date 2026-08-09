import { GrantEditorService } from "./editor-service.ts";
import type { GrantImportStorage } from "../ports/grant-import-storage.ts";
import { importGrantDocx } from "../imports/docx-importer.ts";

export class GrantDocxImportService {
  constructor(
    private readonly editor: GrantEditorService,
    private readonly storage: GrantImportStorage,
  ) {}

  preview(input: { fileName: string; buffer: Buffer }) {
    return importGrantDocx(input);
  }

  async confirm(input: { ownerId: string; fileName: string; buffer: Buffer }) {
    // Reparse on confirmation: the client cannot promote a tampered preview into canonical content.
    const preview = await importGrantDocx(input);
    const stored = await this.storage.storeOriginal({
      ownerId: input.ownerId,
      buffer: input.buffer,
      checksum: preview.checksum,
    });
    try {
      const aggregate = await this.editor.importDocument({
        ownerId: input.ownerId,
        draft: preview.draft,
        source: {
          fileName: input.fileName,
          checksum: preview.checksum,
          storageBucket: stored.bucket,
          storagePath: stored.path,
          warningCodes: preview.warnings.map((warning) => warning.code),
        },
      });
      return { aggregate, preview };
    } catch (error) {
      await this.storage.remove(stored);
      throw error;
    }
  }
}
