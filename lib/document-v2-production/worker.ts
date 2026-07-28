import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import JSZip from "jszip";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DocumentJobSchema, type DocumentJob } from "@/lib/document-v2/runtime/contracts";
import { SupabaseDocumentJobRepository } from "@/lib/document-v2/runtime/supabase-repository";
import { DocumentV2JobService } from "@/lib/document-v2/runtime/job-service";
import { ModelDocumentComponentGenerator } from "@/lib/document-v2/generation/model-component-generator";
import { MatureDocumentComponentValidator } from "@/lib/document-v2/generation/mature-content-validator";
import { ValidatedFigureAssetPipeline } from "@/lib/document-v2/assets/figure-pipeline";
import { renderFinalDocumentSpecToDocx } from "@/lib/document-v2/renderers/docx";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/uploads/storage-constants";
import type { ExportRecord } from "@/lib/export/types";
import {
  OpenAIFinalFigureGenerator,
  OpenAIStructuredComponentModel,
} from "./openai-adapters";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Background worker database credentials are missing.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function claimNext(
  supabase: SupabaseClient,
  workerId: string,
): Promise<DocumentJob | null> {
  const now = new Date();
  const { data, error } = await supabase.rpc("claim_next_document_v2_job", {
    target_worker_id: workerId,
    lease_now: now.toISOString(),
    lease_expires: new Date(now.getTime() + 4 * 60_000).toISOString(),
  });
  if (error) throw error;
  return data ? DocumentJobSchema.parse(data) : null;
}

async function storeDocx(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  buffer: Buffer,
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file("word/document.xml")) throw new Error("Rendered DOCX is invalid.");
  const id = randomUUID();
  const filename = `researchgpt-${jobId}.docx`;
  const storagePath = `${ownerId}/exports/${id}-${filename}`;
  const metaPath = `${ownerId}/exports/${id}.meta.json`;
  const record: ExportRecord = {
    id,
    filename,
    mimeType: DOCX_MIME,
    userId: ownerId,
    createdAt: Date.now(),
    storageBucket: CHAT_ATTACHMENTS_BUCKET,
    storagePath,
  };
  const bucket = supabase.storage.from(CHAT_ATTACHMENTS_BUCKET);
  const uploaded = await bucket.upload(storagePath, buffer, {
    contentType: DOCX_MIME,
    upsert: false,
  });
  if (uploaded.error) throw uploaded.error;
  const metadata = await bucket.upload(
    metaPath,
    Buffer.from(JSON.stringify(record), "utf8"),
    { contentType: "application/json; charset=utf-8", upsert: false },
  );
  if (metadata.error) {
    await bucket.remove([storagePath]);
    throw metadata.error;
  }
  return id;
}

export async function executeOneDocumentV2Tick() {
  const supabase = adminClient();
  const workerId = `vercel-${randomUUID()}`;
  const job = await claimNext(supabase, workerId);
  if (!job) return { state: "idle" as const };

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const repository = new SupabaseDocumentJobRepository(supabase, job.ownerId);
  const service = new DocumentV2JobService(
    repository,
    {
      generator: new ModelDocumentComponentGenerator(
        new OpenAIStructuredComponentModel(openai),
      ),
      validator: new MatureDocumentComponentValidator(),
      figureAssetMaterializer: new ValidatedFigureAssetPipeline(
        new OpenAIFinalFigureGenerator(openai),
      ),
      maxAttemptsPerComponent: 2,
    },
    {
      async renderAndStore({ jobId, spec, onStage, shouldCancel }) {
        await onStage("docx_rendering");
        const buffer = await renderFinalDocumentSpecToDocx(spec);
        if (await shouldCancel()) throw new Error("Document job was cancelled.");
        await onStage("quality_check");
        await onStage("artifact_storage");
        return {
          artifactId: await storeDocx(
            supabase,
            job.ownerId,
            jobId,
            buffer,
          ),
        };
      },
    },
  );
  const snapshot = await service.run(job.jobId, workerId, {
    maxComponents: 1,
  });
  return {
    state: snapshot.job.status,
    jobId: snapshot.job.jobId,
    stage: snapshot.job.stage,
    progress: snapshot.job.progress,
  };
}
