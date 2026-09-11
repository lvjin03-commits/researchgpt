import { randomUUID } from "node:crypto";
import type { RegisteredAiOperation } from "../../ai/operation-registry.ts";
import type { StandardizedBillableUsage } from "../../ai/billable-usage.ts";
import type { UsageRange } from "../domain/price-catalog.ts";
import { PointBillingService } from "./point-billing-service.ts";

export type AtomicDeliveryChargingStage = {
  bundleKey: string;
  operation: RegisteredAiOperation;
  provider: string;
  modelId: string;
  billingOperationId: string;
  reservationId: string;
  usageRange: UsageRange;
};

export class AtomicDeliveryChargingCoordinator {
  private readonly billing: PointBillingService;
  private readonly createId: () => string;

  constructor(billing: PointBillingService, createId: () => string = randomUUID) {
    this.billing = billing;
    this.createId = createId;
  }

  async run<T>(input: {
    ownerId: string;
    parentBillingOperationId: string;
    stages: AtomicDeliveryChargingStage[];
    reservationExpiresAt: string;
    now: string;
    execute: () => Promise<{
      value: T;
      terminalState: string;
      actualUsageByBundle: Readonly<Record<string, StandardizedBillableUsage[]>>;
    }>;
  }): Promise<{ value: T; chargedPoints: number; charging: "charged" | "released" }> {
    if (input.stages.length === 0) throw new Error("Atomic delivery charging requires at least one stage.");
    const bundleKeys = new Set(input.stages.map((stage) => stage.bundleKey));
    if (bundleKeys.size !== input.stages.length) throw new Error("Atomic delivery bundle keys must be unique.");

    const quotedStages = [];
    for (const stage of input.stages) {
      const quote = await this.billing.quote({
        operation: stage.operation,
        provider: stage.provider,
        modelId: stage.modelId,
        bundles: [{ bundleKey: stage.bundleKey, usage: stage.usageRange }],
        now: input.now,
      });
      quotedStages.push({ stage, quote });
    }
    await this.billing.reserveQuoteSet({
      ownerId: input.ownerId,
      parentBillingOperationId: input.parentBillingOperationId,
      entries: quotedStages.map(({ stage, quote }) => ({
        quote,
        bundleKey: stage.bundleKey,
        reservationId: stage.reservationId,
        billingOperationId: stage.billingOperationId,
      })),
      expiresAt: input.reservationExpiresAt,
      now: input.now,
    });

    let executed: Awaited<ReturnType<typeof input.execute>>;
    try {
      executed = await input.execute();
    } catch (error) {
      for (const { stage, quote } of quotedStages) {
        await this.billing.finalizeBundle({
          ownerId: input.ownerId,
          eventId: this.createId(),
          reservationId: stage.reservationId,
          operation: stage.operation,
          pricePolicyVersion: quote.pricePolicyVersion,
          maximumChargePoints: quote.bundles[0]!.maximumChargePoints,
          terminalState: "provider_unavailable",
          actualDeliveredUsage: [],
          now: input.now,
        });
      }
      throw error;
    }

    if (executed.terminalState !== "delivered") {
      for (const { stage, quote } of quotedStages) {
        await this.billing.finalizeBundle({
          ownerId: input.ownerId,
          eventId: this.createId(),
          reservationId: stage.reservationId,
          operation: stage.operation,
          pricePolicyVersion: quote.pricePolicyVersion,
          maximumChargePoints: quote.bundles[0]!.maximumChargePoints,
          terminalState: executed.terminalState,
          actualDeliveredUsage: [],
          now: input.now,
        });
      }
      return { value: executed.value, chargedPoints: 0, charging: "released" };
    }

    let chargedPoints = 0;
    for (const { stage } of quotedStages) {
      if (!executed.actualUsageByBundle[stage.bundleKey]) {
        throw new Error(`Delivered billing usage is missing for ${stage.bundleKey}.`);
      }
    }
    for (const { stage, quote } of quotedStages) {
      const usage = executed.actualUsageByBundle[stage.bundleKey]!;
      const finalized = await this.billing.finalizeBundle({
        ownerId: input.ownerId,
        eventId: this.createId(),
        reservationId: stage.reservationId,
        operation: stage.operation,
        pricePolicyVersion: quote.pricePolicyVersion,
        maximumChargePoints: quote.bundles[0]!.maximumChargePoints,
        terminalState: "delivered",
        actualDeliveredUsage: usage,
        now: input.now,
      });
      chargedPoints += finalized.chargedPoints;
    }
    return { value: executed.value, chargedPoints, charging: "charged" };
  }
}
