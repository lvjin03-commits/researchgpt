import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DocumentJobEventSchema,
  DocumentJobSchema,
  type DocumentJob,
  type DocumentJobEvent,
} from "./contracts";
import {
  DocumentJobConflictError,
  type DocumentJobRepository,
} from "./repository";

type JobRow = {
  job_payload: unknown;
};

type EventRow = {
  event_payload: unknown;
};

export class SupabaseDocumentJobRepository
  implements DocumentJobRepository
{
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly ownerId: string,
  ) {}

  async create(job: DocumentJob): Promise<void> {
    const parsed = DocumentJobSchema.parse(job);
    if (parsed.ownerId !== this.ownerId) {
      throw new Error("Cannot create a document job for another owner.");
    }
    const { error } = await this.supabase.from("document_v2_jobs").insert({
      id: parsed.jobId,
      owner_id: parsed.ownerId,
      status: parsed.status,
      stage: parsed.stage,
      revision: parsed.revision,
      lease_owner: parsed.leaseOwner ?? null,
      lease_expires_at: parsed.leaseExpiresAt ?? null,
      job_payload: parsed,
      created_at: parsed.createdAt,
      updated_at: parsed.updatedAt,
    });
    if (error) throw error;
  }

  async get(jobId: string): Promise<DocumentJob | null> {
    const { data, error } = await this.supabase
      .from("document_v2_jobs")
      .select("job_payload")
      .eq("id", jobId)
      .eq("owner_id", this.ownerId)
      .maybeSingle();
    if (error) throw error;
    return data
      ? DocumentJobSchema.parse((data as JobRow).job_payload)
      : null;
  }

  async listEvents(jobId: string): Promise<DocumentJobEvent[]> {
    const { data, error } = await this.supabase
      .from("document_v2_job_events")
      .select("event_payload")
      .eq("job_id", jobId)
      .eq("owner_id", this.ownerId)
      .order("sequence", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) =>
      DocumentJobEventSchema.parse((row as EventRow).event_payload),
    );
  }

  async save(
    job: DocumentJob,
    expectedRevision: number,
  ): Promise<DocumentJob> {
    if (job.ownerId !== this.ownerId) {
      throw new Error("Cannot update a document job for another owner.");
    }
    const saved = DocumentJobSchema.parse({
      ...job,
      revision: expectedRevision + 1,
    });
    const { data, error } = await this.supabase
      .from("document_v2_jobs")
      .update({
        status: saved.status,
        stage: saved.stage,
        revision: saved.revision,
        lease_owner: saved.leaseOwner ?? null,
        lease_expires_at: saved.leaseExpiresAt ?? null,
        job_payload: saved,
        updated_at: saved.updatedAt,
      })
      .eq("id", saved.jobId)
      .eq("owner_id", this.ownerId)
      .eq("revision", expectedRevision)
      .select("job_payload")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new DocumentJobConflictError(
        `Job "${saved.jobId}" changed while it was being updated.`,
      );
    }
    return DocumentJobSchema.parse((data as JobRow).job_payload);
  }

  async appendEvent(
    event: Omit<DocumentJobEvent, "sequence">,
  ): Promise<DocumentJobEvent> {
    const { data, error } = await this.supabase.rpc(
      "append_document_v2_job_event",
      {
        target_job_id: event.jobId,
        target_owner_id: this.ownerId,
        event_without_sequence: event,
      },
    );
    if (error) throw error;
    return DocumentJobEventSchema.parse(data);
  }

  async acquireLease(input: {
    jobId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<DocumentJob | null> {
    const { data, error } = await this.supabase.rpc(
      "acquire_document_v2_job_lease",
      {
        target_job_id: input.jobId,
        target_owner_id: this.ownerId,
        target_worker_id: input.workerId,
        lease_expires: new Date(
          input.now.getTime() + input.leaseMs,
        ).toISOString(),
        lease_now: input.now.toISOString(),
      },
    );
    if (error) throw error;
    return data ? DocumentJobSchema.parse(data) : null;
  }
}
