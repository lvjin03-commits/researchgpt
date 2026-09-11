import { randomUUID } from "node:crypto";
import { AI_OPERATIONS } from "../../ai/operation-registry.ts";
import type { StandardizedBillableUsage } from "../../ai/billable-usage.ts";
import { AtomicDeliveryCanaryChargingCoordinator } from "../../billing/application/atomic-delivery-canary-charging-coordinator.ts";
import {
  GRANT_WEB_GPT_5_5_USAGE_RANGES,
  GRANT_WEB_USER_CHARGE_CAP_POINTS,
} from "../../billing/policies/grant-web-grounded-gpt-5-5-v1.ts";
import type {
  GrantWebGroundedChatOrchestrator,
  GrantWebGroundedChatResult,
} from "../application/grant-web-grounded-chat-orchestrator.ts";

type RunInput = Parameters<GrantWebGroundedChatOrchestrator["run"]>[0];

export class GrantWebGroundedChargingAdapter {
  private readonly dependencies: {
    orchestrator: Pick<GrantWebGroundedChatOrchestrator, "run">;
    charging: AtomicDeliveryCanaryChargingCoordinator;
    modelId: string;
    now?: () => Date;
    createId?: () => string;
  };

  constructor(dependencies: GrantWebGroundedChargingAdapter["dependencies"]) {
    this.dependencies = dependencies;
  }

  async run(input: RunInput): Promise<GrantWebGroundedChatResult> {
    const instant = (this.dependencies.now ?? (() => new Date()))();
    const now = instant.toISOString();
    const createId = this.dependencies.createId ?? randomUUID;
    const billingOperationIds = {
      queryRewrite: createId(), search: createId(), assessment: createId(), answer: createId(),
    };
    const definitions = [
      ["query_rewrite", AI_OPERATIONS.grant.webQueryRewrite, billingOperationIds.queryRewrite],
      ["search_query", AI_OPERATIONS.grant.webSearchQuery, billingOperationIds.search],
      ["source_assessment", AI_OPERATIONS.grant.webSourceAssess, billingOperationIds.assessment],
      ["grounded_answer", AI_OPERATIONS.grant.webAnswerSynthesize, billingOperationIds.answer],
    ] as const;
    const charged = await this.dependencies.charging.run<GrantWebGroundedChatResult>({
      ownerId: input.actorId,
      rolloutOperation: AI_OPERATIONS.grant.assistantChat,
      parentBillingOperationId: input.turnId,
      maximumChargePoints: GRANT_WEB_USER_CHARGE_CAP_POINTS,
      reservationExpiresAt: new Date(instant.getTime() + 15 * 60 * 1000).toISOString(),
      now,
      stages: definitions.map(([bundleKey, operation, billingOperationId]) => ({
        bundleKey,
        operation,
        provider: "openai",
        modelId: this.dependencies.modelId,
        billingOperationId,
        reservationId: createId(),
        usageRange: GRANT_WEB_GPT_5_5_USAGE_RANGES[bundleKey]!,
      })),
      execute: async () => {
        const value = await this.dependencies.orchestrator.run({ ...input, billingOperationIds });
        const actualUsageByBundle: Readonly<Record<string, StandardizedBillableUsage[]>> = value.status === "completed"
          ? {
              query_rewrite: value.billingUsage.queryRewrite,
              search_query: value.billingUsage.search,
              source_assessment: value.billingUsage.assessment,
              grounded_answer: value.billingUsage.answer,
            }
          : {};
        return {
          value,
          terminalState: value.status === "completed" ? "delivered" : "succeeded_internal_only",
          actualUsageByBundle,
        };
      },
    });
    return charged.value;
  }
}
