// Server-only module. Do not import from client components or /api/chat route entry.

import type { ExportFormat } from "@/lib/export/types";

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
    case "docx": {
      const { generateDocxBuffer } = await import("@/lib/export/generators/docx");
      return generateDocxBuffer(input.title, input.content);
    }
    case "pdf": {
      const { renderMarkdownToPdfBuffer } = await import("@/lib/export/pdf-render");
      return renderMarkdownToPdfBuffer(input.content);
    }
    case "pptx": {
      const { generateReviewPptxBuffer } = await import(
        "@/lib/literature/server/review-pptx"
      );
      return generateReviewPptxBuffer(input.title, input.content);
    }
    case "xlsx": {
      const { generateArtifactXlsxBuffer } = await import(
        "@/lib/export/generators/xlsx"
      );
      return generateArtifactXlsxBuffer(input.title, input.content);
    }
    case "svg": {
      const { generateArtifactSvgBuffer } = await import(
        "@/lib/export/generators/svg"
      );
      return generateArtifactSvgBuffer(input.title, input.content);
    }
    case "png": {
      const { generateArtifactPngBuffer } = await import(
        "@/lib/export/generators/png"
      );
      return generateArtifactPngBuffer(input.title, input.content);
    }
    default: {
      const exhaustive: never = format;
      throw new Error(`Unsupported export format: ${exhaustive}`);
    }
  }
}
