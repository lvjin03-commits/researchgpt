export type StoredGrantImport = {
  bucket: string;
  path: string;
};

export interface GrantImportStorage {
  storeOriginal(input: { ownerId: string; fileName: string; buffer: Buffer; checksum: string }): Promise<StoredGrantImport>;
  remove(input: StoredGrantImport): Promise<void>;
}
