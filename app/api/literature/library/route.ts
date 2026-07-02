import { LiteratureError } from "@/lib/literature/errors";
import { parseLibraryFilters } from "@/lib/literature/server/library";
import {
  getPaperCategoryIdsMap,
  listLiteratureCategories,
} from "@/lib/literature/server/category-repository";
import { listLiteratureLibraryPapers } from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { searchParams } = new URL(request.url);
    const filters = parseLibraryFilters(searchParams);
    const [paperCategoryIds, categories] = await Promise.all([
      getPaperCategoryIdsMap(supabase, user.id),
      listLiteratureCategories(supabase, user.id),
    ]);
    const papers = await listLiteratureLibraryPapers(
      supabase,
      user.id,
      filters,
      paperCategoryIds,
    );

    return Response.json({ papers, categories });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] GET library failed:", error);
    return Response.json({ error: "Failed to load literature library." }, { status: 500 });
  }
}
