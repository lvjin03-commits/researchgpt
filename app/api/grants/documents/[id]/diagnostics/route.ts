import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantRequestContext } from "@/lib/grants/server/request-context";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const targetRevisionId = new URL(request.url).searchParams.get("targetRevisionId") ?? undefined;
    const { diagnostics, feedback } = await requireGrantRequestContext();
    const documentId = z.string().uuid().parse(id);
    const [diagnosticResult, dispositions] = await Promise.all([
      diagnostics.list(documentId, targetRevisionId ? z.string().uuid().parse(targetRevisionId) : undefined),
      feedback.list(documentId),
    ]);
    return Response.json({ ...diagnosticResult, feedback: dispositions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "list_grant_diagnostics");
  }
}

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { user, diagnostics } = await requireGrantRequestContext();
    return Response.json(await diagnostics.run(z.string().uuid().parse(id), user.id), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "run_grant_diagnostics");
  }
}
