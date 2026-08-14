import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantWebSourceRequestContext } from "@/lib/grants/server/request-context";

const BodySchema = z.object({ searchSessionId: z.string().uuid(), resultIds: z.array(z.string().uuid()).min(1).max(5) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const documentId = z.string().uuid().parse(id);
    const body = BodySchema.parse(await request.json());
    const { user, webSources } = await requireGrantWebSourceRequestContext();
    return Response.json(await webSources.confirmSources({ ...body, documentId, ownerId: user.id, actorId: user.id }));
  } catch (error) { return grantApiError(error, "confirm_grant_web_sources"); }
}
