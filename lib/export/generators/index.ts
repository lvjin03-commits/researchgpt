import type { ExportFormat } from "@/lib/export/types";
import { generateDocxBuffer } from "@/lib/export/generators/docx";
import { renderMarkdownToPdfBuffer } from "@/lib/export/pdf-render";

export async function generateExportBuffer(
  format: ExportFormat,
  input: {
    title: string;
    content: string;
    metadata: Record<string, unknown>;
  },
): Promise<Buffer> {
  switch (format) {
    case "md":
      return Buffer.from(input.content, "utf8");
    case "txt":
      return Buffer.from(input.content, "utf8");
    case "json":
      return Buffer.from(
        JSON.stringify(
          {
            title: input.title,
            content: input.content,
            metadata: input.metadata,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
    case "docx":
      return generateDocxBuffer(input.content);
    case "pdf":
      return renderMarkdownToPdfBuffer(input.content);
    default: {
      const exhaustive: never = format;
      throw new Error(`Unsupported export format: ${exhaustive}`);
    }
  }
}
