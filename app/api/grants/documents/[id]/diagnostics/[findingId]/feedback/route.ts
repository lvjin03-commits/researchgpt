import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantRequestContext } from "@/lib/grants/server/request-context";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; findingId: string }> };

const RequestSchema = z.object({ disposition: z.unknown() }).strict();

export async function PATCH(request: Request, context: Context) {
  try {
    const { id, findingId } = await context.params;
    const body = RequestSchema.parse(await request.json());
    const { user, feedback } = await requireGrantRequestContext();
    return Response.json(await feedback.setDisposition({
      documentId: z.string().uuid().parse(id),
      findingId: z.string().uuid().parse(findingId),
      disposition: body.disposition,
      actorId: user.id,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "set_grant_finding_feedback");
  }
}
