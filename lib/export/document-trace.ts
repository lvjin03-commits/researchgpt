import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DocumentTraceEventStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "retrying"
  | "info";

export type DocumentTraceJobStatus =
  | "started"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type DocumentTraceEvent = {
  stage: string;
  status: DocumentTraceEventStatus;
  componentId?: string;
  attempt?: number;
  durationMs?: number;
  details?: Record<string, unknown>;
  error?: unknown;
};

type CreateDocumentTraceInput = {
  query: string;
  requestedFormats: string[];
  pipelineVersion: string;
};

type CompleteDocumentTraceInput = {
  artifactIds?: string[];
  details?: Record<string, unknown>;
};

type FailDocumentTraceInput = {
  stage: string;
  error: unknown;
  details?: Record<string, unknown>;
};

function errorFields(error: unknown): {
  errorCode: string;
  errorMessage: string;
} {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown };
    return {
      errorCode:
        typeof candidate.code === "string" ? candidate.code : error.name,
      errorMessage: error.message.slice(0, 1000),
    };
  }
  return {
    errorCode: "UNKNOWN_ERROR",
    errorMessage: String(error).slice(0, 1000),
  };
}

function safeDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!details) return {};
  return Object.fromEntries(
    Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        typeof value === "string" && value.length > 500
          ? `${value.slice(0, 500)}…`
          : value,
      ]),
  );
}

export function createDocumentGenerationTrace(
  supabase: SupabaseClient,
  userId: string,
  input: CreateDocumentTraceInput,
) {
  const jobId = randomUUID();
  const requestSha256 = createHash("sha256")
    .update(input.query)
    .digest("hex");
  let persistenceWarningWritten = false;
  let terminalStatus: "succeeded" | "failed" | "cancelled" | null = null;
  let persistenceQueue: Promise<void> = Promise.resolve();

  const warnPersistence = (operation: string, error: unknown) => {
    if (persistenceWarningWritten) return;
    persistenceWarningWritten = true;
    console.warn("[document-trace] persistence unavailable", {
      jobId,
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
  };

  const enqueuePersistence = (
    operation: string,
    work: () => PromiseLike<{ error: unknown }>,
  ): void => {
    persistenceQueue = persistenceQueue.then(async () => {
      try {
        const { error } = await work();
        if (error) warnPersistence(operation, error);
      } catch (error) {
        warnPersistence(operation, error);
      }
    });
  };

  const flushPersistence = async (): Promise<void> => {
    await Promise.race([
      persistenceQueue,
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
  };

  const updateJob = (
    values: Record<string, unknown>,
  ): void => {
    enqueuePersistence("update_job", () =>
      supabase
        .from("document_generation_jobs")
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("user_id", userId),
    );
  };

  const event = async (entry: DocumentTraceEvent): Promise<void> => {
    const error = entry.error ? errorFields(entry.error) : null;
    const payload = {
      jobId,
      stage: entry.stage,
      status: entry.status,
      componentId: entry.componentId,
      attempt: entry.attempt,
      durationMs: entry.durationMs,
      details: safeDetails(entry.details),
      ...(error ?? {}),
    };
    console.info("[document-trace]", payload);

    enqueuePersistence("insert_event", () =>
      supabase
        .from("document_generation_events")
        .insert({
          job_id: jobId,
          user_id: userId,
          stage: entry.stage,
          component_id: entry.componentId ?? null,
          attempt: entry.attempt ?? null,
          status: entry.status,
          duration_ms: entry.durationMs ?? null,
          details: safeDetails(entry.details),
          error_code: error?.errorCode ?? null,
          error_message: error?.errorMessage ?? null,
        }),
    );

    if (entry.status === "started" || entry.status === "retrying") {
      updateJob({
        status: "running",
        current_stage: entry.stage,
      });
    }
  };

  const start = async (
    routeDecision: Record<string, unknown>,
  ): Promise<void> => {
    console.info("[document-trace]", {
      jobId,
      stage: "document_job",
      status: "started",
      pipelineVersion: input.pipelineVersion,
      requestedFormats: input.requestedFormats,
      routeDecision: safeDetails(routeDecision),
    });
    enqueuePersistence("insert_job", () =>
      supabase
        .from("document_generation_jobs")
        .insert({
          id: jobId,
          user_id: userId,
          pipeline_version: input.pipelineVersion,
          request_sha256: requestSha256,
          request_chars: input.query.length,
          requested_formats: input.requestedFormats,
          status: "started",
          current_stage: "document_job",
          route_decision: safeDetails(routeDecision),
        }),
    );
    await event({
      stage: "document_job",
      status: "started",
      details: {
        pipelineVersion: input.pipelineVersion,
        requestedFormats: input.requestedFormats,
      },
    });
  };

  const setTemplate = async (
    templateId: string,
    templateVersion?: string,
  ): Promise<void> => {
    updateJob({
      template_id: templateId,
      template_version: templateVersion ?? null,
    });
    await event({
      stage: "template_resolution",
      status: "succeeded",
      details: { templateId, templateVersion },
    });
  };

  const complete = async (
    input: CompleteDocumentTraceInput = {},
  ): Promise<void> => {
    if (terminalStatus) return;
    terminalStatus = "succeeded";
    await event({
      stage: "document_job",
      status: "succeeded",
      details: input.details,
    });
    updateJob({
      status: "succeeded",
      current_stage: "completed",
      artifact_ids: input.artifactIds ?? [],
      finished_at: new Date().toISOString(),
    });
    await flushPersistence();
  };

  const fail = async (input: FailDocumentTraceInput): Promise<void> => {
    if (terminalStatus) return;
    terminalStatus = "failed";
    const error = errorFields(input.error);
    await event({
      stage: input.stage,
      status: "failed",
      error: input.error,
      details: input.details,
    });
    updateJob({
      status: "failed",
      current_stage: input.stage,
      error_code: error.errorCode,
      error_message: error.errorMessage,
      finished_at: new Date().toISOString(),
    });
    await flushPersistence();
  };

  const cancel = async (
    stage: string,
    details?: Record<string, unknown>,
  ): Promise<void> => {
    if (terminalStatus) return;
    terminalStatus = "cancelled";
    await event({
      stage,
      status: "info",
      details: { reason: "cancelled", ...details },
    });
    updateJob({
      status: "cancelled",
      current_stage: stage,
      finished_at: new Date().toISOString(),
    });
    await flushPersistence();
  };

  return {
    jobId,
    start,
    event,
    setTemplate,
    complete,
    fail,
    cancel,
  };
}

export type DocumentGenerationTrace = ReturnType<
  typeof createDocumentGenerationTrace
>;
