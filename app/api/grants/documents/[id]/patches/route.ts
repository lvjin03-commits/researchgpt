import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantAiPatchRequestContext, requireGrantEvidencePatchEnabled } from "@/lib/grants/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const ProposalRequestSchema = z.object({
  baseRevisionId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  findingId: z.string().uuid().optional(),
  instruction: z.string().trim().min(1).max(2000),
  editMode: z.enum(["replace", "replace_selection", "insert_after"]).default("replace"),
  selection: z.object({ startOffset: z.number().int().nonnegative(), endOffset: z.number().int().positive(), text: z.string().min(1) }).strict().optional(),
  evidenceSourceIds: z.array(z.string().uuid()).max(8).default([]),
}).strict();

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { patches } = await requireGrantAiPatchRequestContext();
    return Response.json(await patches.list(z.string().uuid().parse(id)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return grantApiError(error, "list_grant_patch_proposals");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const documentId = z.string().uuid().parse(id);
    const body = ProposalRequestSchema.parse(await request.json());
    if (body.evidenceSourceIds.length > 0) requireGrantEvidencePatchEnabled();
    const { user, patches } = await requireGrantAiPatchRequestContext();
    return Response.json(await patches.propose({ documentId, ...body, actorId: user.id }), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return grantApiError(error, "create_grant_patch_proposal");
  }
}
