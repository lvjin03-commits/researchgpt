import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantDocxExportRequestContext } from "@/lib/grants/server/request-context";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { exports } = await requireGrantDocxExportRequestContext();
    const artifact = await exports.exportCurrentDocx(z.string().uuid().parse(id));
    const encodedName = encodeURIComponent(artifact.fileName);
    return new Response(new Uint8Array(artifact.buffer), {
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "no-store",
        "X-Grant-Source-Revision": artifact.sourceRevisionId,
        "X-Grant-Export-Warning-Count": String(artifact.warnings.length),
      },
    });
  } catch (error) {
    return grantApiError(error, "export_grant_docx");
  }
}
