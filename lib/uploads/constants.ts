export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  ".docx",
  ".pdf",
  ".txt",
  ".md",
  ".csv",
  ".xlsx",
  ".xls",
  ".pptx",
] as const;

export const SUPPORTED_IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
] as const;

export const SUPPORTED_FILE_EXTENSIONS = [
  ...SUPPORTED_DOCUMENT_EXTENSIONS,
  ...SUPPORTED_IMAGE_EXTENSIONS,
] as const;

export type SupportedDocumentExtension =
  (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number];

export type SupportedImageExtension =
  (typeof SUPPORTED_IMAGE_EXTENSIONS)[number];

export type SupportedFileExtension =
  (typeof SUPPORTED_FILE_EXTENSIONS)[number];

export type AttachmentKind = "document" | "image";

export const ACCEPTED_FILE_TYPES = SUPPORTED_FILE_EXTENSIONS.join(",");

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/** Vercel serverless request body limit (~4.5 MB); PDF-only cap. */
export const MAX_PDF_UPLOAD_BYTES = 4 * 1024 * 1024;

export const MAX_PDF_UPLOAD_MB = MAX_PDF_UPLOAD_BYTES / (1024 * 1024);

export const IMAGE_MIME_TYPES: Record<SupportedImageExtension, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const MIME_TO_EXTENSION: Record<string, SupportedImageExtension> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
};

const UNSUPPORTED_FILE_MESSAGE =
  "Unsupported file type. Supported: images (.png, .jpg, .jpeg, .webp) and documents (.pdf, .docx, .xlsx, .xls, .csv, .txt, .md, .pptx).";

export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return "";
  return fileName.slice(dotIndex).toLowerCase();
}

export function extensionFromMimeType(
  mimeType: string,
): SupportedImageExtension | undefined {
  return MIME_TO_EXTENSION[mimeType.toLowerCase()];
}

export function isDocumentExtension(
  extension: string,
): extension is SupportedDocumentExtension {
  return SUPPORTED_DOCUMENT_EXTENSIONS.includes(
    extension as SupportedDocumentExtension,
  );
}

export function isImageExtension(
  extension: string,
): extension is SupportedImageExtension {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(
    extension as SupportedImageExtension,
  );
}

export function isSupportedExtension(
  extension: string,
): extension is SupportedFileExtension {
  return SUPPORTED_FILE_EXTENSIONS.includes(
    extension as SupportedFileExtension,
  );
}

export function getUnsupportedFileMessage(): string {
  return UNSUPPORTED_FILE_MESSAGE;
}

export function getAttachmentKind(fileName: string): AttachmentKind | undefined {
  const extension = getFileExtension(fileName);

  if (isImageExtension(extension)) return "image";
  if (isDocumentExtension(extension)) return "document";
  return undefined;
}

export function validateUploadFile(file: {
  name: string;
  size: number;
  type?: string;
}): string | null {
  let extension = getFileExtension(file.name);

  if (!extension && file.type) {
    extension = extensionFromMimeType(file.type) ?? "";
  }

  if (!isSupportedExtension(extension)) {
    return `"${file.name}" is not supported. ${UNSUPPORTED_FILE_MESSAGE}`;
  }

  if (file.size === 0) {
    return `"${file.name}" is empty.`;
  }

  if (extension === ".pdf" && file.size > MAX_PDF_UPLOAD_BYTES) {
    return `"${file.name}" exceeds the ${MAX_PDF_UPLOAD_MB}MB PDF size limit.`;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return `"${file.name}" exceeds the ${MAX_UPLOAD_MB}MB size limit.`;
  }

  return null;
}

export function ensureFileName(file: File): File {
  const extension = getFileExtension(file.name);
  const inferredExtension = file.type
    ? extensionFromMimeType(file.type)
    : undefined;
  const resolvedExtension = extension || inferredExtension;

  if (!resolvedExtension) {
    return file;
  }

  const hasReliableName =
    extension &&
    file.name.trim().length > 0 &&
    !/^image\.(png|jpe?g|webp)$/i.test(file.name.trim());

  if (hasReliableName) {
    return file;
  }

  const baseName = file.name.trim().replace(/\.[^.]+$/, "") || "pasted-image";
  const normalizedBase =
    baseName === "image" || baseName.length === 0
      ? `pasted-image-${Date.now()}`
      : baseName;

  return new File([file], `${normalizedBase}${resolvedExtension}`, {
    type: file.type || IMAGE_MIME_TYPES[resolvedExtension as SupportedImageExtension],
    lastModified: file.lastModified,
  });
}
