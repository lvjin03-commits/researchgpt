import { LiteratureError } from "@/lib/literature/errors";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import { getLiteraturePaperById } from "@/lib/literature/server/repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function contentDispositionFileName(fileName: string): string {
  return fileName.replace(/["\\\r\n]/g, "_") || "paper.pdf";
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

    const fileName = contentDispositionFileName(
      paper.pdfFileName || `${paper.title}.pdf`,
    );

    return new Response(data, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
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
