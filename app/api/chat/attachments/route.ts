import { AIProviderError, validateChatMessages } from "@/lib/ai/provider";
import type { ChatMessage } from "@/lib/ai/types";
import { getTextFromMessageContent } from "@/lib/ai/types";
import { sanitizeIncomingChatMessages } from "@/lib/chat/message-normalize";
import { prepareChatMessages } from "@/lib/chat/server/prepare-messages";
import {
  requireChatUser,
  toChatApiErrorResponse,
} from "@/lib/chat/server/errors";
import { AttachmentParseError } from "@/lib/uploads/errors";
import {
  deleteChatAttachments,
  downloadChatAttachments,
  parseAttachmentStorageMetadata,
} from "@/lib/uploads/storage-server";
import type { AttachmentStorageMetadata } from "@/lib/uploads/types";

export const runtime = "nodejs";

type AttachmentsRequestBody = {
  messages?: unknown;
  attachments?: unknown;
};

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
        error: `无法读取文件“${error.fileName}”`,
        details: [
          error.details,
          error.fileType === "application/pdf" ||
          error.fileName.toLowerCase().endsWith(".pdf")
            ? "请确认 PDF 未加密且包含可提取文字；扫描版 PDF 请先执行 OCR。"
            : "请确认文件未损坏，或另存为受支持的标准格式后重试。",
        ].join(" "),
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

function parseAttachmentsRequest(body: unknown): {
  messages: ChatMessage[];
  attachments: AttachmentStorageMetadata[];
} {
  if (typeof body !== "object" || body === null) {
    throw new AIProviderError("Invalid request body", { statusCode: 400 });
  }

  const record = body as AttachmentsRequestBody;

  if (!Array.isArray(record.attachments) || record.attachments.length === 0) {
    throw new AIProviderError("At least one attachment is required", {
      statusCode: 400,
    });
  }

  const attachments = record.attachments.map(parseAttachmentStorageMetadata);

  const messages = validateChatMessages(
    sanitizeIncomingChatMessages(record.messages) as ChatMessage[],
  );

  return { messages, attachments };
}

export async function POST(request: Request) {
  console.log("[attachments] request received");

  let storageAttachments: AttachmentStorageMetadata[] = [];

  try {
    const user = await requireChatUser();

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw new AIProviderError("Invalid JSON body", { statusCode: 400 });
    }

    const parsed = parseAttachmentsRequest(body);
    storageAttachments = parsed.attachments;

    console.log("[attachments] attachment count", storageAttachments.length);

    for (const attachment of storageAttachments) {
      console.log("[attachments] storage object", {
        fileName: attachment.fileName,
        fileType: attachment.fileType || "(empty)",
        fileSize: attachment.fileSize,
        path: attachment.path,
      });
    }

    const files = await downloadChatAttachments(storageAttachments, user.id);
    const prepared = await prepareChatMessages(parsed.messages, files);
    const preparedMessages = prepared.messages;

    await deleteChatAttachments(storageAttachments, user.id);

    console.log("[attachments] all files prepared successfully");

    const preparedUserMessage = [...preparedMessages]
      .reverse()
      .find((message) => message.role === "user");

    return Response.json({
      messages: preparedMessages,
      fileResults: prepared.fileResults,
      attachmentContext: preparedUserMessage
        ? getTextFromMessageContent(preparedUserMessage.content).slice(0, 30000)
        : "",
    });
  } catch (error) {
    if (storageAttachments.length > 0) {
      try {
        const user = await requireChatUser();
        await deleteChatAttachments(storageAttachments, user.id);
      } catch {
        // Best-effort cleanup only.
      }
    }

    console.error("[attachments] request failed:", error);
    if (error instanceof Error) {
      console.error("[attachments] exact error stack:", error.stack);
    }

    const { body, status } = toAttachmentsErrorResponse(error);
    return Response.json(body, { status });
  }
}
