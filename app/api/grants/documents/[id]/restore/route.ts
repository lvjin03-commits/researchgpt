import { z } from "zod";
import { requireGrantRequestContext } from "@/lib/grants/server/request-context";
import { grantApiError } from "../../../_shared";

export const runtime = "nodejs";

const RestoreSchema = z.object({
  expectedRevisionId: z.string().uuid(),
  sourceRevisionId: z.string().uuid(),
}).strict();
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { user, editor } = await requireGrantRequestContext();
    const input = RestoreSchema.parse(await request.json());
    return Response.json(await editor.restoreRevision({
      documentId: z.string().uuid().parse(id),
      expectedRevisionId: input.expectedRevisionId,
      sourceRevisionId: input.sourceRevisionId,
      actorId: user.id,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "document.restore");
  }
}
