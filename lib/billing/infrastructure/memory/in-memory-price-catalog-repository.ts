import type { RegisteredAiOperation } from "../../../ai/operation-registry.ts";
import { AiPricePolicySchema, type AiPricePolicy } from "../../domain/price-catalog.ts";
import type { PriceCatalogRepository } from "../../ports/price-catalog-repository.ts";

export class InMemoryPriceCatalogRepository implements PriceCatalogRepository {
  private readonly policies = new Map<string, AiPricePolicy>();

  async putPolicy(rawPolicy: AiPricePolicy): Promise<void> {
    const policy = AiPricePolicySchema.parse(rawPolicy);
    if (this.policies.has(policy.policyVersion)) throw new Error(`Price policy version already exists: ${policy.policyVersion}`);
    this.policies.set(policy.policyVersion, structuredClone(policy));
  }

  async getPolicy(input: { operation: RegisteredAiOperation; provider: string; modelId: string; at: string }): Promise<AiPricePolicy | null> {
    const candidates = [...this.policies.values()].filter((policy) =>
      policy.operation === input.operation && policy.provider === input.provider && policy.modelId === input.modelId &&
      policy.effectiveFrom <= input.at && (!policy.effectiveUntil || policy.effectiveUntil > input.at));
    candidates.sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom));
    return candidates[0] ? structuredClone(candidates[0]) : null;
  }

  async getPolicyByVersion(policyVersion: string): Promise<AiPricePolicy | null> {
    const policy = this.policies.get(policyVersion);
    return policy ? structuredClone(policy) : null;
  }
}
