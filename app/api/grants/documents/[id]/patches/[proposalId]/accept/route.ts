import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantAiPatchRequestContext } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id, proposalId } = await context.params;
    const { user, patches } = await requireGrantAiPatchRequestContext();
    return Response.json(await patches.accept(
      z.string().uuid().parse(id),
      z.string().uuid().parse(proposalId),
      user.id,
    ), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "accept_grant_patch_proposal");
  }
}

