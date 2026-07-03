import { LiteratureError } from "@/lib/literature/errors";
import { getPaperCitationNetwork } from "@/lib/literature/server/citation-network-service";
import { getLiteraturePaperById } from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const paper = await getLiteraturePaperById(supabase, user.id, id);
    const citationNetwork = await getPaperCitationNetwork(paper);

    return Response.json(citationNetwork);
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] GET paper citation network failed:", error);
    return Response.json(
      { error: "Failed to load paper citation network." },
      { status: 500 },
    );
  }
}
