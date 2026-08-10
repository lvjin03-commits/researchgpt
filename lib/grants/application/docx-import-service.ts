import { GrantEditorService } from "./editor-service.ts";
import type { GrantImportStorage } from "../ports/grant-import-storage.ts";
import { importGrantDocx, prepareGrantDocxImport } from "../imports/docx-importer.ts";

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
    const prepared = await prepareGrantDocxImport(input);
    const cleanup: Array<{ bucket: string; path: string }> = [];
    try {
      const stored = await this.storage.storeOriginal({
        ownerId: input.ownerId,
        buffer: input.buffer,
        checksum: prepared.preview.checksum,
      });
      cleanup.push(stored);
      const storedFigures = await this.storage.storeFigures({
        ownerId: input.ownerId,
        figures: prepared.figures.map((figure) => ({
          assetId: figure.assetId,
          contentHash: figure.contentHash,
          mediaType: figure.mediaType,
          buffer: figure.buffer,
        })),
      });
      cleanup.push(...storedFigures);
      const storedByAssetId = new Map(storedFigures.map((figure) => [figure.assetId, figure]));
      const aggregate = await this.editor.importDocument({
        ownerId: input.ownerId,
        draft: prepared.preview.draft,
        figureAssets: prepared.figures.map((figure) => {
          const storage = storedByAssetId.get(figure.assetId);
          if (!storage) throw new Error(`Stored grant figure ${figure.assetId} is missing.`);
          return {
            assetId: figure.assetId,
            sourceDocumentChecksum: figure.sourceDocumentChecksum,
            contentHash: figure.contentHash,
            mediaType: figure.mediaType,
            byteSize: figure.byteSize,
            widthPx: figure.widthPx,
            heightPx: figure.heightPx,
            anchor: figure.anchor,
            storage: { bucket: storage.bucket, path: storage.path },
          };
        }),
        source: {
          fileName: input.fileName,
          checksum: prepared.preview.checksum,
          storageBucket: stored.bucket,
          storagePath: stored.path,
          warningCodes: prepared.preview.warnings.map((warning) => warning.code),
        },
      });
      return { aggregate, preview: prepared.preview };
    } catch (error) {
      await Promise.allSettled(cleanup.map((item) => this.storage.remove(item)));
      throw error;
    }
  }
}
