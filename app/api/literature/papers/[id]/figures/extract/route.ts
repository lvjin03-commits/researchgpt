import { LiteratureError } from "@/lib/literature/errors";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import { extractAndStoreLiteraturePaperFigures } from "@/lib/literature/server/figure-extraction";
import {
  getLiteraturePaperById,
  stripLiteraturePaperFullTextForResponse,
} from "@/lib/literature/server/repository";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const paper = await getLiteraturePaperById(supabase, user.id, id);

    if (paper.pdfDownloadStatus !== "stored") {
      throw new LiteratureError("请先上传并保存 PDF 全文。", 422);
    }

    const result = await extractAndStoreLiteraturePaperFigures(
      supabase,
      user.id,
      paper,
    );

    return Response.json({
      paper: stripLiteraturePaperFullTextForResponse(result.paper),
      summary: result.summary,
    });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] figure extraction failed:", error);
    return Response.json({ error: "图表提取失败。" }, { status: 500 });
  }
}
