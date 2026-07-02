import { LiteratureError } from "@/lib/literature/errors";
import {
  getLiteratureSettings,
  listLiteraturePapers,
  saveLiteratureSettings,
} from "@/lib/literature/server/repository";
import { parseLiteratureSettings } from "@/lib/literature/server/parse";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const [settings, papers] = await Promise.all([
      getLiteratureSettings(supabase, user.id),
      listLiteraturePapers(supabase, user.id),
    ]);

    return Response.json({ settings, papers });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] GET failed:", error);
    return Response.json({ error: "Failed to load literature tracker." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const body = await request.json();
    const settings = parseLiteratureSettings(body);
    await saveLiteratureSettings(supabase, user.id, settings);

    return Response.json({ settings });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] PUT settings failed:", error);
    return Response.json({ error: "Failed to save literature settings." }, { status: 500 });
  }
}
