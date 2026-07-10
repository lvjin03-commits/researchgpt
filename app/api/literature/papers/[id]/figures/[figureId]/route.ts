import { LiteratureError } from "@/lib/literature/errors";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import { getLiteraturePaperById } from "@/lib/literature/server/repository";

export const runtime = "nodejs";

const LITERATURE_PDFS_BUCKET = "literature-pdfs";

type RouteContext = {
  params: Promise<{ id: string; figureId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id, figureId } = await context.params;
    const paper = await getLiteraturePaperById(supabase, user.id, id);
    const evidence = paper.figureEvidence?.find(
      (item) => item.id === figureId && item.imageStoragePath,
    );

    if (!evidence?.imageStoragePath) {
      throw new LiteratureError("未找到提取的图表。", 404);
    }
    const allowedPrefix = `${user.id}/${paper.id}/figures/`;
    if (!evidence.imageStoragePath.startsWith(allowedPrefix)) {
      throw new LiteratureError("图表存储路径无效。", 403);
    }

    const { data, error } = await supabase.storage
      .from(LITERATURE_PDFS_BUCKET)
      .download(evidence.imageStoragePath);
    if (error || !data) {
      throw new LiteratureError("无法读取提取的图表。", 404);
    }

    return new Response(await data.arrayBuffer(), {
      headers: {
        "Content-Type": evidence.imageMimeType ?? "image/png",
        "Content-Disposition": `inline; filename="${encodeURIComponent(evidence.label)}.png"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] extracted figure read failed:", error);
    return Response.json({ error: "无法读取提取的图表。" }, { status: 500 });
  }
}
