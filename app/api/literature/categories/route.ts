import { LiteratureError } from "@/lib/literature/errors";
import {
  createLiteratureCategory,
  listLiteratureCategories,
} from "@/lib/literature/server/category-repository";
import { parseCategoryName } from "@/lib/literature/server/parse";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const categories = await listLiteratureCategories(supabase, user.id);
    return Response.json({ categories });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] GET categories failed:", error);
    return Response.json({ error: "Failed to load categories." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const body = await request.json();
    const name = parseCategoryName(body);
    const category = await createLiteratureCategory(supabase, user.id, name);
    return Response.json({ category });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] POST category failed:", error);
    return Response.json({ error: "Failed to create category." }, { status: 500 });
  }
}
