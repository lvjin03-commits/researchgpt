import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantAssistantChatRequestContext } from "@/lib/grants/server/request-context";
import { GrantAssistantCandidateContextSchema, GrantAssistantDocumentSelectionContextSchema } from "@/lib/grants/assistant/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const RequestSchema = z.object({
  expectedRevisionId: z.string().uuid(),
  turnId: z.string().uuid(),
  message: z.string().trim().min(1).max(12000),
  contextCards: z.array(GrantAssistantDocumentSelectionContextSchema).max(8).default([]),
  evidenceSourceIds: z.array(z.string().uuid()).max(8).default([]),
  focusId: z.string().uuid().nullable().optional(),
  ignoreAmbiguousFocus: z.boolean().optional(),
  candidateContext: GrantAssistantCandidateContextSchema.nullable().optional(),
}).strict();

function normalizeRequestPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const value = { ...(payload as Record<string, unknown>) };
  if (value.focusId === "") value.focusId = null;
  // A normal chat turn must not be blocked by browser selections left over
  // from an earlier revision. Explicit focus keeps the strict contract.
  if (value.focusId == null) value.contextCards = [];
  if (Array.isArray(value.evidenceSourceIds)) {
    value.evidenceSourceIds = value.evidenceSourceIds.filter((id) => typeof id === "string" && z.string().uuid().safeParse(id).success);
  }
  return value;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const documentId = z.string().uuid().parse(id);
    const { assistantChat } = await requireGrantAssistantChatRequestContext();
    return Response.json(await assistantChat.getCurrent(documentId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "get_grant_assistant_chat");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const documentId = z.string().uuid().parse(id);
    const body = RequestSchema.parse(normalizeRequestPayload(await request.json()));
    const { assistantChat } = await requireGrantAssistantChatRequestContext();
    return Response.json(await assistantChat.answer({ documentId, ...body }), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "grant_assistant_chat");
  }
}
