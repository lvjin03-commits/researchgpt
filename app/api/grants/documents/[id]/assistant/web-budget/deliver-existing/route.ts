import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { GrantWebDeliverExistingCommandSchema } from "@/lib/grants/application/grant-web-budget-commands";
import { requireGrantWebBudgetRequestContext } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const documentId = z.string().uuid().parse((await context.params).id);
    const command = GrantWebDeliverExistingCommandSchema.parse(await request.json());
    const { webBudget } = await requireGrantWebBudgetRequestContext();
    return Response.json(await webBudget.deliverExistingStored({ documentId, command }),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return grantApiError(error, "deliver_existing_grant_web_results"); }
}
