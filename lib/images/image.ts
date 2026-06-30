import type { ChatMessage } from "@/lib/ai/types";
import {
  getFileExtension,
  IMAGE_MIME_TYPES,
  isImageExtension,
  MAX_UPLOAD_BYTES,
} from "@/lib/uploads/constants";
import { UploadError } from "@/lib/uploads/errors";

export type ParsedImage = {
  fileName: string;
  dataUrl: string;
  mimeType: string;
};

function getImageMimeType(fileName: string): string {
  const extension = getFileExtension(fileName);

  if (!isImageExtension(extension)) {
    throw new UploadError(
      `Unsupported image type "${extension || "unknown"}". Supported types: .png, .jpg, .jpeg, .webp.`,
    );
  }

  return IMAGE_MIME_TYPES[extension];
}

export function imageBufferToDataUrl(
  buffer: Buffer,
  fileName: string,
): ParsedImage {
  if (buffer.byteLength === 0) {
    throw new UploadError("The uploaded image is empty.");
  }

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `Image exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB size limit.`,
    );
  }

  const mimeType = getImageMimeType(fileName);
  const base64 = buffer.toString("base64");

  return {
    fileName,
    mimeType,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

export async function parseImageFile(file: File): Promise<ParsedImage> {
  const arrayBuffer = await file.arrayBuffer();
  return imageBufferToDataUrl(Buffer.from(arrayBuffer), file.name);
}

export function injectImageIntoMessages(
  messages: ChatMessage[],
  userMessage: string,
  image: ParsedImage,
): ChatMessage[] {
  if (messages.length === 0) {
    throw new UploadError("messages must be a non-empty array");
  }

  const updated = [...messages];
  const lastIndex = updated.length - 1;
  const lastMessage = updated[lastIndex];

  if (lastMessage?.role !== "user") {
    throw new UploadError("The last message must be from the user");
  }

  const trimmedMessage = userMessage.trim();
  const text = trimmedMessage || "Please analyze the attached image.";

  updated[lastIndex] = {
    role: "user",
    content: [
      { type: "text", text },
      {
        type: "image_url",
        image_url: {
          url: image.dataUrl,
          detail: "auto",
        },
      },
    ],
  };

  return updated;
}
