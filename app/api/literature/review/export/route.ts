import { buildExportFilename } from "@/lib/export/filename";
import { LiteratureError } from "@/lib/literature/errors";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import { generateReviewPptxBuffer } from "@/lib/literature/server/review-pptx";
import { generateLiteratureMatrixXlsxBuffer } from "@/lib/literature/server/review-matrix-xlsx";
import { generateExportBuffer } from "@/lib/export/generators/generate-buffer";
import { isPresentationTemplateId } from "@/lib/presentation/templates";
import type { PresentationTemplateId } from "@/lib/literature/review/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type ReviewExportRequest = {
  format?: unknown;
  title?: unknown;
  content?: unknown;
  templateId?: unknown;
};

export async function POST(request: Request) {
  try {
    await requireLiteratureUser();
    const body = (await request.json()) as ReviewExportRequest;
    const format = typeof body.format === "string" ? body.format.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const templateId: PresentationTemplateId = isPresentationTemplateId(
      body.templateId,
    )
      ? body.templateId
      : "research-modern";

    if (
      format !== "pptx" &&
      format !== "docx" &&
      format !== "xlsx" &&
      format !== "pdf" &&
      format !== "svg" &&
      format !== "png"
    ) {
      throw new LiteratureError("不支持该导出格式。", 400);
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
        : format === "xlsx"
          ? generateLiteratureMatrixXlsxBuffer(content)
          : await generateExportBuffer(format, {
              title,
              content,
              metadata: { artifactType: "literature-outline" },
            });

    const filename = buildExportFilename(title, format);
    const mimeType =
      format === "pptx"
        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : format === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : format === "pdf"
              ? "application/pdf"
              : format === "png"
                ? "image/png"
                : "image/svg+xml; charset=utf-8";

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Export-Filename": encodeURIComponent(filename),
        "Cache-Control": "no-store",
      },
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
