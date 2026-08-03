import type { ResearchExplorationCapability } from "../capability.ts";
import type {
  ResearchExplorationExecution,
  ResearchExplorationInput,
} from "../contracts.ts";
import {
  evaluateResearchExplorationShadow,
} from "../evaluation/comparator.ts";
import type {
  ResearchExplorationShadowBaseline,
  ResearchExplorationShadowEvaluation,
} from "../evaluation/contracts.ts";
import {
  selectResearchExplorationShadow,
  type ResearchExplorationShadowPolicy,
  type ResearchExplorationShadowSelection,
} from "./policy.ts";
import type { ResearchExplorationRuntimeDecision } from "../runtime-policy.ts";

export type ResearchExplorationShadowLaunch = Readonly<{
  selection: ResearchExplorationShadowSelection;
  executionId?: string;
  failureCode?: "shadow_start_failed";
}>;

export type ResearchExplorationShadowCollection = Readonly<{
  status: "pending" | "evaluated" | "unavailable";
  execution?: ResearchExplorationExecution;
  evaluation?: ResearchExplorationShadowEvaluation;
  failureCode?: "runtime_disabled" | "shadow_result_unavailable";
}>;

/**
 * Shadow orchestration deliberately owns no document state. Failures are
 * returned as observations and never thrown into the authoritative pipeline.
 */
export class ResearchExplorationShadowCoordinator {
  private readonly capability: ResearchExplorationCapability;

  constructor(capability: ResearchExplorationCapability) {
    this.capability = capability;
  }

  async launch(input: {
    policy: ResearchExplorationShadowPolicy;
    sampleSubjectId: string;
    activeExecutionCount: number;
    exploration: ResearchExplorationInput;
    runtimeDecision: ResearchExplorationRuntimeDecision;
  }): Promise<ResearchExplorationShadowLaunch> {
    if (
      !input.runtimeDecision.enabled ||
      input.runtimeDecision.mode !== "shadow"
    ) {
      const selection = selectResearchExplorationShadow(input);
      return {
        selection: { ...selection, selected: false, reason: "runtime_disabled" },
      };
    }
    const selection = selectResearchExplorationShadow(input);
    if (!selection.selected) return { selection };
    try {
      const handle = await this.capability.startOrReuse(input.exploration);
      return { selection, executionId: handle.executionId };
    } catch {
      return { selection, failureCode: "shadow_start_failed" };
    }
  }

  async collect(input: {
    executionId: string;
    baseline: ResearchExplorationShadowBaseline;
    runtimeDecision: ResearchExplorationRuntimeDecision;
  }): Promise<ResearchExplorationShadowCollection> {
    if (
      !input.runtimeDecision.enabled ||
      input.runtimeDecision.mode !== "shadow"
    ) {
      return { status: "unavailable", failureCode: "runtime_disabled" };
    }
    const execution = await this.capability.inspect(input.executionId);
    if (["queued", "running", "unknown_outcome"].includes(execution.status)) {
      return { status: "pending", execution };
    }
    if (!["complete", "partial"].includes(execution.status)) {
      return {
        status: "unavailable",
        execution,
        failureCode: "shadow_result_unavailable",
      };
    }
    try {
      const proposal = await this.capability.loadResult(input.executionId);
      return {
        status: "evaluated",
        execution,
        evaluation: evaluateResearchExplorationShadow({
          baseline: input.baseline,
          proposal,
          explorationRevision: execution.explorationRevision,
        }),
      };
    } catch {
      return {
        status: "unavailable",
        execution,
        failureCode: "shadow_result_unavailable",
      };
    }
  }
}
