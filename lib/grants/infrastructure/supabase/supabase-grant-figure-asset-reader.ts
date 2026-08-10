import type { SupabaseClient } from "@supabase/supabase-js";
import type { GrantImportedFigureAsset } from "../../domain/figure-assets.ts";
import type { GrantFigureAssetReader } from "../../ports/grant-figure-asset-reader.ts";

const READ_URL_TTL_SECONDS = 60 * 60;

export class SupabaseGrantFigureAssetReader implements GrantFigureAssetReader {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async createTemporaryReadUrl(asset: GrantImportedFigureAsset): Promise<string> {
    const { data, error } = await this.client.storage
      .from(asset.storage.bucket)
      .createSignedUrl(asset.storage.path, READ_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error("Grant figure temporary read URL could not be created.");
    }
    return data.signedUrl;
  }

  async readBytes(asset: GrantImportedFigureAsset): Promise<Uint8Array> {
    const { data, error } = await this.client.storage
      .from(asset.storage.bucket)
      .download(asset.storage.path);
    if (error || !data) throw new Error("Grant figure bytes could not be read.");
    return new Uint8Array(await data.arrayBuffer());
  }
}
