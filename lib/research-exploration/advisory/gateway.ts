import type { ResearchExplorationCapability } from "../capability.ts";
import { deriveResearchExplorationAdvisoryHints } from "./hints.ts";
import {
  ResearchExplorationAdvisoryResolutionSchema,
  type ResearchExplorationAdvisoryResolution,
} from "./contracts.ts";

/**
 * Converts an already-started exploration into optional planner advice.
 * It never starts work, waits, polls, or throws into document planning.
 */
export class ResearchExplorationAdvisoryGateway {
  private readonly capability: ResearchExplorationCapability;

  constructor(capability: ResearchExplorationCapability) {
    this.capability = capability;
  }

  async resolve(executionId: string): Promise<ResearchExplorationAdvisoryResolution> {
    try {
      const execution = await this.capability.inspect(executionId);
      if (["queued", "running", "unknown_outcome"].includes(execution.status)) {
        return ResearchExplorationAdvisoryResolutionSchema.parse({
          mode: "advisory",
          outcome: "fallback",
          warningCode: "exploration_pending",
        });
      }
      if (!["complete", "partial"].includes(execution.status)) {
        return ResearchExplorationAdvisoryResolutionSchema.parse({
          mode: "advisory",
          outcome: "fallback",
          warningCode: "exploration_failed",
        });
      }
      const proposal = await this.capability.loadResult(executionId);
      return ResearchExplorationAdvisoryResolutionSchema.parse({
        mode: "advisory",
        outcome: "available",
        hints: deriveResearchExplorationAdvisoryHints(proposal),
      });
    } catch {
      return ResearchExplorationAdvisoryResolutionSchema.parse({
        mode: "advisory",
        outcome: "fallback",
        warningCode: "exploration_result_unavailable",
      });
    }
  }
}
