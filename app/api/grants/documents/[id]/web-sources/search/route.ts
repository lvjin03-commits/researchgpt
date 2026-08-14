import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantWebSourceRequestContext } from "@/lib/grants/server/request-context";

const BodySchema = z.object({ query: z.string().trim().min(2).max(500) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = BodySchema.parse(await request.json());
    const { user, webSources } = await requireGrantWebSourceRequestContext();
    return Response.json(await webSources.search({ documentId: z.string().uuid().parse(id), query: body.query, actorId: user.id }));
  } catch (error) { return grantApiError(error, "search_grant_web_sources"); }
}
