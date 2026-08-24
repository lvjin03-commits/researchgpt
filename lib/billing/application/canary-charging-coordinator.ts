import type { RegisteredAiOperation } from "../../ai/operation-registry.ts";
import type { StandardizedBillableUsage } from "../../ai/billable-usage.ts";
import { getBillingOperationContract } from "../domain/deliverability.ts";
import { isCanarySubject, type ChargingRolloutPolicy } from "../domain/charging-rollout.ts";
import { requiresBillingConfirmation, type UsageRange } from "../domain/price-catalog.ts";
import type { PointLedgerRepository } from "../ports/point-ledger-repository.ts";
import { PointBillingService } from "./point-billing-service.ts";

export class CanaryChargingCoordinator {
  private readonly billing: PointBillingService;
  private readonly ledger: PointLedgerRepository;
  private readonly rollout: ChargingRolloutPolicy;
  constructor(
    billing: PointBillingService,
    ledger: PointLedgerRepository,
    rollout: ChargingRolloutPolicy,
  ) {
    this.billing = billing;
    this.ledger = ledger;
    this.rollout = rollout;
  }

  async runSingleBundle<T>(input: {
    ownerId: string;
    operation: RegisteredAiOperation;
    provider: string;
    modelId: string;
    billingOperationId: string;
    reservationId: string;
    settlementEventId: string;
    releaseEventId: string;
    usageRange: UsageRange;
    userConfirmed: boolean;
    reservationExpiresAt: string;
    now: string;
    execute: () => Promise<{ value: T; terminalState: string; usage: StandardizedBillableUsage[] }>;
    classifyThrownFailure: (error: unknown) => string;
  }): Promise<{ value: T; charging: "meter_only" | "charged" | "released"; chargedPoints: number }> {
    if (!isCanarySubject({ policy: this.rollout, ownerId: input.ownerId, operation: input.operation, now: input.now })) {
      const executed = await input.execute();
      return { value: executed.value, charging: "meter_only", chargedPoints: 0 };
    }
    if (this.rollout.mode !== "canary") throw new Error("Canary rollout policy changed during execution.");
    const contract = getBillingOperationContract(input.operation);
    if (contract.bundleKeys.length !== 1) throw new Error("Multi-Bundle Operations require an explicit charging adapter.");
    const account = await this.ledger.getAccount(input.ownerId);
    if (!account || account.account.status !== "active") throw new Error("Canary account is unavailable or on hold.");
    const since = Date.parse(input.now) - 24 * 60 * 60 * 1000;
    const chargedToday = (await this.ledger.listTransactions(input.ownerId))
      .filter((entry) => entry.kind === "settle" && Date.parse(entry.createdAt) >= since)
      .reduce((sum, entry) => sum + entry.spentDelta, 0);
    const bundleKey = contract.bundleKeys[0]!;
    const quote = await this.billing.quote({
      operation: input.operation, provider: input.provider, modelId: input.modelId,
      bundles: [{ bundleKey, usage: input.usageRange }], now: input.now,
    });
    if (chargedToday + quote.maximumChargePoints > this.rollout.maximumDailyChargePointsPerOwner) {
      throw new Error("Canary daily charge ceiling would be exceeded.");
    }
    if (requiresBillingConfirmation({ quote, availablePoints: account.account.availablePoints }) && !input.userConfirmed) {
      throw new Error("Billing confirmation is required before provider dispatch.");
    }
    await this.billing.reserveQuote({
      ownerId: input.ownerId, parentBillingOperationId: input.billingOperationId, quote,
      bundles: [{ bundleKey, reservationId: input.reservationId, billingOperationId: input.billingOperationId }],
      expiresAt: input.reservationExpiresAt, now: input.now,
    });
    let executed: { value: T; terminalState: string; usage: StandardizedBillableUsage[] };
    try {
      executed = await input.execute();
    } catch (error) {
      const classified = input.classifyThrownFailure(error);
      const failureState = classified === "delivered" || classified === "partially_delivered"
        ? "thrown_execution_error"
        : classified;
      await this.billing.finalizeBundle({
        ownerId: input.ownerId, eventId: input.releaseEventId,
        reservationId: input.reservationId, operation: input.operation,
        pricePolicyVersion: quote.pricePolicyVersion,
        maximumChargePoints: quote.maximumChargePoints,
        terminalState: failureState, actualDeliveredUsage: [], now: input.now,
      });
      throw error;
    }
    // A settlement persistence error has unknown financial outcome. Do not
    // convert it into a release; leave the reservation for reconciliation.
    const finalized = await this.billing.finalizeBundle({
      ownerId: input.ownerId, eventId: input.settlementEventId,
      reservationId: input.reservationId, operation: input.operation,
      pricePolicyVersion: quote.pricePolicyVersion,
      maximumChargePoints: quote.maximumChargePoints,
      terminalState: executed.terminalState,
      actualDeliveredUsage: executed.usage, now: input.now,
    });
    return { value: executed.value, charging: finalized.decision === "charged" ? "charged" : "released", chargedPoints: finalized.chargedPoints };
  }
}
