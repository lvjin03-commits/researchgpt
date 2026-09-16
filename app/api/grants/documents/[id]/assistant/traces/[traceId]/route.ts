import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantAssistantChatRequestContext } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; traceId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const documentId = z.string().uuid().parse(params.id);
    const traceId = z.string().uuid().parse(params.traceId);
    const { assistantChat } = await requireGrantAssistantChatRequestContext();
    return Response.json(await assistantChat.getTraceDiagnostics(documentId, traceId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return grantApiError(error, "get_grant_assistant_trace_diagnostics");
  }
}
