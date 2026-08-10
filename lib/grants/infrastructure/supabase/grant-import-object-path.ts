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

const FIGURE_EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/bmp": "bmp",
  "image/x-emf": "emf",
  "image/x-wmf": "wmf",
};

export function createGrantFigureObjectPath(input: {
  ownerId: string;
  assetId: string;
  contentHash: string;
  mediaType: string;
}): string {
  const extension = FIGURE_EXTENSION_BY_MEDIA_TYPE[input.mediaType];
  if (!extension) {
    throw new GrantImportStorageError(
      "grant_storage_key_contract_invalid",
      "Grant figure media type has no immutable storage extension.",
    );
  }
  const path = `${input.ownerId}/grant-figure-assets/${input.assetId}/${input.contentHash}.${extension}`;
  if (!STORAGE_OBJECT_KEY_PATTERN.test(path)) {
    throw new GrantImportStorageError(
      "grant_storage_key_contract_invalid",
      "Grant figure object key violates the ASCII storage contract.",
    );
  }
  return path;
}
