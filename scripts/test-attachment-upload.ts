/**
 * Local parser diagnostic — same parseDocument path as POST /api/chat/attachments.
 *
 * Usage:
 *   npx tsx scripts/test-attachment-upload.ts path/to/file.xlsx
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "../lib/documents/parser";

const filePath = process.argv[2];

if (!filePath) {
  console.error(
    "Usage: npx tsx scripts/test-attachment-upload.ts <path-to-file>",
  );
  process.exit(1);
}

const absolutePath = path.resolve(filePath);
const fileName = path.basename(absolutePath);

console.log("[test-attachment-upload] file:", absolutePath);

let buffer: Buffer;

try {
  buffer = readFileSync(absolutePath);
} catch (error) {
  console.error("[test-attachment-upload] failed to read file");
  if (error instanceof Error) {
    console.error("message:", error.message);
    console.error("stack:", error.stack);
  }
  process.exit(1);
}

console.log("[test-attachment-upload] file size:", buffer.byteLength);
console.log(
  "[test-attachment-upload] calling parseDocument (attachments route parser)",
);

try {
  const result = await parseDocument(buffer, fileName);
  console.log("[test-attachment-upload] parsing completed");
  console.log(
    JSON.stringify(
      {
        fileName: result.fileName,
        textLength: result.text.length,
        truncated: result.truncated,
        originalLength: result.originalLength,
        preview: result.text.slice(0, 300),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("[test-attachment-upload] parsing failed");
  if (error instanceof Error) {
    console.error("message:", error.message);
    console.error("stack:", error.stack);
    if (error.cause instanceof Error) {
      console.error("cause message:", error.cause.message);
      console.error("cause stack:", error.cause.stack);
    }
  } else {
    console.error(error);
  }
  process.exit(1);
}
