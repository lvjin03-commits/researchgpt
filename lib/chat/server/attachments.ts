// Server-only module. Do not import from client components or /api/chat route entry.

import type { ChatMessage, MessageContentPart } from "@/lib/ai/types";
import type { ParsedDocument } from "@/lib/documents/types";
import {
  getFileExtension,
  getUnsupportedFileMessage,
  isDocumentExtension,
  isImageExtension,
} from "@/lib/uploads/constants";
import { UploadError } from "@/lib/uploads/errors";

function buildDefaultUserMessage(
  userMessage: string,
  imageCount: number,
  documentCount: number,
): string {
  const trimmed = userMessage.trim();

  if (trimmed) {
    return trimmed;
  }

  if (imageCount > 0 && documentCount > 0) {
    return "Please analyze the attached files.";
  }

  if (imageCount > 1) {
    return "Please analyze the attached images.";
  }

  if (imageCount === 1) {
    return "Please analyze the attached image.";
  }

  if (documentCount > 1) {
    return "Please analyze the attached documents.";
  }

  if (documentCount === 1) {
    return "Please analyze the attached document.";
  }

  return trimmed;
}

export async function injectAttachmentsIntoMessages(
  messages: ChatMessage[],
  userMessage: string,
  files: File[],
): Promise<ChatMessage[]> {
  if (messages.length === 0) {
    throw new UploadError("messages must be a non-empty array");
  }

  const lastIndex = messages.length - 1;
  const lastMessage = messages[lastIndex];

  if (lastMessage?.role !== "user") {
    throw new UploadError("The last message must be from the user");
  }

  if (files.length === 0) {
    return messages;
  }

  const images: { dataUrl: string }[] = [];
  const documents: ParsedDocument[] = [];

  for (const file of files) {
    const extension = getFileExtension(file.name);

    if (isImageExtension(extension)) {
      const { parseImageFile } = await import("@/lib/images/image");
      images.push(await parseImageFile(file));
      continue;
    }

    if (isDocumentExtension(extension)) {
      const { parseDocumentFile } = await import("@/lib/documents/parser");
      documents.push(await parseDocumentFile(file));
      continue;
    }

    throw new UploadError(getUnsupportedFileMessage());
  }

  const { augmentUserMessageWithDocuments, toDocumentContext } = await import(
    "@/lib/documents/prompt"
  );

  const textBody = augmentUserMessageWithDocuments(
    buildDefaultUserMessage(userMessage, images.length, documents.length),
    documents.map((document) =>
      toDocumentContext(document.fileName, {
        text: document.text,
        truncated: document.truncated,
        originalLength: document.originalLength,
      }),
    ),
  );

  const updated = [...messages];

  if (images.length === 0) {
    updated[lastIndex] = {
      role: "user",
      content: textBody,
    };
    return updated;
  }

  const content: MessageContentPart[] = [{ type: "text", text: textBody }];

  for (const image of images) {
    content.push({
      type: "image_url",
      image_url: {
        url: image.dataUrl,
        detail: "auto",
      },
    });
  }

  updated[lastIndex] = {
    role: "user",
    content,
  };

  return updated;
}
