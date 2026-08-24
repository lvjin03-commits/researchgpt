import type { RegisteredAiOperation } from "../../ai/operation-registry.ts";
import type { StandardizedBillableUsage } from "../../ai/billable-usage.ts";
import type { PointLedgerRepository } from "../ports/point-ledger-repository.ts";
import type { PriceCatalogRepository } from "../ports/price-catalog-repository.ts";
import { calculateUsagePrice, createBillingQuote, type BillingQuote, type UsageRange } from "../domain/price-catalog.ts";
import { getBillingOperationContract, resolveBillingDecision } from "../domain/deliverability.ts";

export type QuoteBillingOperationInput = {
  operation: RegisteredAiOperation;
  provider: string;
  modelId: string;
  bundles: Array<{ bundleKey: string; usage: UsageRange }>;
  now: string;
};

export type ReserveBillingQuoteInput = {
  ownerId: string;
  parentBillingOperationId: string;
  quote: BillingQuote;
  bundles: Array<{ bundleKey: string; reservationId: string; billingOperationId: string }>;
  expiresAt: string;
  now: string;
};

export type FinalizeBillingBundleInput = {
  ownerId: string;
  eventId: string;
  reservationId: string;
  operation: RegisteredAiOperation;
  pricePolicyVersion: string;
  maximumChargePoints: number;
  terminalState: string;
  actualDeliveredUsage: StandardizedBillableUsage[];
  now: string;
};

export type FinalizeBillingBundleResult = {
  decision: "charged" | "released";
  chargedPoints: number;
  absorbedOveragePoints: number;
  unknownTerminalState: boolean;
};

export class PointBillingService {
  private readonly dependencies: {
    ledger: PointLedgerRepository;
    prices: PriceCatalogRepository;
    onUnknownTerminalState?: (event: { operation: RegisteredAiOperation; terminalState: string }) => void;
  };

  constructor(dependencies: {
    ledger: PointLedgerRepository;
    prices: PriceCatalogRepository;
    onUnknownTerminalState?: (event: { operation: RegisteredAiOperation; terminalState: string }) => void;
  }) {
    this.dependencies = dependencies;
  }

  async quote(input: QuoteBillingOperationInput): Promise<BillingQuote> {
    const contract = getBillingOperationContract(input.operation);
    const suppliedKeys = input.bundles.map((bundle) => bundle.bundleKey).sort();
    const requiredKeys = [...contract.bundleKeys].sort();
    if (JSON.stringify(suppliedKeys) !== JSON.stringify(requiredKeys)) {
      throw new Error(`Billing bundles do not match ${contract.contractVersion}.`);
    }
    const policy = await this.dependencies.prices.getPolicy({
      operation: input.operation, provider: input.provider, modelId: input.modelId, at: input.now,
    });
    if (!policy) throw new Error(`No active price policy for ${input.operation}:${input.provider}:${input.modelId}.`);
    return createBillingQuote({ operation: input.operation, policy, bundles: input.bundles });
  }

  async reserveQuote(input: ReserveBillingQuoteInput) {
    const bindingByKey = new Map(input.bundles.map((bundle) => [bundle.bundleKey, bundle]));
    if (bindingByKey.size !== input.quote.bundles.length) throw new Error("Reservation bindings must cover each quoted bundle exactly once.");
    const bundles = input.quote.bundles.map((quoted) => {
      const binding = bindingByKey.get(quoted.bundleKey);
      if (!binding) throw new Error(`Missing reservation binding for ${quoted.bundleKey}.`);
      return {
        reservationId: binding.reservationId,
        billingOperationId: binding.billingOperationId,
        points: quoted.maximumChargePoints,
        pricePolicyVersion: input.quote.pricePolicyVersion,
        expiresAt: input.expiresAt,
        now: input.now,
      };
    });
    return this.dependencies.ledger.reserveBundleSet({
      ownerId: input.ownerId, parentBillingOperationId: input.parentBillingOperationId, bundles,
    });
  }

  async finalizeBundle(input: FinalizeBillingBundleInput): Promise<FinalizeBillingBundleResult> {
    const resolution = resolveBillingDecision({ operation: input.operation, terminalState: input.terminalState });
    if (resolution.unknownState) {
      this.dependencies.onUnknownTerminalState?.({ operation: input.operation, terminalState: input.terminalState });
    }
    if (resolution.decision === "release" || resolution.decision === "charge_delivered_bundles") {
      await this.dependencies.ledger.release({
        ownerId: input.ownerId, eventId: input.eventId, reservationId: input.reservationId,
        reason: resolution.unknownState ? "unknown_terminal_state" : input.terminalState, now: input.now,
      });
      return { decision: "released", chargedPoints: 0, absorbedOveragePoints: 0, unknownTerminalState: resolution.unknownState };
    }
    const policy = await this.dependencies.prices.getPolicyByVersion(input.pricePolicyVersion);
    if (!policy || policy.operation !== input.operation) throw new Error("Frozen price policy is unavailable or belongs to another Operation.");
    const calculated = calculateUsagePrice({ policy, usage: input.actualDeliveredUsage }).points;
    const chargedPoints = Math.min(calculated, input.maximumChargePoints);
    await this.dependencies.ledger.settle({
      ownerId: input.ownerId, eventId: input.eventId, reservationId: input.reservationId,
      settledPoints: chargedPoints, reason: input.terminalState, now: input.now,
    });
    return {
      decision: "charged", chargedPoints,
      absorbedOveragePoints: Math.max(0, calculated - input.maximumChargePoints),
      unknownTerminalState: false,
    };
  }
}
