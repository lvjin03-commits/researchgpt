import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateUsagePrice } from "../lib/billing/domain/price-catalog.ts";
import {
  GRANT_WEB_GPT_5_5_PRICE_CATALOG_VERSION,
  GRANT_WEB_GPT_5_5_PRICE_POLICIES,
  GRANT_WEB_GPT_5_5_USAGE_RANGES,
  GRANT_WEB_USER_CHARGE_CAP_POINTS,
} from "../lib/billing/policies/grant-web-grounded-gpt-5-5-v1.ts";

assert.equal(GRANT_WEB_GPT_5_5_PRICE_POLICIES.length, 7);
assert.equal(new Set(GRANT_WEB_GPT_5_5_PRICE_POLICIES.map((policy) => policy.operation)).size, 7);
assert.ok(GRANT_WEB_GPT_5_5_PRICE_POLICIES.every((policy) => policy.markupBasisPoints === 0));
assert.ok(GRANT_WEB_GPT_5_5_PRICE_POLICIES.every((policy) => policy.cnyMicrosPerUsd === 7_200_000));

const policyByOperation = new Map(GRANT_WEB_GPT_5_5_PRICE_POLICIES.map((policy) => [policy.operation, policy]));
const pairs = [
  ["next_step_decision", "grant.web_next_step.decide"],
  ["query_rewrite", "grant.web_query.rewrite"],
  ["search_query", "grant.web_search.query"],
  ["source_assessment", "grant.web_source.assess"],
  ["gap_comparison", "grant.web_gap.compare"],
  ["grounded_answer", "grant.web_answer.synthesize"],
  ["existing_results_delivery", "grant.web_existing_results.deliver"],
] as const;
const maximumCharges = pairs.map(([bundleKey, operation]) => calculateUsagePrice({
  policy: policyByOperation.get(operation)!, usage: GRANT_WEB_GPT_5_5_USAGE_RANGES[bundleKey]!.maximum,
}).points);
assert.deepEqual(maximumCharges, [21, 8, 15, 10, 101, 17, 93]);
assert.equal(maximumCharges.slice(1, 4).concat(maximumCharges.slice(5, 6))
  .reduce((sum, points) => sum + points, 0), GRANT_WEB_USER_CHARGE_CAP_POINTS,
"the fixed 50-point catalog remains only for the legacy non-resumable path");

const searchPolicy = policyByOperation.get("grant.web_search.query")!;
assert.equal(calculateUsagePrice({ policy: searchPolicy,
  usage: [{ kind: "tool_call", tool: "openai_web_search", count: 1 }] }).points, 8);

const migration = await readFile(new URL("../supabase/migrations/069_grant_web_gpt_5_5_price_catalog.sql", import.meta.url), "utf8");
const completionMigration = await readFile(new URL("../supabase/migrations/071_complete_resumable_grant_web_price_catalog.sql", import.meta.url), "utf8");
for (const policy of GRANT_WEB_GPT_5_5_PRICE_POLICIES) assert.ok(
  migration.includes(policy.policyVersion) || completionMigration.includes(policy.policyVersion),
  `migrations missing ${policy.policyVersion}`);
assert.ok(migration.includes(GRANT_WEB_GPT_5_5_PRICE_CATALOG_VERSION));
assert.equal((migration.match(/put_ai_price_policy/g) ?? []).length, 4);
assert.equal((completionMigration.match(/put_ai_price_policy/g) ?? []).length, 3);

console.log("Grant web gpt-5.5 price catalog verified: seven resumable operations; legacy path retains its isolated 50-point cap.");
