import { LiteratureError } from "@/lib/literature/errors";
import {
  deleteLiteratureCategory,
  updateLiteratureCategory,
} from "@/lib/literature/server/category-repository";
import { parseCategoryName } from "@/lib/literature/server/parse";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const body = await request.json();
    const name = parseCategoryName(body);
    const category = await updateLiteratureCategory(
      supabase,
      user.id,
      id,
      name,
    );

    return Response.json({ category });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] PATCH category failed:", error);
    return Response.json({ error: "Failed to update category." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    await deleteLiteratureCategory(supabase, user.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] DELETE category failed:", error);
    return Response.json({ error: "Failed to delete category." }, { status: 500 });
  }
}
