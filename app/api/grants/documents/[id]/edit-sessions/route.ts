import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantAiEditSessionRequestContext } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const CreateSchema = z.object({
  baseRevisionId: z.string().uuid(), targetNodeId: z.string().uuid(), expectedNodeHash: z.string().regex(/^[a-f0-9]{64}$/),
  editMode: z.enum(["replace", "replace_selection", "insert_after"]), originFindingId: z.string().uuid().optional(),
  selectedText: z.string().min(1).optional(), selectionStart: z.number().int().nonnegative().optional(), selectionEnd: z.number().int().positive().optional(),
}).strict();

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const documentId = z.string().uuid().parse(id);
    const body = CreateSchema.parse(await request.json());
    const { user, editSessions } = await requireGrantAiEditSessionRequestContext();
    return Response.json(await editSessions.createSession({ documentId, ...body, actorId: user.id }), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return grantApiError(error, "create_grant_ai_edit_session"); }
}

