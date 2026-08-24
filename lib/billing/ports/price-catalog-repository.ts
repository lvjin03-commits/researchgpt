import type { RegisteredAiOperation } from "../../ai/operation-registry.ts";
import type { AiPricePolicy } from "../domain/price-catalog.ts";

export interface PriceCatalogRepository {
  getPolicy(input: { operation: RegisteredAiOperation; provider: string; modelId: string; at: string }): Promise<AiPricePolicy | null>;
  getPolicyByVersion(policyVersion: string): Promise<AiPricePolicy | null>;
  putPolicy(policy: AiPricePolicy): Promise<void>;
}
