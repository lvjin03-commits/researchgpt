import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GrantImportStorageError,
  type GrantImportStorage,
  type StoredGrantImport,
} from "../../ports/grant-import-storage.ts";
import { createGrantOriginalObjectPath } from "./grant-import-object-path.ts";

const PRIVATE_UPLOAD_BUCKET = "chat-attachments";

export class SupabaseGrantImportStorage implements GrantImportStorage {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async storeOriginal(input: { ownerId: string; buffer: Buffer; checksum: string }): Promise<StoredGrantImport> {
    // The user-visible filename belongs to import audit metadata. Storage identity
    // is program-owned and deliberately independent of untrusted filename text.
    const path = createGrantOriginalObjectPath(input.ownerId, randomUUID());
    const { error } = await this.client.storage.from(PRIVATE_UPLOAD_BUCKET).upload(path, input.buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: false,
      metadata: { checksum: input.checksum, source: "grant-docx-import" },
    });
    if (error) {
      throw new GrantImportStorageError(
        "grant_original_storage_failed",
        "Grant original upload failed.",
        { cause: error },
      );
    }
    return { bucket: PRIVATE_UPLOAD_BUCKET, path };
  }

  async remove(input: StoredGrantImport): Promise<void> {
    const { error } = await this.client.storage.from(input.bucket).remove([input.path]);
    if (error) console.error("[grant-import] Failed to remove orphaned original", { path: input.path, error: error.message });
  }
}
