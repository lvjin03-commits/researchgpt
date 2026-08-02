import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentFinalizer } from "@/lib/document-v2/runtime/job-service";
import { renderFinalDocumentSpecToDocx } from "@/lib/document-v2/renderers/docx";
import { assertRenderedDocumentQuality } from "@/lib/document-v2/renderers/quality";
import { assembleDocumentManifest } from "@/lib/document-v2/assembly/manifest";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/uploads/storage-constants";
import type { ExportRecord } from "@/lib/export/types";
import { hydrateFigureAssets, storeDocx } from "./artifact-storage";

export function createDocumentFinalizer(input: {
  supabase: SupabaseClient;
  ownerId: string;
}): DocumentFinalizer {
  return {
    async renderAndStore({ jobId, spec, shouldCancel }) {
      const hydratedSpec = await hydrateFigureAssets(input.supabase, spec);
      const buffer = await renderFinalDocumentSpecToDocx(hydratedSpec);
      if (await shouldCancel()) throw new Error("Document job was cancelled.");
      return {
        artifactId: await storeDocx(
          input.supabase,
          input.ownerId,
          jobId,
          buffer,
        ),
      };
    },
    async validateArtifact({ artifactId, spec, shouldCancel }) {
      if (await shouldCancel()) throw new Error("Document job was cancelled.");
      const metaPath = `${input.ownerId}/exports/${artifactId}.meta.json`;
      const metadata = await input.supabase.storage
        .from(CHAT_ATTACHMENTS_BUCKET)
        .download(metaPath);
      if (metadata.error || !metadata.data) {
        throw metadata.error ?? new Error("Rendered DOCX metadata is missing.");
      }
      const record = JSON.parse(await metadata.data.text()) as ExportRecord;
      if (!record.storageBucket || !record.storagePath) {
        throw new Error("Rendered DOCX metadata is incomplete.");
      }
      const file = await input.supabase.storage
        .from(record.storageBucket)
        .download(record.storagePath);
      if (file.error || !file.data) {
        throw file.error ?? new Error("Rendered DOCX is missing.");
      }
      const buffer = Buffer.from(await file.data.arrayBuffer());
      await assertRenderedDocumentQuality({
        buffer,
        spec,
        assembly: assembleDocumentManifest(spec),
      });
    },
  };
}
