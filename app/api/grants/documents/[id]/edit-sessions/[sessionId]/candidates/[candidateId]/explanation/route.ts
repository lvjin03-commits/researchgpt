import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantCandidateExplanationRequestContext } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; sessionId: string; candidateId: string }> };

async function identifiers(context: Context) {
  const params = await context.params;
  return {
    documentId: z.string().uuid().parse(params.id),
    sessionId: z.string().uuid().parse(params.sessionId),
    candidateId: z.string().uuid().parse(params.candidateId),
  };
}

export async function GET(_request: Request, context: Context) {
  try {
    const input = await identifiers(context);
    const { candidateExplanation } = await requireGrantCandidateExplanationRequestContext();
    return Response.json(await candidateExplanation.getDiff(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "get_grant_candidate_diff");
  }
}

export async function POST(_request: Request, context: Context) {
  try {
    const input = await identifiers(context);
    const { candidateExplanation } = await requireGrantCandidateExplanationRequestContext();
    return Response.json(await candidateExplanation.explain(input), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "explain_grant_candidate");
  }
}
