// Server-only module. Do not import from client components or /api/chat route entry.

import type { ExportFormat } from "@/lib/export/types";
import {
  repairArtifactContent,
  type ArtifactTemplateId,
} from "@/lib/export/artifact-planner";

function getTemplateId(value: unknown): ArtifactTemplateId {
  return value === "modern" || value === "minimal" ? value : "academic";
}

export async function generateExportBuffer(
  format: ExportFormat,
  input: {
    title: string;
    content: string;
    metadata: Record<string, unknown>;
  },
): Promise<Buffer> {
  const templateId = getTemplateId(input.metadata.templateId);
  const content =
    input.metadata.autoRepair === false
      ? input.content
      : repairArtifactContent(input.content, format);

  switch (format) {
    case "md":
      return Buffer.from(content, "utf8");
    case "txt":
      return Buffer.from(content, "utf8");
    case "json":
      return Buffer.from(
        JSON.stringify(
          {
            title: input.title,
            content,
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
      return generateDocxBuffer(input.title, content, templateId);
    }
    case "pdf": {
      const { renderMarkdownToPdfBuffer } = await import("@/lib/export/pdf-render");
      return renderMarkdownToPdfBuffer(content);
    }
    case "pptx": {
      const { generateReviewPptxBuffer } = await import(
        "@/lib/literature/server/review-pptx"
      );
      return generateReviewPptxBuffer(
        input.title,
        content,
        templateId === "modern" ? "research-modern" : "teal-minimal",
      );
    }
    case "xlsx": {
      const { generateArtifactXlsxBuffer } = await import(
        "@/lib/export/generators/xlsx"
      );
      return generateArtifactXlsxBuffer(input.title, content);
    }
    case "svg": {
      const { generateArtifactSvgBuffer } = await import(
        "@/lib/export/generators/svg"
      );
      return generateArtifactSvgBuffer(input.title, content, templateId);
    }
    case "png": {
      const { generateArtifactPngBuffer } = await import(
        "@/lib/export/generators/png"
      );
      return generateArtifactPngBuffer(input.title, content, templateId);
    }
    default: {
      const exhaustive: never = format;
      throw new Error(`Unsupported export format: ${exhaustive}`);
    }
  }
}
