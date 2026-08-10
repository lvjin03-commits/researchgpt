import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { GrantFigureModelPermissionsSchema } from "@/lib/grants/domain/figure-assets";
import { requireGrantRequestContext } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const UpdateSchema = z.object({
  expectedAuthorizationRevision: z.number().int().nonnegative(),
  allowedAssetIds: z.array(z.string().uuid()).min(1),
  permissions: GrantFigureModelPermissionsSchema,
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

const RevokeSchema = z.object({
  expectedAuthorizationRevision: z.number().int().positive(),
}).strict();

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { figureAuthorization } = await requireGrantRequestContext();
    return Response.json(await figureAuthorization.getCurrent(z.string().uuid().parse(id)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return grantApiError(error, "get_grant_figure_authorization");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = UpdateSchema.parse(await request.json());
    const { user, figureAuthorization } = await requireGrantRequestContext();
    return Response.json(await figureAuthorization.authorize({
      documentId: z.string().uuid().parse(id),
      actorId: user.id,
      ...body,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "update_grant_figure_authorization");
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = RevokeSchema.parse(await request.json());
    const { user, figureAuthorization } = await requireGrantRequestContext();
    return Response.json(await figureAuthorization.revoke({
      documentId: z.string().uuid().parse(id),
      actorId: user.id,
      ...body,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "revoke_grant_figure_authorization");
  }
}
