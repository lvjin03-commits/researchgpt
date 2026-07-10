import { LiteratureError } from "@/lib/literature/errors";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import { getLiteraturePaperById } from "@/lib/literature/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function contentDispositionFileName(fileName: string): string {
  const normalized = fileName.trim() || "paper.pdf";
  const asciiFallback =
    normalized
      .replace(/\.pdf$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "paper";
  const fallbackFileName = asciiFallback.toLowerCase().endsWith(".pdf")
    ? asciiFallback
    : `${asciiFallback}.pdf`;
  const encodedFileName = encodeURIComponent(normalized).replace(/['()]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodedFileName}`;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;

    const paper = await getLiteraturePaperById(supabase, user.id, id);

    if (paper.pdfDownloadStatus !== "stored" || !paper.pdfStoragePath) {
      return Response.json(
        { error: "Stored PDF not found for this paper." },
        { status: 404 },
      );
    }

    const { data, error } = await supabase.storage
      .from("literature-pdfs")
      .download(paper.pdfStoragePath);

    if (error || !data) {
      return Response.json(
        { error: error?.message || "Stored PDF could not be opened." },
        { status: 404 },
      );
    }

    const contentDisposition = contentDispositionFileName(
      paper.pdfFileName || `${paper.title}.pdf`,
    );

    return new Response(data, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    console.error("[literature] stored PDF open failed:", error);
    return Response.json(
      { error: "Failed to open stored PDF." },
      { status: 500 },
    );
  }
}
