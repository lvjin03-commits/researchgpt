import { requireGrantRequestContext } from "@/lib/grants/server/request-context";
import { grantApiError } from "../../_shared";
import { readGrantDocxUpload } from "@/lib/grants/server/read-docx-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { docxImporter } = await requireGrantRequestContext();
    const preview = await docxImporter.preview(await readGrantDocxUpload(request));
    return Response.json({ preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "imports.preview");
  }
}
