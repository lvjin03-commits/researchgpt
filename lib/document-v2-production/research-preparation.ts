import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DocumentJobSchema, type DocumentJob } from "@/lib/document-v2/runtime/contracts";
import { SupabaseDocumentJobRepository } from "@/lib/document-v2/runtime/supabase-repository";
import { deriveResearchExplorationAdvisoryHints } from "@/lib/research-exploration/advisory/hints";
import type { ResearchExplorationAdvisoryHints } from "@/lib/research-exploration/advisory/contracts";
import { resolveResearchExplorationRuntimeFromEnvironment } from "@/lib/research-exploration/runtime-policy";
import { SupabaseResearchExplorationStore } from "@/lib/research-exploration-production/supabase-store";

type ResearchPreparationResult =
  | { outcome: "ready"; job: DocumentJob; hints?: ResearchExplorationAdvisoryHints }
  | { outcome: "waiting"; job: DocumentJob };

const DEFAULT_RESEARCH_WAIT_MS = 210_000;
const RESEARCH_POLL_INTERVAL_MS = 5_000;

function researchWaitMs(): number {
  const configured = Number(process.env.DOCUMENT_V2_STORM_WAIT_MS ?? "");
  return Number.isFinite(configured) && configured >= 10_000
    ? Math.min(configured, 210_000)
    : DEFAULT_RESEARCH_WAIT_MS;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function appendResearchEvent(input: {
  repository: SupabaseDocumentJobRepository;
  job: DocumentJob;
  status: "progress" | "succeeded";
  operation: string;
  message: string;
  executionId?: string;
  warningCode?: string;
}) {
  await input.repository.appendEvent({
    eventId: randomUUID(),
    jobId: input.job.jobId,
    stage: "evidence_acquisition",
    status: input.status,
    message: input.message,
    category: "lifecycle",
    operation: input.operation,
    correlationId: input.executionId ?? input.job.jobId,
    metadata: {
      researchMode: "enhanced",
      executionId: input.executionId ?? null,
      warningCode: input.warningCode ?? null,
    },
    createdAt: new Date().toISOString(),
  });
}

async function saveDegraded(input: {
  repository: SupabaseDocumentJobRepository;
  job: DocumentJob;
  warningCode: string;
}): Promise<DocumentJob> {
  const now = new Date().toISOString();
  const saved = await input.repository.save(
    DocumentJobSchema.parse({
      ...input.job,
      status: "queued",
      stage: "planning",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      checkpoint: {
        ...input.job.checkpoint,
        researchExploration: {
          executionId: input.job.checkpoint.researchExploration?.executionId,
          status: "degraded",
          warningCode: input.warningCode,
          updatedAt: now,
        },
        savedAt: now,
      },
      updatedAt: now,
    }),
    input.job.revision,
  );
  await appendResearchEvent({
    repository: input.repository,
    job: saved,
    status: "succeeded",
    operation: "research.exploration.degraded",
    message: "研究增强未能完成，已说明原因并继续使用标准文档规划。",
    executionId: saved.checkpoint.researchExploration?.executionId,
    warningCode: input.warningCode,
  });
  return saved;
}

export async function prepareOptionalDocumentResearch(input: {
  job: DocumentJob;
  repository: SupabaseDocumentJobRepository;
  supabase: SupabaseClient;
}): Promise<ResearchPreparationResult> {
  const intake = input.job.checkpoint.intake;
  if (!intake || intake.researchMode !== "enhanced") {
    return { outcome: "ready", job: input.job };
  }
  const state = input.job.checkpoint.researchExploration;
  if (state?.status === "available") {
    return { outcome: "ready", job: input.job, hints: state.hints };
  }
  if (state?.status === "degraded") {
    return { outcome: "ready", job: input.job };
  }
  if (!state?.executionId) {
    const job = await saveDegraded({
      repository: input.repository,
      job: input.job,
      warningCode: "storm_execution_missing",
    });
    return { outcome: "waiting", job };
  }
  const runtime = resolveResearchExplorationRuntimeFromEnvironment({});
  if (!runtime.enabled) {
    const job = await saveDegraded({
      repository: input.repository,
      job: input.job,
      warningCode: "runtime_disabled",
    });
    return { outcome: "waiting", job };
  }
  const store = new SupabaseResearchExplorationStore(input.supabase, input.job.ownerId);
  let execution = await store.get(state.executionId);
  if (!execution) {
    const job = await saveDegraded({
      repository: input.repository,
      job: input.job,
      warningCode: "exploration_result_unavailable",
    });
    return { outcome: "waiting", job };
  }
  if (execution.status === "queued" || execution.status === "running") {
    const now = new Date().toISOString();
    const waiting = await input.repository.save(
      DocumentJobSchema.parse({
        ...input.job,
        status: "running",
        stage: "evidence_acquisition",
        progress: 1,
        checkpoint: {
          ...input.job.checkpoint,
          researchExploration: {
            executionId: state.executionId,
            status: "queued",
            updatedAt: now,
          },
          savedAt: now,
        },
        updatedAt: now,
      }),
      input.job.revision,
    );
    await appendResearchEvent({
      repository: input.repository,
      job: waiting,
      status: "progress",
      operation: "research.exploration.waiting",
      message: "正在等待 STORM 完成联网研究，完成后将自动进入文档规划。",
      executionId: state.executionId,
    });
    const deadline = Date.now() + researchWaitMs();
    while (
      execution &&
      (execution.status === "queued" || execution.status === "running") &&
      Date.now() < deadline
    ) {
      await wait(RESEARCH_POLL_INTERVAL_MS);
      execution = await store.get(state.executionId);
    }
    if (!execution) {
      const job = await saveDegraded({
        repository: input.repository,
        job: waiting,
        warningCode: "exploration_result_unavailable",
      });
      return { outcome: "waiting", job };
    }
    if (execution.status === "queued" || execution.status === "running") {
      const job = await saveDegraded({
        repository: input.repository,
        job: waiting,
        warningCode: "exploration_wait_timeout",
      });
      return { outcome: "waiting", job };
    }
    return prepareOptionalDocumentResearch({ ...input, job: waiting });
  }
  if (execution.status === "complete" || execution.status === "partial") {
    let hints: ResearchExplorationAdvisoryHints;
    try {
      hints = deriveResearchExplorationAdvisoryHints(
        await store.loadResult(execution.executionId),
      );
    } catch {
      const job = await saveDegraded({
        repository: input.repository,
        job: input.job,
        warningCode: "exploration_result_unavailable",
      });
      return { outcome: "waiting", job };
    }
    const now = new Date().toISOString();
    const saved = await input.repository.save(
      DocumentJobSchema.parse({
        ...input.job,
        status: "queued",
        stage: "planning",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        checkpoint: {
          ...input.job.checkpoint,
          researchExploration: {
            executionId: execution.executionId,
            status: "available",
            hints,
            updatedAt: now,
          },
          savedAt: now,
        },
        updatedAt: now,
      }),
      input.job.revision,
    );
    await appendResearchEvent({
      repository: input.repository,
      job: saved,
      status: "succeeded",
      operation: "research.exploration.available",
      message: "STORM 研究结果已冻结，正在用于文档规划。",
      executionId: execution.executionId,
    });
    return { outcome: "waiting", job: saved };
  }
  const job = await saveDegraded({
    repository: input.repository,
    job: input.job,
    warningCode: execution.failure?.code ?? `exploration_${execution.status}`,
  });
  return { outcome: "waiting", job };
}
