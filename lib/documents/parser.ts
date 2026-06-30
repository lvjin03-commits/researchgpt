import mammoth from "mammoth";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import { MAX_EXTRACTED_TEXT_CHARS } from "@/lib/documents/constants";
import {
  augmentUserMessageWithDocument,
  toDocumentContext,
} from "@/lib/documents/prompt";
import { truncateText } from "@/lib/documents/truncate";
import type { ChatMessage } from "@/lib/ai/types";
import {
  getFileExtension,
  getUnsupportedFileMessage,
  isDocumentExtension,
  MAX_UPLOAD_BYTES,
} from "@/lib/uploads/constants";
import { UploadError } from "@/lib/uploads/errors";

export type ParsedDocument = {
  fileName: string;
  text: string;
  truncated: boolean;
  originalLength: number;
};

function normalizeExtractedText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

async function parsePptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((left, right) => {
      const leftNumber = Number.parseInt(
        left.match(/slide(\d+)\.xml$/)?.[1] ?? "0",
        10,
      );
      const rightNumber = Number.parseInt(
        right.match(/slide(\d+)\.xml$/)?.[1] ?? "0",
        10,
      );
      return leftNumber - rightNumber;
    });

  const slides: string[] = [];

  for (const [index, slidePath] of slidePaths.entries()) {
    const xml = await zip.file(slidePath)?.async("text");
    if (!xml) continue;

    const textNodes = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
      .map((match) => match[1]?.trim())
      .filter(Boolean);

    if (textNodes.length > 0) {
      slides.push(`Slide ${index + 1}:\n${textNodes.join("\n")}`);
    }
  }

  return normalizeExtractedText(slides.join("\n\n"));
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeExtractedText(result.value);
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return normalizeExtractedText(result.text);
  } finally {
    await parser.destroy();
  }
}

function parsePlainText(buffer: Buffer): string {
  return normalizeExtractedText(buffer.toString("utf-8"));
}

function parseSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sections: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet).trim();

    if (!csv) continue;

    if (workbook.SheetNames.length === 1) {
      sections.push(csv);
    } else {
      sections.push(`Sheet: ${sheetName}\n${csv}`);
    }
  }

  return normalizeExtractedText(sections.join("\n\n"));
}

export async function parseDocument(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedDocument> {
  if (buffer.byteLength === 0) {
    throw new UploadError("The uploaded file is empty.");
  }

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB size limit.`,
    );
  }

  const extension = getFileExtension(fileName);

  if (!isDocumentExtension(extension)) {
    throw new UploadError(getUnsupportedFileMessage());
  }

  let extractedText: string;

  try {
    switch (extension) {
      case ".docx":
        extractedText = await parseDocx(buffer);
        break;
      case ".pdf":
        extractedText = await parsePdf(buffer);
        break;
      case ".txt":
      case ".md":
        extractedText = parsePlainText(buffer);
        break;
      case ".csv":
      case ".xlsx":
      case ".xls":
        extractedText = parseSpreadsheet(buffer);
        break;
      case ".pptx":
        extractedText = await parsePptx(buffer);
        break;
    }
  } catch (error) {
    if (error instanceof UploadError) {
      throw error;
    }

    const reason =
      error instanceof Error ? error.message : "Unknown parsing error";

    throw new UploadError(
      `Failed to parse "${fileName}": ${reason}`,
      422,
    );
  }

  if (!extractedText) {
    throw new UploadError(
      `No readable text could be extracted from "${fileName}".`,
      422,
    );
  }

  const truncated = truncateText(extractedText, MAX_EXTRACTED_TEXT_CHARS);

  return {
    fileName,
    text: truncated.text,
    truncated: truncated.truncated,
    originalLength: truncated.originalLength,
  };
}

export async function parseDocumentFile(file: File): Promise<ParsedDocument> {
  const arrayBuffer = await file.arrayBuffer();
  return parseDocument(Buffer.from(arrayBuffer), file.name);
}

export function injectDocumentIntoMessages(
  messages: ChatMessage[],
  userMessage: string,
  document: ParsedDocument,
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

  updated[lastIndex] = {
    role: "user",
    content: augmentUserMessageWithDocument(
      userMessage,
      toDocumentContext(document.fileName, {
        text: document.text,
        truncated: document.truncated,
        originalLength: document.originalLength,
      }),
    ),
  };

  return updated;
}
