import {
  DocumentJobEventSchema,
  DocumentJobSchema,
  type DocumentJob,
  type DocumentJobEvent,
} from "./contracts";

export class DocumentJobConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentJobConflictError";
  }
}

export interface DocumentJobRepository {
  create(job: DocumentJob): Promise<void>;
  get(jobId: string): Promise<DocumentJob | null>;
  listEvents(jobId: string): Promise<DocumentJobEvent[]>;
  save(job: DocumentJob, expectedRevision: number): Promise<DocumentJob>;
  appendEvent(
    event: Omit<DocumentJobEvent, "sequence">,
  ): Promise<DocumentJobEvent>;
  acquireLease(input: {
    jobId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<DocumentJob | null>;
}

export class InMemoryDocumentJobRepository
  implements DocumentJobRepository
{
  readonly #jobs = new Map<string, DocumentJob>();
  readonly #events = new Map<string, DocumentJobEvent[]>();

  async create(job: DocumentJob): Promise<void> {
    const parsed = DocumentJobSchema.parse(job);
    if (this.#jobs.has(parsed.jobId)) {
      throw new DocumentJobConflictError(`Job "${parsed.jobId}" already exists.`);
    }
    this.#jobs.set(parsed.jobId, structuredClone(parsed));
    this.#events.set(parsed.jobId, []);
  }

  async get(jobId: string): Promise<DocumentJob | null> {
    const job = this.#jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async listEvents(jobId: string): Promise<DocumentJobEvent[]> {
    return structuredClone(this.#events.get(jobId) ?? []);
  }

  async save(
    job: DocumentJob,
    expectedRevision: number,
  ): Promise<DocumentJob> {
    const current = this.#jobs.get(job.jobId);
    if (!current) throw new Error(`Job "${job.jobId}" does not exist.`);
    if (current.revision !== expectedRevision) {
      throw new DocumentJobConflictError(
        `Job "${job.jobId}" changed while it was being updated.`,
      );
    }
    const saved = DocumentJobSchema.parse({
      ...job,
      revision: expectedRevision + 1,
    });
    this.#jobs.set(job.jobId, structuredClone(saved));
    return structuredClone(saved);
  }

  async appendEvent(
    event: Omit<DocumentJobEvent, "sequence">,
  ): Promise<DocumentJobEvent> {
    if (!this.#jobs.has(event.jobId)) {
      throw new Error(`Job "${event.jobId}" does not exist.`);
    }
    const events = this.#events.get(event.jobId) ?? [];
    const parsed = DocumentJobEventSchema.parse({
      ...event,
      sequence: events.length + 1,
    });
    events.push(parsed);
    this.#events.set(event.jobId, events);
    return structuredClone(parsed);
  }

  async acquireLease(input: {
    jobId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<DocumentJob | null> {
    const current = this.#jobs.get(input.jobId);
    if (!current) return null;
    const activeLease =
      current.leaseOwner &&
      current.leaseExpiresAt &&
      Date.parse(current.leaseExpiresAt) > input.now.getTime();
    if (activeLease && current.leaseOwner !== input.workerId) return null;
    const leased = DocumentJobSchema.parse({
      ...current,
      leaseOwner: input.workerId,
      leaseExpiresAt: new Date(
        input.now.getTime() + input.leaseMs,
      ).toISOString(),
      updatedAt: input.now.toISOString(),
      revision: current.revision + 1,
    });
    this.#jobs.set(input.jobId, structuredClone(leased));
    return structuredClone(leased);
  }
}
