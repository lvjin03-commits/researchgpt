// Server-only module. Do not import from client components or /api/chat route entry.

import { createClient } from "@/lib/supabase/server";
import { validateUploadFile } from "@/lib/uploads/constants";
import { UploadError } from "@/lib/uploads/errors";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/uploads/storage-constants";
import type {
  AttachmentInput,
  AttachmentStorageMetadata,
} from "@/lib/uploads/types";

function validateAttachmentMetadata(
  metadata: AttachmentStorageMetadata,
  userId: string,
): void {
  if (metadata.bucket !== CHAT_ATTACHMENTS_BUCKET) {
    throw new UploadError("Invalid attachment storage bucket.", 400);
  }

  if (
    !metadata.path ||
    !metadata.path.startsWith(`${userId}/`) ||
    metadata.path.includes("..")
  ) {
    throw new UploadError("Invalid attachment storage path.", 400);
  }

  if (typeof metadata.fileName !== "string" || !metadata.fileName.trim()) {
    throw new UploadError("Attachment fileName is required.", 400);
  }

  if (
    typeof metadata.fileSize !== "number" ||
    !Number.isFinite(metadata.fileSize) ||
    metadata.fileSize <= 0
  ) {
    throw new UploadError("Attachment fileSize is invalid.", 400);
  }

  const validationError = validateUploadFile({
    name: metadata.fileName,
    size: metadata.fileSize,
    type: metadata.fileType,
  });

  if (validationError) {
    throw new UploadError(validationError, 400);
  }
}

export function parseAttachmentStorageMetadata(
  value: unknown,
): AttachmentStorageMetadata {
  if (typeof value !== "object" || value === null) {
    throw new UploadError("Invalid attachment metadata.", 400);
  }

  const record = value as Record<string, unknown>;

  return {
    bucket: String(record.bucket ?? ""),
    path: String(record.path ?? ""),
    fileName: String(record.fileName ?? ""),
    fileType: String(record.fileType ?? ""),
    fileSize: Number(record.fileSize),
  };
}

export async function downloadChatAttachments(
  attachments: AttachmentStorageMetadata[],
  userId: string,
): Promise<AttachmentInput[]> {
  const supabase = await createClient();
  const inputs: AttachmentInput[] = [];

  for (const metadata of attachments) {
    validateAttachmentMetadata(metadata, userId);

    const { data, error } = await supabase.storage
      .from(metadata.bucket)
      .download(metadata.path);

    if (error || !data) {
      throw new UploadError(
        `Failed to download "${metadata.fileName}" from storage: ${error?.message ?? "File not found"}`,
        502,
      );
    }

    const buffer = Buffer.from(await data.arrayBuffer());

    if (buffer.byteLength === 0) {
      throw new UploadError(`Downloaded file "${metadata.fileName}" is empty.`, 422);
    }

    const sizeValidationError = validateUploadFile({
      name: metadata.fileName,
      size: buffer.byteLength,
      type: metadata.fileType,
    });

    if (sizeValidationError) {
      throw new UploadError(sizeValidationError, 413);
    }

    inputs.push({
      name: metadata.fileName,
      type: metadata.fileType,
      buffer,
    });
  }

  return inputs;
}

export async function deleteChatAttachments(
  attachments: AttachmentStorageMetadata[],
  userId: string,
): Promise<void> {
  const supabase = await createClient();
  const paths = attachments
    .filter((metadata) => metadata.path.startsWith(`${userId}/`))
    .map((metadata) => metadata.path);

  if (paths.length === 0) {
    return;
  }

  const { error } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .remove(paths);

  if (error) {
    console.error("[attachments] Failed to delete storage objects:", error.message);
  }
}
