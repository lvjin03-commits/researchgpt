import { z } from "zod";
import { CanonicalGrantSnapshotSchema } from "@/lib/grants/domain/contracts";
import { requireGrantRequestContext } from "@/lib/grants/server/request-context";
import { grantApiError } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SaveDocumentSchema = z.object({
  expectedRevisionId: z.string().uuid(),
  snapshot: CanonicalGrantSnapshotSchema,
}).strict();

const DeleteDocumentSchema = z.object({
  expectedRevisionId: z.string().uuid(),
}).strict();

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { editor } = await requireGrantRequestContext();
    return Response.json(await editor.loadDocument(z.string().uuid().parse(id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "document.get");
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { user, editor } = await requireGrantRequestContext();
    const input = SaveDocumentSchema.parse(await request.json());
    return Response.json(await editor.saveDocument({
      documentId: z.string().uuid().parse(id),
      expectedRevisionId: input.expectedRevisionId,
      actorId: user.id,
      snapshot: input.snapshot,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "document.save");
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { user, editor } = await requireGrantRequestContext();
    const input = DeleteDocumentSchema.parse(await request.json());
    await editor.deleteDocument({
      documentId: z.string().uuid().parse(id),
      expectedRevisionId: input.expectedRevisionId,
      actorId: user.id,
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "document.delete");
  }
}
