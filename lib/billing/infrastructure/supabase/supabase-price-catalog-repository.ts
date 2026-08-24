import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegisteredAiOperation } from "../../../ai/operation-registry.ts";
import { AiPricePolicySchema, type AiPricePolicy } from "../../domain/price-catalog.ts";
import type { PriceCatalogRepository } from "../../ports/price-catalog-repository.ts";

export class SupabasePriceCatalogRepository implements PriceCatalogRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async putPolicy(rawPolicy: AiPricePolicy): Promise<void> {
    const policy = AiPricePolicySchema.parse(rawPolicy);
    const { error } = await this.client.rpc("put_ai_price_policy", { p_policy: policy });
    if (error) throw new Error(`Price policy write failed: ${error.message}`);
  }

  async getPolicy(input: { operation: RegisteredAiOperation; provider: string; modelId: string; at: string }): Promise<AiPricePolicy | null> {
    const { data, error } = await this.client.rpc("get_ai_price_policy", {
      p_operation: input.operation, p_provider: input.provider, p_model_id: input.modelId, p_at: input.at,
    });
    if (error) throw new Error(`Price policy read failed: ${error.message}`);
    return data ? AiPricePolicySchema.parse(data) : null;
  }

  async getPolicyByVersion(policyVersion: string): Promise<AiPricePolicy | null> {
    const { data, error } = await this.client.rpc("get_ai_price_policy_by_version", { p_policy_version: policyVersion });
    if (error) throw new Error(`Price policy version read failed: ${error.message}`);
    return data ? AiPricePolicySchema.parse(data) : null;
  }
}
