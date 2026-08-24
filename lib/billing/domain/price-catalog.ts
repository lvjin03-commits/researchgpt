import { z } from "zod";
import { REGISTERED_AI_OPERATIONS, type RegisteredAiOperation } from "../../ai/operation-registry.ts";
import { StandardizedBillableUsageSchema, type StandardizedBillableUsage } from "../../ai/billable-usage.ts";

const MoneyRateSchema = z.number().int().nonnegative().safe();

export const TokenRateSchema = z.object({
  inputMicroUsdPerMillion: MoneyRateSchema,
  cachedInputMicroUsdPerMillion: MoneyRateSchema,
  outputMicroUsdPerMillion: MoneyRateSchema,
}).strict();

const UnitRateSchema = z.object({
  usageKind: z.enum(["tool_call", "image_input", "image_generation", "audio", "video"]),
  discriminator: z.string().trim().min(1).max(200),
  microUsdPerUnit: MoneyRateSchema,
  unitSize: z.number().int().positive().safe(),
}).strict();

export const AiPricePolicySchema = z.object({
  policyVersion: z.string().trim().min(1).max(100),
  operation: z.enum(REGISTERED_AI_OPERATIONS),
  provider: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(200),
  tokenRates: TokenRateSchema.optional(),
  unitRates: z.array(UnitRateSchema),
  cnyMicrosPerUsd: z.number().int().positive().safe(),
  markupBasisPoints: z.number().int().min(0).max(100_000),
  rounding: z.literal("ceil_to_whole_point"),
  effectiveFrom: z.string().datetime({ offset: true }),
  effectiveUntil: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type AiPricePolicy = z.infer<typeof AiPricePolicySchema>;

export type UsagePriceResult = {
  providerCostMicroUsd: bigint;
  providerCostMicroCny: bigint;
  markedUpCostMicroCny: bigint;
  points: number;
};

const ZERO = BigInt(0);
const ONE = BigInt(1);
const MICRO_PER_UNIT = BigInt(1_000_000);
const MICRO_CNY_PER_POINT = BigInt(10_000);
const BASIS_POINTS = BigInt(10_000);

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return numerator === ZERO ? ZERO : (numerator + denominator - ONE) / denominator;
}

function discriminator(usage: StandardizedBillableUsage): string {
  if (usage.kind === "tool_call") return usage.tool;
  if (usage.kind === "image_input") return usage.detail;
  if (usage.kind === "image_generation") return `${usage.size}:${usage.quality}`;
  if (usage.kind === "audio") return "milliseconds";
  if (usage.kind === "video") return `${usage.resolution}:milliseconds`;
  throw new Error("Token usage has no unit-rate discriminator.");
}

function usageUnits(usage: Exclude<StandardizedBillableUsage, { kind: "tokens" }>): bigint {
  if (usage.kind === "tool_call" || usage.kind === "image_generation") return BigInt(usage.count);
  if (usage.kind === "image_input") return BigInt(usage.units);
  return BigInt(usage.durationMilliseconds);
}

export function calculateUsagePrice(input: {
  policy: AiPricePolicy;
  usage: readonly StandardizedBillableUsage[];
}): UsagePriceResult {
  const policy = AiPricePolicySchema.parse(input.policy);
  let providerCostMicroUsd = ZERO;
  for (const rawUsage of input.usage) {
    const usage = StandardizedBillableUsageSchema.parse(rawUsage);
    if (usage.kind === "tokens") {
      if (!policy.tokenRates) throw new Error(`Price policy ${policy.policyVersion} has no token rate.`);
      const rates = policy.tokenRates;
      providerCostMicroUsd += ceilDivide(BigInt(usage.inputTokens - usage.cachedInputTokens) * BigInt(rates.inputMicroUsdPerMillion), MICRO_PER_UNIT);
      providerCostMicroUsd += ceilDivide(BigInt(usage.cachedInputTokens) * BigInt(rates.cachedInputMicroUsdPerMillion), MICRO_PER_UNIT);
      providerCostMicroUsd += ceilDivide(BigInt(usage.outputTokens) * BigInt(rates.outputMicroUsdPerMillion), MICRO_PER_UNIT);
      continue;
    }
    const rate = policy.unitRates.find((candidate) => candidate.usageKind === usage.kind && candidate.discriminator === discriminator(usage));
    if (!rate) throw new Error(`Price policy ${policy.policyVersion} has no ${usage.kind}:${discriminator(usage)} rate.`);
    providerCostMicroUsd += ceilDivide(usageUnits(usage) * BigInt(rate.microUsdPerUnit), BigInt(rate.unitSize));
  }
  const providerCostMicroCny = ceilDivide(providerCostMicroUsd * BigInt(policy.cnyMicrosPerUsd), MICRO_PER_UNIT);
  const markedUpCostMicroCny = ceilDivide(providerCostMicroCny * BigInt(BASIS_POINTS + BigInt(policy.markupBasisPoints)), BASIS_POINTS);
  const pointValue = ceilDivide(markedUpCostMicroCny, MICRO_CNY_PER_POINT);
  if (pointValue > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Calculated point charge exceeds the safe integer range.");
  return { providerCostMicroUsd, providerCostMicroCny, markedUpCostMicroCny, points: Number(pointValue) };
}

export type UsageRange = {
  low: StandardizedBillableUsage[];
  high: StandardizedBillableUsage[];
  maximum: StandardizedBillableUsage[];
};

export type BillingBundleQuote = {
  bundleKey: string;
  estimatedLowPoints: number;
  estimatedHighPoints: number;
  maximumChargePoints: number;
};

export type BillingQuote = {
  operation: RegisteredAiOperation;
  pricePolicyVersion: string;
  bundles: BillingBundleQuote[];
  estimatedLowPoints: number;
  estimatedHighPoints: number;
  maximumChargePoints: number;
};

export function createBillingQuote(input: {
  operation: RegisteredAiOperation;
  policy: AiPricePolicy;
  bundles: Array<{ bundleKey: string; usage: UsageRange }>;
}): BillingQuote {
  const policy = AiPricePolicySchema.parse(input.policy);
  if (policy.operation !== input.operation) throw new Error("Price policy does not own the requested Operation.");
  const keys = new Set<string>();
  const bundles = input.bundles.map((bundle) => {
    if (!bundle.bundleKey || keys.has(bundle.bundleKey)) throw new Error("Billing bundle keys must be non-empty and unique.");
    keys.add(bundle.bundleKey);
    const low = calculateUsagePrice({ policy, usage: bundle.usage.low }).points;
    const high = calculateUsagePrice({ policy, usage: bundle.usage.high }).points;
    const maximum = calculateUsagePrice({ policy, usage: bundle.usage.maximum }).points;
    if (low > high || high > maximum) throw new Error("Billing usage range must be monotonic after pricing.");
    return { bundleKey: bundle.bundleKey, estimatedLowPoints: low, estimatedHighPoints: high, maximumChargePoints: maximum };
  });
  return {
    operation: input.operation, pricePolicyVersion: policy.policyVersion, bundles,
    estimatedLowPoints: bundles.reduce((sum, item) => sum + item.estimatedLowPoints, 0),
    estimatedHighPoints: bundles.reduce((sum, item) => sum + item.estimatedHighPoints, 0),
    maximumChargePoints: bundles.reduce((sum, item) => sum + item.maximumChargePoints, 0),
  };
}

export function requiresBillingConfirmation(input: { quote: BillingQuote; availablePoints: number }): boolean {
  if (!Number.isSafeInteger(input.availablePoints) || input.availablePoints < 0) throw new Error("Available points must be a nonnegative safe integer.");
  return input.quote.estimatedHighPoints >= 500 ||
    (input.availablePoints > 0 && input.quote.maximumChargePoints * 2 >= input.availablePoints);
}
