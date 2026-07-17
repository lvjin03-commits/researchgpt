// Server-only module. Do not import from client components or /api/chat route entry.

import { getUnsupportedFileMessage } from "@/lib/uploads/constants";
import { AttachmentParseError, UploadError } from "@/lib/uploads/errors";
import type { AttachmentInput } from "@/lib/uploads/types";

import {
  classifyAttachment,
  describeParser,
  parseStageForClassification,
} from "./classifier";
import {
  buildAnalysisEvidence,
  imageEvidenceFromParsed,
  structuredDocumentFromParsed,
} from "./evidence";
import { applyEvidenceToMessages } from "./prompt-builder";
import type {
  AnalysisInput,
  AnalysisResult,
  AnalysisWorkflow,
  AttachmentProcessingResult,
  ImageEvidence,
  StructuredDocument,
} from "./types";

function toAttachmentParseError(
  file: Pick<AttachmentInput, "name" | "type">,
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

async function parseAttachmentFile(
  file: AttachmentInput,
): Promise<
  | { kind: "document"; document: StructuredDocument }
  | { kind: "image"; image: ImageEvidence }
> {
  const classification = classifyAttachment(file.name);
  const parser = describeParser(classification, file.name);
  const stage = parseStageForClassification(classification, file.name);

  console.log("[attachments] parser selected", parser, "for", file.name);

  if (classification === "unsupported") {
    console.error(
      "[attachments] unsupported file type",
      file.name,
      file.name.slice(file.name.lastIndexOf(".")).toLowerCase(),
    );
    throw new UploadError(getUnsupportedFileMessage());
  }

  console.log("[attachments] parsing started", file.name);

  try {
    if (classification === "image") {
      const { imageBufferToDataUrl } = await import("@/lib/images/image");
      const parsed = imageBufferToDataUrl(file.buffer, file.name);
      console.log("[attachments] parsing completed", file.name);
      return { kind: "image", image: imageEvidenceFromParsed(parsed) };
    }

    if (classification === "pdf") {
      const { parsePdfAttachment } = await import("@/lib/documents/formats/pdf");
      const parsed = await parsePdfAttachment(file.buffer, file.name);
      console.log("[attachments] parsing completed", file.name);
      return {
        kind: "document",
        document: structuredDocumentFromParsed(parsed),
      };
    }

    const { parseDocument } = await import("@/lib/documents/parser");
    const parsed = await parseDocument(file.buffer, file.name);
    console.log("[attachments] parsing completed", file.name);
    return {
      kind: "document",
      document: structuredDocumentFromParsed(parsed),
    };
  } catch (error) {
    if (error instanceof UploadError) {
      throw toAttachmentParseError(file, stage, error);
    }
    throw toAttachmentParseError(file, stage, error);
  }
}

export class DefaultAnalysisWorkflow implements AnalysisWorkflow {
  async run(input: AnalysisInput): Promise<AnalysisResult> {
    const documents: StructuredDocument[] = [];
    const images: ImageEvidence[] = [];
    const fileResults: AttachmentProcessingResult[] = [];
    let firstError: unknown;

    for (const file of input.files) {
      try {
        const parsed = await parseAttachmentFile(file);

        if (parsed.kind === "image") {
          images.push(parsed.image);
          fileResults.push({
            fileName: file.name,
            status: "ready",
            kind: "image",
          });
        } else {
          documents.push(parsed.document);
          fileResults.push({
            fileName: file.name,
            status: "ready",
            kind: "document",
            truncated: parsed.document.truncated,
          });
        }
      } catch (error) {
        firstError ??= error;
        fileResults.push({
          fileName: file.name,
          status: "failed",
          error:
            error instanceof AttachmentParseError
              ? error.details
              : error instanceof Error
                ? error.message
                : "未知解析错误",
          stage:
            error instanceof AttachmentParseError ? error.stage : "parse",
        });
      }
    }

    if (documents.length === 0 && images.length === 0) {
      throw firstError ?? new UploadError("没有附件能够被成功解析");
    }

    const evidence = buildAnalysisEvidence(documents, images);
    let messages = applyEvidenceToMessages(
      input.messages,
      input.userMessage,
      evidence,
    );

    const failed = fileResults.filter((item) => item.status === "failed");
    if (failed.length > 0) {
      messages = [
        {
          role: "system",
          content: [
            "Some attachments could not be parsed. Continue with successful files only.",
            "Do not imply that failed files were read.",
            ...failed.map(
              (item) =>
                `Failed file: ${item.fileName}; stage: ${item.stage}; reason: ${item.error}`,
            ),
          ].join("\n"),
        },
        ...messages,
      ];
    }

    return { messages, evidence, fileResults };
  }
}
