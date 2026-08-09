import { z } from "zod";
import { grantApiError } from "@/app/api/grants/_shared";
import { requireGrantEvidenceRequestContext } from "@/lib/grants/server/request-context";
import { readGrantEvidenceUpload } from "@/lib/grants/server/read-evidence-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const MetadataSchema = z.object({
  provenanceType: z.enum(["published_literature", "own_unpublished_work", "project_material"]),
  sensitivity: z.enum(["public", "project_confidential", "unpublished_research", "highly_sensitive"]),
}).strict();

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { evidence } = await requireGrantEvidenceRequestContext();
    return Response.json(await evidence.list(z.string().uuid().parse(id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "list_grant_evidence");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const documentId = z.string().uuid().parse(id);
    const upload = await readGrantEvidenceUpload(request);
    const metadata = MetadataSchema.parse({ provenanceType: upload.provenanceType, sensitivity: upload.sensitivity });
    const { user, evidence } = await requireGrantEvidenceRequestContext();
    return Response.json(await evidence.upload({
      ownerId: user.id,
      actorId: user.id,
      documentId,
      fileName: upload.fileName,
      mediaType: upload.mediaType,
      buffer: upload.buffer,
      ...metadata,
    }), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return grantApiError(error, "upload_grant_evidence");
  }
}
