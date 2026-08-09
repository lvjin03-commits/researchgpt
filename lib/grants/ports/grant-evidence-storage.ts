export type StoredGrantEvidence = { bucket: string; path: string };

export interface GrantEvidenceStorage {
  store(input: {
    ownerId: string;
    documentId: string;
    sourceId: string;
    buffer: Buffer;
    mediaType: string;
    checksum: string;
  }): Promise<StoredGrantEvidence>;
  remove(input: StoredGrantEvidence): Promise<void>;
}

export class GrantEvidenceStorageError extends Error {
  readonly code: "grant_evidence_storage_failed" | "grant_evidence_delete_failed";

  constructor(
    code: "grant_evidence_storage_failed" | "grant_evidence_delete_failed",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GrantEvidenceStorageError";
    this.code = code;
  }
}
