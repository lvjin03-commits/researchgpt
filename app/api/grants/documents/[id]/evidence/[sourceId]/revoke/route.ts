import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantEvidenceRequestContext } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; sourceId: string }> };

const RequestSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();

export async function POST(request: Request, context: Context) {
  try {
    const params = await context.params;
    const body = RequestSchema.parse(await request.json());
    const { user, evidence } = await requireGrantEvidenceRequestContext();
    return Response.json(await evidence.authorization.revoke({
      documentId: z.string().uuid().parse(params.id),
      sourceId: z.string().uuid().parse(params.sourceId),
      expectedRevision: body.expectedRevision,
      actorId: user.id,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "revoke_grant_evidence");
  }
}
