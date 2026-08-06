import { z } from "zod";
import type {
  DocumentExecutionBudgetSnapshot,
  DocumentTextExecutionProfile,
} from "@/lib/document-v2/runtime/contracts";
import type { DocumentOperationBudgetKey } from "@/lib/document-v2/runtime/token-budgets";

export const DeepSeekThinkingPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("disabled") }).strict(),
  z
    .object({
      mode: z.literal("enabled"),
      effort: z.enum(["high", "max"]),
    })
    .strict(),
]);

export type DeepSeekThinkingPolicy = z.infer<
  typeof DeepSeekThinkingPolicySchema
>;

export const OpenAIReasoningPolicySchema = z
  .object({
    mode: z.literal("effort"),
    effort: z.enum(["none", "low", "medium"]),
  })
  .strict();

export type OpenAIReasoningPolicy = z.infer<
  typeof OpenAIReasoningPolicySchema
>;

export type ProviderReasoningPolicy =
  | Readonly<{ provider: "deepseek"; thinking: DeepSeekThinkingPolicy }>
  | Readonly<{ provider: "openai"; reasoning: OpenAIReasoningPolicy }>;

export type ProviderReasoningStorageProjection = Readonly<{
  mode: "disabled" | "enabled" | "effort";
  effort: "none" | "low" | "medium" | "high" | "max";
  policyVersion: "provider-reasoning-policy-v1";
  policy: ProviderReasoningPolicy;
}>;

const LEGACY_UNSAFE_DEEPSEEK_CONTENT_POLICY =
  "document-operation-budget-v2";

function configuredEffort(input: {
  profile: DocumentTextExecutionProfile;
  configuredPolicy?: "inherit" | "none" | "low" | "medium";
}) {
  return input.configuredPolicy && input.configuredPolicy !== "inherit"
    ? input.configuredPolicy
    : input.profile.reasoningEffort;
}

/**
 * Converts the frozen, provider-neutral budget setting into the only policy
 * shape the selected provider is allowed to receive. Legacy v2 DeepSeek
 * section snapshots are migrated here because their inherited `low` value is
 * interpreted by DeepSeek V4 as `high`, which can consume the complete output
 * budget before any visible section content is emitted.
 */
export function resolveProviderReasoningPolicy(input: {
  profile: DocumentTextExecutionProfile;
  configuredPolicy?: "inherit" | "none" | "low" | "medium";
  budgetKey?: DocumentOperationBudgetKey;
  budgetPolicyVersion: string;
}): ProviderReasoningPolicy {
  let effort = configuredEffort(input);
  const legacyDeepSeekContentPolicy =
    input.profile.provider === "deepseek" &&
    input.budgetPolicyVersion === LEGACY_UNSAFE_DEEPSEEK_CONTENT_POLICY &&
    (input.budgetKey === "component.section" ||
      input.budgetKey === "component.conclusion");
  if (legacyDeepSeekContentPolicy) effort = "none";

  if (input.profile.provider === "deepseek") {
    return {
      provider: "deepseek",
      thinking: DeepSeekThinkingPolicySchema.parse(
        effort === "none"
          ? { mode: "disabled" }
          : {
              mode: "enabled",
              // DeepSeek V4 currently maps low and medium to high. Keep that
              // provider fact out of the business-level budget contract.
              effort: "high",
            },
      ),
    };
  }

  return {
    provider: "openai",
    reasoning: OpenAIReasoningPolicySchema.parse({
      mode: "effort",
      effort,
    }),
  };
}

export type DeepSeekReasoningRequest =
  | Readonly<{
      thinking: { type: "disabled" };
    }>
  | Readonly<{
      thinking: { type: "enabled" };
      reasoning_effort: "high" | "max";
    }>;

export function serializeDeepSeekReasoningPolicy(
  policy: DeepSeekThinkingPolicy,
): DeepSeekReasoningRequest {
  const validated = DeepSeekThinkingPolicySchema.parse(policy);
  return validated.mode === "disabled"
    ? { thinking: { type: "disabled" } }
    : {
        thinking: { type: "enabled" },
        reasoning_effort: validated.effort,
      };
}

export function providerReasoningIsEnabled(
  policy: ProviderReasoningPolicy,
): boolean {
  return policy.provider === "deepseek"
    ? policy.thinking.mode === "enabled"
    : policy.reasoning.effort !== "none";
}

export function providerReasoningLabel(
  policy: ProviderReasoningPolicy,
): string {
  if (policy.provider === "deepseek") {
    return policy.thinking.mode === "disabled"
      ? "none"
      : policy.thinking.effort;
  }
  return policy.reasoning.effort;
}

export function projectProviderReasoningPolicyForStorage(
  policy: ProviderReasoningPolicy,
): ProviderReasoningStorageProjection {
  if (policy.provider === "deepseek") {
    return {
      mode: policy.thinking.mode,
      effort:
        policy.thinking.mode === "disabled"
          ? "none"
          : policy.thinking.effort,
      policyVersion: "provider-reasoning-policy-v1",
      policy,
    };
  }
  return {
    mode: "effort",
    effort: policy.reasoning.effort,
    policyVersion: "provider-reasoning-policy-v1",
    policy,
  };
}

export function assertProviderReasoningPolicyMatchesSnapshot(input: {
  policy: ProviderReasoningPolicy;
  snapshot: DocumentExecutionBudgetSnapshot;
}) {
  if (input.policy.provider !== input.snapshot.modelCapability.provider) {
    throw new Error(
      `Provider reasoning policy "${input.policy.provider}" does not match frozen provider "${input.snapshot.modelCapability.provider}".`,
    );
  }
}
