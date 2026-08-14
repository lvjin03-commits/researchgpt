import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantAiEditSessionRequestContext } from "@/lib/grants/server/request-context";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; sessionId: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { id, sessionId } = await context.params;
    const documentId = z.string().uuid().parse(id);
    const { editSessions } = await requireGrantAiEditSessionRequestContext();
    const result = await editSessions.getSession(z.string().uuid().parse(sessionId));
    if (result.session.documentId !== documentId) return Response.json({ error: "Edit Session not found.", code: "session_not_found" }, { status: 404 });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return grantApiError(error, "get_grant_ai_edit_session"); }
}

