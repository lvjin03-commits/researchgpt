import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { GrantEvidencePermissionsSchema } from "@/lib/grants/evidence/contracts";
import { requireGrantEvidenceRequestContext } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; sourceId: string }> };

const RequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  permissions: GrantEvidencePermissionsSchema,
  allowedTaskIds: z.array(z.string().uuid()).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export async function PATCH(request: Request, context: Context) {
  try {
    const params = await context.params;
    const documentId = z.string().uuid().parse(params.id);
    const sourceId = z.string().uuid().parse(params.sourceId);
    const body = RequestSchema.parse(await request.json());
    const { user, evidence } = await requireGrantEvidenceRequestContext();
    return Response.json(await evidence.authorization.update({ documentId, sourceId, actorId: user.id, ...body }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return grantApiError(error, "update_grant_evidence_authorization");
  }
}
