// Client-only module. Do not import from API routes.

import {
  ensureFileName,
  getAttachmentKind,
  validateUploadFile,
} from "@/lib/uploads/constants";

export type PendingAttachment = {
  id: string;
  file: File;
  kind: "document" | "image";
  previewUrl?: string;
};

function createAttachmentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPendingAttachment(file: File): PendingAttachment | string {
  const normalizedFile = ensureFileName(file);
  const validationError = validateUploadFile(normalizedFile);

  if (validationError) {
    return validationError;
  }

  const kind = getAttachmentKind(normalizedFile.name);

  if (!kind) {
    return validateUploadFile(normalizedFile) ?? "Unsupported file type.";
  }

  return {
    id: createAttachmentId(),
    file: normalizedFile,
    kind,
    previewUrl:
      kind === "image" ? URL.createObjectURL(normalizedFile) : undefined,
  };
}

export function revokePendingAttachmentPreview(
  attachment: PendingAttachment,
): void {
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

export function revokePendingAttachmentPreviews(
  attachments: PendingAttachment[],
): void {
  for (const attachment of attachments) {
    revokePendingAttachmentPreview(attachment);
  }
}

export function addPendingAttachments(
  current: PendingAttachment[],
  incoming: File[],
): { attachments: PendingAttachment[]; error: string | null } {
  const next = [...current];
  let error: string | null = null;

  for (const file of incoming) {
    const result = createPendingAttachment(file);

    if (typeof result === "string") {
      error = result;
      continue;
    }

    next.push(result);
  }

  return { attachments: next, error };
}

export function removePendingAttachment(
  attachments: PendingAttachment[],
  id: string,
): PendingAttachment[] {
  const target = attachments.find((attachment) => attachment.id === id);

  if (target) {
    revokePendingAttachmentPreview(target);
  }

  return attachments.filter((attachment) => attachment.id !== id);
}

export function filesFromClipboard(
  clipboardData: DataTransfer | null,
): File[] {
  if (!clipboardData) return [];

  const files: File[] = [];

  for (const item of clipboardData.items) {
    if (!item.type.startsWith("image/")) continue;

    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }

  return files;
}

export function filesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];

  return Array.from(dataTransfer.files);
}
