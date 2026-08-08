import { z } from "zod";
import { requireGrantRequestContext } from "@/lib/grants/server/request-context";
import { grantApiError } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateDocumentSchema = z.object({ title: z.string().trim().min(1).max(160) }).strict();

export async function GET() {
  try {
    const { editor } = await requireGrantRequestContext();
    return Response.json({ documents: await editor.listDocuments() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "documents.list");
  }
}

export async function POST(request: Request) {
  try {
    const { user, editor } = await requireGrantRequestContext();
    const input = CreateDocumentSchema.parse(await request.json());
    const aggregate = await editor.createDocument({ ownerId: user.id, title: input.title });
    return Response.json({ aggregate }, {
      status: 201,
      headers: { "Cache-Control": "no-store", Location: `/grants/${aggregate.document.documentId}` },
    });
  } catch (error) {
    return grantApiError(error, "documents.create");
  }
}
