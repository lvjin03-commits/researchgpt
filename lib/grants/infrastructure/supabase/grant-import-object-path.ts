import { GrantImportStorageError } from "../../ports/grant-import-storage.ts";

const STORAGE_OBJECT_KEY_PATTERN = /^[A-Za-z0-9/_\-.]+$/;

export function createGrantOriginalObjectPath(ownerId: string, importId: string): string {
  const path = `${ownerId}/grant-imports/${importId}/original.docx`;
  if (!STORAGE_OBJECT_KEY_PATTERN.test(path)) {
    throw new GrantImportStorageError(
      "grant_storage_key_contract_invalid",
      "Grant original object key violates the ASCII storage contract.",
    );
  }
  return path;
}
