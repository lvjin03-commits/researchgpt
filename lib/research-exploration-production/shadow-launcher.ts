import { createClient } from "@supabase/supabase-js";
import type { ResearchExplorationHandle } from "@/lib/research-exploration/capability";
import {
  ResearchExplorationInputSchema,
  type ResearchExplorationInput,
} from "@/lib/research-exploration/contracts";
import { createQueuedResearchExplorationExecution } from "@/lib/research-exploration/execution";
import { createResearchExplorationFingerprint } from "@/lib/research-exploration/fingerprint";
import { resolveResearchExplorationRuntimeFromEnvironment } from "@/lib/research-exploration/runtime-policy";
import { selectResearchExplorationShadow } from "@/lib/research-exploration/shadow/policy";
import { dispatchStormCloudRunJob } from "./cloud-run-dispatcher";
import { requireResearchExplorationProductionConfig } from "./runtime-config";
import { SupabaseResearchExplorationStore } from "./supabase-store";
import type { ResearchExplorationProductionConfig } from "./runtime-config";

const VERSIONS = {
  packageVersion: "1.1.1+researchgpt.4",
  adapterVersion: "storm-cloud-run-v1",
  outputContractVersion: "storm-exploration-result-v1",
  promptConfigurationVersion: "storm-prompt-v1",
} as const;

export type ShadowLaunchObservation =
  | { selected: false; reason: string }
  | { selected: true; executionId: string; reused: boolean }
  | { selected: true; failureCode: "shadow_start_failed" };

function buildInput(input: {
  jobId: string;
  instruction: string;
  language?: "zh" | "en";
  config: ResearchExplorationProductionConfig;
}): ResearchExplorationInput {
  return ResearchExplorationInputSchema.parse({
    explorationId: `document-shadow-${input.jobId}`,
    topic: input.instruction.slice(0, 1_000),
    purpose: "literature_review",
    language: input.language ?? "zh",
    sourcePolicy: {
      useWeb: true,
      useUserDocuments: false,
      userResourceIds: [],
    },
    limits: {
      maxPerspectives: 3,
      maxQuestionsPerPerspective: 3,
      maxSearchQueries: 8,
      maxSources: 24,
      maximumWallTimeMs: 600_000,
      maximumModelCalls: 20,
      maximumInspectionCount: 20,
    },
    modelProfile: {
      provider: input.config.requestProvider,
      model: input.config.requestModel,
      reasoningEffort: "none",
    },
  });
}

export async function launchDocumentResearchExplorationShadow(input: {
  ownerId: string;
  jobId: string;
  instruction: string;
  language?: "zh" | "en";
  environment?: NodeJS.ProcessEnv;
}): Promise<ShadowLaunchObservation> {
  const environment = input.environment ?? process.env;
  const runtime = resolveResearchExplorationRuntimeFromEnvironment({
    environment,
  });
  if (!runtime.enabled || runtime.mode !== "shadow") {
    return { selected: false, reason: runtime.reason };
  }
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return { selected: true, failureCode: "shadow_start_failed" };
  }
  try {
    const config = requireResearchExplorationProductionConfig(environment);
    const store = new SupabaseResearchExplorationStore(
      createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      input.ownerId,
    );
    const exploration = buildInput({ ...input, config });
    const activeExecutionCount = await store.countActive();
    const selection = selectResearchExplorationShadow({
      policy: {
        policyVersion: "research-exploration-shadow-v1",
        enabled: true,
        environment: process.env.NODE_ENV === "production" ? "production" : "development",
        sampleRateBasisPoints: config.sampleRateBasisPoints,
        maximumConcurrentExecutions: config.maximumConcurrentExecutions,
      },
      sampleSubjectId: input.jobId,
      activeExecutionCount,
    });
    if (!selection.selected) return { selected: false, reason: selection.reason };

    const inputFingerprint = createResearchExplorationFingerprint({
      request: exploration,
      versions: VERSIONS,
    });
    const existing = await store.findByFingerprint(inputFingerprint);
    if (existing) {
      const handle: ResearchExplorationHandle = existing;
      return { selected: true, executionId: handle.executionId, reused: true };
    }
    const queued = createQueuedResearchExplorationExecution({
      explorationId: exploration.explorationId,
      explorationRevision: 1,
      inputFingerprint,
      requirement: "optional",
      versions: VERSIONS,
      maximumInspectionCount: exploration.limits.maximumInspectionCount,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      jobId: input.jobId,
    });
    const inserted = await store.insert({ execution: queued, request: exploration });
    if (!inserted.created) {
      return { selected: true, executionId: inserted.execution.executionId, reused: true };
    }
    try {
      await dispatchStormCloudRunJob({
        config,
        executionId: inserted.execution.executionId,
      });
    } catch (error) {
      await store.markDispatchFailure(inserted.execution.executionId, error);
      throw error;
    }
    return {
      selected: true,
      executionId: inserted.execution.executionId,
      reused: false,
    };
  } catch (error) {
    console.error("[research-exploration-shadow] launch failed", {
      jobId: input.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { selected: true, failureCode: "shadow_start_failed" };
  }
}
