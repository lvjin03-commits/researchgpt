import type { SupabaseClient } from "@supabase/supabase-js";
import { GrantEvidenceStorageError, type GrantEvidenceStorage } from "../../ports/grant-evidence-storage.ts";
import { createGrantEvidenceObjectPath } from "./grant-evidence-object-path.ts";

const BUCKET = "chat-attachments";

export class SupabaseGrantEvidenceStorage implements GrantEvidenceStorage {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async store(input: Parameters<GrantEvidenceStorage["store"]>[0]) {
    const path = createGrantEvidenceObjectPath(input.ownerId, input.documentId, input.sourceId);
    const { error } = await this.client.storage.from(BUCKET).upload(path, input.buffer, {
      contentType: input.mediaType,
      upsert: false,
      metadata: { checksum: input.checksum, source: "grant-project-evidence" },
    });
    if (error) throw new GrantEvidenceStorageError("grant_evidence_storage_failed", "Evidence upload failed.", { cause: error });
    return { bucket: BUCKET, path };
  }

  async remove(input: { bucket: string; path: string }) {
    const { error } = await this.client.storage.from(input.bucket).remove([input.path]);
    if (error) throw new GrantEvidenceStorageError("grant_evidence_delete_failed", "Evidence object deletion failed.", { cause: error });
  }
}
