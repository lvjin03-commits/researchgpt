import type { GrantImportedFigureAsset } from "../domain/figure-assets.ts";

export interface GrantFigureAssetReader {
  createTemporaryReadUrl(asset: GrantImportedFigureAsset): Promise<string>;
  readBytes(asset: GrantImportedFigureAsset): Promise<Uint8Array>;
}
