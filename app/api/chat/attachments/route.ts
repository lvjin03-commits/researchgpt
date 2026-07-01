import { AIProviderError, validateChatMessages } from "@/lib/ai/provider";
import type { ChatMessage } from "@/lib/ai/types";
import { sanitizeIncomingChatMessages } from "@/lib/chat/message-normalize";
import { prepareChatMessages } from "@/lib/chat/server/prepare-messages";
import {
  requireChatUser,
  toChatApiErrorResponse,
} from "@/lib/chat/server/errors";
import { validateUploadFile } from "@/lib/uploads/constants";
import { AttachmentParseError, UploadError } from "@/lib/uploads/errors";

export const runtime = "nodejs";

function toAttachmentsErrorResponse(
  error: unknown,
): { body: Record<string, string>; status: number } {
  if (error instanceof AttachmentParseError) {
    console.error("[attachments] parsing failed:", {
      fileName: error.fileName,
      fileType: error.fileType,
      stage: error.stage,
      details: error.details,
    });
    console.error("[attachments] exact error stack:", error.stack);
    if (error.cause instanceof Error) {
      console.error("[attachments] cause stack:", error.cause.stack);
    }

    return {
      status: error.statusCode,
      body: {
        error: "Attachment parsing failed",
        details: error.details,
        fileName: error.fileName,
        fileType: error.fileType,
        stage: error.stage,
      },
    };
  }

  const { body, status } = toChatApiErrorResponse(error);
  return {
    status,
    body: body as Record<string, string>,
  };
}

export async function POST(request: Request) {
  console.log("[attachments] request received");

  try {
    await requireChatUser();

    const formData = await request.formData();
    const messagesField = formData.get("messages");

    if (typeof messagesField !== "string") {
      throw new AIProviderError("messages field is required", {
        statusCode: 400,
      });
    }

    let parsedMessages: unknown;

    try {
      parsedMessages = JSON.parse(messagesField);
    } catch {
      throw new AIProviderError("messages must be valid JSON", {
        statusCode: 400,
      });
    }

    const messages = validateChatMessages(
      sanitizeIncomingChatMessages(parsedMessages) as ChatMessage[],
    );

    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    console.log("[attachments] file count", files.length);

    for (const file of files) {
      console.log("[attachments] file name", file.name);
      console.log("[attachments] file type", file.type || "(empty)");
      console.log("[attachments] file size", file.size);
    }

    if (files.length === 0) {
      throw new AIProviderError("At least one file is required", {
        statusCode: 400,
      });
    }

    for (const file of files) {
      const validationError = validateUploadFile(file);

      if (validationError) {
        throw new UploadError(validationError, 400);
      }
    }

    const preparedMessages = await prepareChatMessages(messages, files);

    console.log("[attachments] all files prepared successfully");

    return Response.json({ messages: preparedMessages });
  } catch (error) {
    console.error("[attachments] request failed:", error);
    if (error instanceof Error) {
      console.error("[attachments] exact error stack:", error.stack);
    }

    const { body, status } = toAttachmentsErrorResponse(error);
    return Response.json(body, { status });
  }
}
