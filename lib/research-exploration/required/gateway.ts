import type { ResearchExplorationCapability } from "../capability.ts";
import type { ResearchExplorationStatus } from "../contracts.ts";
import type { ResearchExplorationAdvisoryHints } from "../advisory/contracts.ts";
import { deriveResearchExplorationAdvisoryHints } from "../advisory/hints.ts";
import {
  ResearchExplorationRequiredPlanningError,
  ResearchExplorationRequiredResolutionSchema,
  type ResearchExplorationRequiredResolution,
} from "./contracts.ts";

function terminalFailureCode(status: ResearchExplorationStatus) {
  switch (status) {
    case "unknown_outcome":
      return "exploration_unknown_outcome" as const;
    case "expired":
      return "exploration_expired" as const;
    case "cancelled":
      return "exploration_cancelled" as const;
    default:
      return "exploration_failed" as const;
  }
}

/**
 * Resolves research that the user explicitly requires before planning.
 * Unlike advisory mode, this gateway never converts failure into normal planning.
 */
export class ResearchExplorationRequiredGateway {
  private readonly capability: ResearchExplorationCapability;

  constructor(capability: ResearchExplorationCapability) {
    this.capability = capability;
  }

  async resolve(executionId: string): Promise<ResearchExplorationRequiredResolution> {
    let execution;
    try {
      execution = await this.capability.inspect(executionId);
    } catch {
      return ResearchExplorationRequiredResolutionSchema.parse({
        mode: "required",
        outcome: "blocked",
        executionId,
        executionStatus: "unknown_outcome",
        failureCode: "exploration_result_unavailable",
      });
    }
    if (["queued", "running"].includes(execution.status)) {
      return ResearchExplorationRequiredResolutionSchema.parse({
        mode: "required",
        outcome: "waiting",
        executionId,
        executionStatus: execution.status,
        nextCheckAt: execution.nextCheckAt,
      });
    }
    if (!["complete", "partial"].includes(execution.status)) {
      return ResearchExplorationRequiredResolutionSchema.parse({
        mode: "required",
        outcome: "blocked",
        executionId,
        executionStatus: execution.status,
        failureCode: terminalFailureCode(execution.status),
      });
    }
    try {
      const proposal = await this.capability.loadResult(executionId);
      return ResearchExplorationRequiredResolutionSchema.parse({
        mode: "required",
        outcome: "available",
        executionId,
        executionStatus: execution.status,
        hints: deriveResearchExplorationAdvisoryHints(proposal),
      });
    } catch {
      return ResearchExplorationRequiredResolutionSchema.parse({
        mode: "required",
        outcome: "blocked",
        executionId,
        executionStatus: execution.status,
        failureCode: "exploration_result_unavailable",
      });
    }
  }
}

export function requireResearchExplorationForPlanning(
  resolution: ResearchExplorationRequiredResolution,
): ResearchExplorationAdvisoryHints {
  const parsed = ResearchExplorationRequiredResolutionSchema.parse(resolution);
  if (parsed.outcome !== "available" || !parsed.hints) {
    throw new ResearchExplorationRequiredPlanningError(parsed);
  }
  return parsed.hints;
}
