import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantAiEditSessionRequestContext } from "@/lib/grants/server/request-context";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; sessionId: string }> };
const BodySchema = z.object({ candidateId: z.string().uuid() }).strict();
export async function POST(request: Request, context: Context) {
  try {
    const { id, sessionId } = await context.params;
    const documentId = z.string().uuid().parse(id);
    const parsedSessionId = z.string().uuid().parse(sessionId);
    const body = BodySchema.parse(await request.json());
    const { user, editSessions } = await requireGrantAiEditSessionRequestContext();
    const current = await editSessions.getSession(parsedSessionId);
    if (current.session.documentId !== documentId) return Response.json({ error: "Edit Session not found.", code: "session_not_found" }, { status: 404 });
    return Response.json(await editSessions.applyActiveCandidate({ sessionId: parsedSessionId, candidateId: body.candidateId, actorId: user.id }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return grantApiError(error, "apply_grant_ai_edit_candidate"); }
}

