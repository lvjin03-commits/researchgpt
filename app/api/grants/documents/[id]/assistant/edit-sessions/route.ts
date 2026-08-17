import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantAssistantChatRequestContext } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const RequestSchema = z.object({ editSessionId: z.string().uuid() }).strict();

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const documentId = z.string().uuid().parse(id);
    const body = RequestSchema.parse(await request.json());
    const { assistantChat } = await requireGrantAssistantChatRequestContext();
    return Response.json(await assistantChat.linkEditSession({ documentId, editSessionId: body.editSessionId }), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "link_grant_assistant_edit_session");
  }
}
