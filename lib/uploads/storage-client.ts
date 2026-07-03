// Client-only module. Do not import from API routes.

import { createClient } from "@/lib/supabase/client";
import { validateUploadFile } from "@/lib/uploads/constants";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/uploads/storage-constants";
import type { AttachmentStorageMetadata } from "@/lib/uploads/types";

function createUploadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function uploadChatAttachments(
  files: File[],
): Promise<AttachmentStorageMetadata[]> {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("请先登录后再上传附件。");
  }

  const batchId = createUploadId();
  const uploaded: AttachmentStorageMetadata[] = [];

  for (const file of files) {
    const validationError = validateUploadFile(file);
    if (validationError) {
      throw new Error(validationError);
    }

    const path = `${user.id}/${batchId}/${file.name}`;
    const { error } = await supabase.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      });

    if (error) {
      throw new Error(
        `上传「${file.name}」失败：${error.message}`,
      );
    }

    uploaded.push({
      bucket: CHAT_ATTACHMENTS_BUCKET,
      path,
      fileName: file.name,
      fileType: file.type || "",
      fileSize: file.size,
    });
  }

  return uploaded;
}
