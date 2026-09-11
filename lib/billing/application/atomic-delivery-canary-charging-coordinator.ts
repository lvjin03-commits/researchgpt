import type { RegisteredAiOperation } from "../../ai/operation-registry.ts";
import type { StandardizedBillableUsage } from "../../ai/billable-usage.ts";
import { BillingChargeLimitExceededError, InsufficientPointsError, PointAccountOnHoldError } from "../domain/contracts.ts";
import { isCanarySubject, type ChargingRolloutPolicy } from "../domain/charging-rollout.ts";
import type { PointLedgerRepository } from "../ports/point-ledger-repository.ts";
import { AtomicDeliveryChargingCoordinator, type AtomicDeliveryChargingStage } from "./atomic-delivery-charging-coordinator.ts";

export class AtomicDeliveryCanaryChargingCoordinator {
  private readonly dependencies: {
    atomic: AtomicDeliveryChargingCoordinator;
    ledger: PointLedgerRepository;
    rollout: ChargingRolloutPolicy;
  };

  constructor(dependencies: {
    atomic: AtomicDeliveryChargingCoordinator;
    ledger: PointLedgerRepository;
    rollout: ChargingRolloutPolicy;
  }) {
    this.dependencies = dependencies;
  }

  async preview(input: { ownerId: string; operation: RegisteredAiOperation; maximumChargePoints: number; now: string }) {
    if (!isCanarySubject({ policy: this.dependencies.rollout, ownerId: input.ownerId, operation: input.operation, now: input.now })) {
      return { charging: "meter_only" as const, canSubmit: true, maximumChargePoints: 0, availablePoints: null };
    }
    if (this.dependencies.rollout.mode !== "canary") throw new Error("Canary rollout policy changed during preview.");
    const account = await this.dependencies.ledger.getAccount(input.ownerId);
    const availablePoints = account?.account.availablePoints ?? 0;
    if (account?.account.status === "risk_hold") return { charging: "canary" as const, canSubmit: false, reason: "account_on_hold" as const, maximumChargePoints: input.maximumChargePoints, availablePoints };
    const since = Date.parse(input.now) - 24 * 60 * 60 * 1000;
    const chargedToday = (await this.dependencies.ledger.listTransactions(input.ownerId))
      .filter((entry) => entry.kind === "settle" && Date.parse(entry.createdAt) >= since)
      .reduce((sum, entry) => sum + entry.spentDelta, 0);
    if (chargedToday + input.maximumChargePoints > this.dependencies.rollout.maximumDailyChargePointsPerOwner) {
      return { charging: "canary" as const, canSubmit: false, reason: "daily_limit" as const, maximumChargePoints: input.maximumChargePoints, availablePoints };
    }
    return { charging: "canary" as const, canSubmit: availablePoints >= input.maximumChargePoints,
      ...(availablePoints < input.maximumChargePoints ? { reason: "insufficient_points" as const } : {}),
      maximumChargePoints: input.maximumChargePoints, availablePoints };
  }

  async run<T>(input: {
    ownerId: string;
    rolloutOperation: RegisteredAiOperation;
    parentBillingOperationId: string;
    stages: AtomicDeliveryChargingStage[];
    maximumChargePoints: number;
    reservationExpiresAt: string;
    now: string;
    execute: () => Promise<{
      value: T;
      terminalState: string;
      actualUsageByBundle: Readonly<Record<string, StandardizedBillableUsage[]>>;
    }>;
  }): Promise<{ value: T; chargedPoints: number; charging: "meter_only" | "charged" | "released" }> {
    if (!isCanarySubject({
      policy: this.dependencies.rollout,
      ownerId: input.ownerId,
      operation: input.rolloutOperation,
      now: input.now,
    })) {
      const executed = await input.execute();
      return { value: executed.value as T, chargedPoints: 0, charging: "meter_only" };
    }
    if (this.dependencies.rollout.mode !== "canary") throw new Error("Canary rollout policy changed during execution.");

    const preview = await this.preview({ ownerId: input.ownerId, operation: input.rolloutOperation,
      maximumChargePoints: input.maximumChargePoints, now: input.now });
    if (!preview.canSubmit && preview.reason === "account_on_hold") throw new PointAccountOnHoldError();
    if (!preview.canSubmit && preview.reason === "insufficient_points") throw new InsufficientPointsError(preview.availablePoints, input.maximumChargePoints);
    if (!preview.canSubmit) throw new BillingChargeLimitExceededError(input.maximumChargePoints, this.dependencies.rollout.maximumDailyChargePointsPerOwner);

    return this.dependencies.atomic.run<T>({
      ownerId: input.ownerId,
      parentBillingOperationId: input.parentBillingOperationId,
      stages: input.stages,
      maximumChargePoints: input.maximumChargePoints,
      reservationExpiresAt: input.reservationExpiresAt,
      now: input.now,
      execute: input.execute,
    });
  }
}
