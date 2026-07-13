import { buildExportFilename } from "@/lib/export/filename";
import { saveExport } from "@/lib/export/store";
import { LiteratureError } from "@/lib/literature/errors";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import { generateReviewPptxBuffer } from "@/lib/literature/server/review-pptx";
import { generateExportBuffer } from "@/lib/export/generators/generate-buffer";
import { isPresentationTemplateId } from "@/lib/presentation/templates";
import type { PresentationTemplateId } from "@/lib/literature/review/types";

export const runtime = "nodejs";

type ReviewExportRequest = {
  format?: unknown;
  title?: unknown;
  content?: unknown;
  templateId?: unknown;
};

export async function POST(request: Request) {
  try {
    const { user } = await requireLiteratureUser();
    const body = (await request.json()) as ReviewExportRequest;
    const format = typeof body.format === "string" ? body.format.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const templateId: PresentationTemplateId = isPresentationTemplateId(
      body.templateId,
    )
      ? body.templateId
      : "research-modern";

    if (format !== "pptx" && format !== "docx") {
      throw new LiteratureError('format 必须是 "docx" 或 "pptx"。', 400);
    }

    if (!title) {
      throw new LiteratureError("title 不能为空。", 400);
    }

    if (!content) {
      throw new LiteratureError("content 不能为空。", 400);
    }

    const buffer =
      format === "pptx"
        ? await generateReviewPptxBuffer(title, content, templateId)
        : await generateExportBuffer("docx", {
            title,
            content,
            metadata: { artifactType: "literature-outline" },
          });

    const filename = buildExportFilename(title, format);
    const mimeType =
      format === "pptx"
        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const record = await saveExport({
      filename,
      mimeType,
      userId: user.id,
      buffer,
    });

    return Response.json({
      success: true,
      filename: record.filename,
      downloadUrl: `/api/download/${record.id}`,
    });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json(
        { success: false, error: error.message },
        { status: error.statusCode },
      );
    }

    console.error("[literature] review export failed:", error);
    return Response.json(
      { success: false, error: "导出失败。" },
      { status: 500 },
    );
  }
}
