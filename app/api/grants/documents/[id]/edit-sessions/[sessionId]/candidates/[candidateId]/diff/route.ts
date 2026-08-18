import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantCandidateDiffRequestContext } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; sessionId: string; candidateId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const params = await context.params;
    const input = {
      documentId: z.string().uuid().parse(params.id),
      sessionId: z.string().uuid().parse(params.sessionId),
      candidateId: z.string().uuid().parse(params.candidateId),
    };
    const { candidateDiff } = await requireGrantCandidateDiffRequestContext();
    return Response.json(await candidateDiff.getDiff(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "get_grant_candidate_diff");
  }
}
