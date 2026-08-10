import { z } from "zod";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantImportedFigureAsset } from "../domain/figure-assets.ts";
import type { GrantFigureAssetReader } from "../ports/grant-figure-asset-reader.ts";
import { GrantRevisionService } from "./revision-service.ts";

const BrowserDisplayMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const GrantFigureDisplayAssetSchema = z.discriminatedUnion("status", [
  z.object({
    assetId: z.string().uuid(),
    status: z.literal("ready"),
    mediaType: BrowserDisplayMediaTypeSchema,
    widthPx: z.number().int().positive().nullable(),
    heightPx: z.number().int().positive().nullable(),
    readUrl: z.string().url(),
  }).strict(),
  z.object({
    assetId: z.string().uuid(),
    status: z.literal("unsupported_format"),
    mediaType: z.string().trim().min(1),
    widthPx: z.number().int().positive().nullable(),
    heightPx: z.number().int().positive().nullable(),
  }).strict(),
  z.object({
    assetId: z.string().uuid(),
    status: z.literal("unavailable"),
  }).strict(),
]);

export type GrantFigureDisplayAsset = z.infer<typeof GrantFigureDisplayAssetSchema>;

export class GrantFigureDisplayService {
  private readonly revisions: GrantRevisionService;
  private readonly reader: GrantFigureAssetReader;

  constructor(revisions: GrantRevisionService, reader: GrantFigureAssetReader) {
    this.revisions = revisions;
    this.reader = reader;
  }

  async listForSnapshot(
    documentId: string,
    snapshot: CanonicalGrantSnapshot,
  ): Promise<GrantFigureDisplayAsset[]> {
    const referencedAssetIds = snapshot.nodes.flatMap((node) =>
      node.nodeType === "figure" ? [node.content.assetId] : []);
    if (referencedAssetIds.length === 0) return [];

    const assets = await this.revisions.listImportedFigureAssets(documentId);
    const assetsById = new Map(assets.map((asset) => [asset.assetId, asset]));
    return Promise.all(referencedAssetIds.map(async (assetId) => {
      const asset = assetsById.get(assetId);
      if (!asset) return GrantFigureDisplayAssetSchema.parse({ assetId, status: "unavailable" });
      return this.resolveAsset(asset);
    }));
  }

  private async resolveAsset(asset: GrantImportedFigureAsset): Promise<GrantFigureDisplayAsset> {
    const mediaType = BrowserDisplayMediaTypeSchema.safeParse(asset.mediaType);
    if (!mediaType.success) {
      return GrantFigureDisplayAssetSchema.parse({
        assetId: asset.assetId,
        status: "unsupported_format",
        mediaType: asset.mediaType,
        widthPx: asset.widthPx,
        heightPx: asset.heightPx,
      });
    }
    try {
      return GrantFigureDisplayAssetSchema.parse({
        assetId: asset.assetId,
        status: "ready",
        mediaType: mediaType.data,
        widthPx: asset.widthPx,
        heightPx: asset.heightPx,
        readUrl: await this.reader.createTemporaryReadUrl(asset),
      });
    } catch (error) {
      console.warn("[grant-figure-display] Temporary read URL unavailable", {
        assetId: asset.assetId,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return GrantFigureDisplayAssetSchema.parse({ assetId: asset.assetId, status: "unavailable" });
    }
  }
}
