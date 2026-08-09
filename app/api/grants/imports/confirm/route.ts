import { requireGrantRequestContext } from "@/lib/grants/server/request-context";
import { grantApiError } from "../../_shared";
import { readGrantDocxUpload } from "@/lib/grants/server/read-docx-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user, docxImporter } = await requireGrantRequestContext();
    const result = await docxImporter.confirm({ ownerId: user.id, ...await readGrantDocxUpload(request) });
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store", Location: `/grants/${result.aggregate.document.documentId}` },
    });
  } catch (error) {
    return grantApiError(error, "imports.confirm");
  }
}
