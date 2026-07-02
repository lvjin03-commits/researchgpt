import { LiteratureError } from "@/lib/literature/errors";
import { setPaperCategoryIds } from "@/lib/literature/server/category-repository";
import { parsePaperCategoryIds } from "@/lib/literature/server/parse";
import { getLiteraturePaperById } from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const body = await request.json();
    const categoryIds = parsePaperCategoryIds(body);

    await getLiteraturePaperById(supabase, user.id, id);
    const assignedCategoryIds = await setPaperCategoryIds(
      supabase,
      user.id,
      id,
      categoryIds,
    );

    return Response.json({ paperId: id, categoryIds: assignedCategoryIds });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] PUT paper categories failed:", error);
    return Response.json(
      { error: "Failed to update paper categories." },
      { status: 500 },
    );
  }
}
