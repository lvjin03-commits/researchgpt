export type StoredGrantImport = {
  bucket: string;
  path: string;
};

export type GrantImportStorageErrorCode =
  | "grant_storage_key_contract_invalid"
  | "grant_original_storage_failed";

export class GrantImportStorageError extends Error {
  readonly code: GrantImportStorageErrorCode;

  constructor(
    code: GrantImportStorageErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GrantImportStorageError";
    this.code = code;
  }
}

export interface GrantImportStorage {
  storeOriginal(input: { ownerId: string; buffer: Buffer; checksum: string }): Promise<StoredGrantImport>;
  remove(input: StoredGrantImport): Promise<void>;
}
