import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GrantImportStorage, StoredGrantImport } from "../../ports/grant-import-storage.ts";

const PRIVATE_UPLOAD_BUCKET = "chat-attachments";

function safeFileName(fileName: string): string {
  const normalized = fileName.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return (normalized || "original.docx").slice(-120);
}

export class SupabaseGrantImportStorage implements GrantImportStorage {
  constructor(private readonly client: SupabaseClient) {}

  async storeOriginal(input: { ownerId: string; fileName: string; buffer: Buffer; checksum: string }): Promise<StoredGrantImport> {
    const path = `${input.ownerId}/grant-imports/${randomUUID()}/${safeFileName(input.fileName)}`;
    const { error } = await this.client.storage.from(PRIVATE_UPLOAD_BUCKET).upload(path, input.buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: false,
      metadata: { checksum: input.checksum, source: "grant-docx-import" },
    });
    if (error) throw new Error(`Grant original upload failed: ${error.message}`);
    return { bucket: PRIVATE_UPLOAD_BUCKET, path };
  }

  async remove(input: StoredGrantImport): Promise<void> {
    const { error } = await this.client.storage.from(input.bucket).remove([input.path]);
    if (error) console.error("[grant-import] Failed to remove orphaned original", { path: input.path, error: error.message });
  }
}
