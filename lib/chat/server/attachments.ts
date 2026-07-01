// Server-only module. Do not import from client components or /api/chat route entry.

import type { ChatMessage, MessageContentPart } from "@/lib/ai/types";
import type { ParsedDocument } from "@/lib/documents/types";
import {
  getFileExtension,
  getUnsupportedFileMessage,
  isDocumentExtension,
  isImageExtension,
} from "@/lib/uploads/constants";
import { UploadError, AttachmentParseError } from "@/lib/uploads/errors";

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

function describeParser(extension: string): string {
  if (isImageExtension(extension)) {
    return "image";
  }

  if (isDocumentExtension(extension)) {
    return `document${extension}`;
  }

  return "unsupported";
}

function toAttachmentParseError(
  file: File,
  stage: string,
  error: unknown,
): AttachmentParseError {
  const details =
    error instanceof Error && error.message
      ? error.message
      : "Unknown parsing error";

  if (error instanceof Error) {
    console.error("[attachments] exact error stack:", error.stack);
    if (error.cause instanceof Error) {
      console.error("[attachments] cause stack:", error.cause.stack);
    }
  }

  return new AttachmentParseError({
    fileName: file.name,
    fileType: file.type || "(empty)",
    stage,
    details,
    cause: error,
  });
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
  const scannedPdfNotes: string[] = [];

  for (const file of files) {
    const extension = getFileExtension(file.name);
    const parser = describeParser(extension);

    console.log("[attachments] parser selected", parser, "for", file.name);

    if (isImageExtension(extension)) {
      console.log("[attachments] parsing started", file.name);
      try {
        const { parseImageFile } = await import("@/lib/images/image");
        images.push(await parseImageFile(file));
        console.log("[attachments] parsing completed", file.name);
      } catch (error) {
        if (error instanceof UploadError) {
          throw toAttachmentParseError(file, "parse_image", error);
        }
        throw toAttachmentParseError(file, "parse_image", error);
      }
      continue;
    }

    if (extension === ".pdf") {
      console.log("[attachments] parsing started", file.name);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const { parsePdfAttachment } = await import("@/lib/documents/formats/pdf");
        const result = await parsePdfAttachment(
          Buffer.from(arrayBuffer),
          file.name,
        );

        if (result.kind === "text") {
          documents.push(result.document);
        } else {
          scannedPdfNotes.push(result.pageNote);
          images.push(...result.images);
        }

        console.log("[attachments] parsing completed", file.name);
      } catch (error) {
        if (error instanceof UploadError) {
          throw toAttachmentParseError(file, "parse_document.pdf", error);
        }
        throw toAttachmentParseError(file, "parse_document.pdf", error);
      }
      continue;
    }

    if (isDocumentExtension(extension)) {
      console.log("[attachments] parsing started", file.name);
      try {
        const { parseDocumentFile } = await import("@/lib/documents/parser");
        documents.push(await parseDocumentFile(file));
        console.log("[attachments] parsing completed", file.name);
      } catch (error) {
        if (error instanceof UploadError) {
          throw toAttachmentParseError(file, `parse_document${extension}`, error);
        }
        throw toAttachmentParseError(file, `parse_document${extension}`, error);
      }
      continue;
    }

    console.error("[attachments] unsupported file type", file.name, extension);
    throw new UploadError(getUnsupportedFileMessage());
  }

  const { augmentUserMessageWithDocuments, toDocumentContext } = await import(
    "@/lib/documents/prompt"
  );

  let messageBody = buildDefaultUserMessage(
    userMessage,
    images.length,
    documents.length,
  );

  if (scannedPdfNotes.length > 0) {
    messageBody = [messageBody, ...scannedPdfNotes].filter(Boolean).join("\n\n");
  }

  const textBody = augmentUserMessageWithDocuments(
    messageBody,
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
