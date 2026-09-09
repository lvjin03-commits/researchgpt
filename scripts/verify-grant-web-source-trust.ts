import assert from "node:assert/strict";
import { classifyGrantWebSource, GRANT_WEB_SOURCE_TRUST_REGISTRY } from "../lib/grants/web-sources/trust-registry.ts";

const cases = [
  ["https://api.openalex.org/works", "academic_database"],
  ["https://www.example.gov/paper", "official_institution"],
  ["https://example.gov.cn", "official_institution"],
  ["https://lab.example.edu", "university_research"],
  ["https://lab.example.edu.cn", "university_research"],
  ["http://lab.example.ac.uk", "university_research"],
  ["https://API.OPENALEX.ORG./works", "academic_database"],
  ["https://openalex.org.evil.example", "general_web"],
  ["https://notopenalex.org", "general_web"],
  ["https://unknown.example/?provider=openalex&qualityTier=academic_database", "general_web"],
  ["https://unknown.example/openalex.org", "general_web"],
  ["https://example.edu.evil.example", "general_web"],
  ["https://оpenalex.org", "general_web"],
  ["https://127.0.0.1", "general_web"],
  ["https://openalex.org@evil.example", "low_trust"],
  ["javascript:alert(1)", "low_trust"],
  ["file:///openalex.org", "low_trust"],
  ["not a URL", "low_trust"],
  ["https://openalex.org..", "low_trust"],
] as const;
for (const [url, tier] of cases) {
  const result = classifyGrantWebSource(url);
  assert.equal(result.qualityTier, tier, url);
  assert.equal(result.registryVersion, "1");
  assert.ok(Object.isFrozen(result));
}
assert.equal(classifyGrantWebSource("https://unknown.example").ruleId, null);
assert.equal(classifyGrantWebSource("bad").reason, "invalid_url");
assert.equal(classifyGrantWebSource("https://api.openalex.org").ruleId, "openalex-domain");
assert.ok(Object.isFrozen(GRANT_WEB_SOURCE_TRUST_REGISTRY));
assert.ok(Object.isFrozen(GRANT_WEB_SOURCE_TRUST_REGISTRY.rules));
assert.ok(GRANT_WEB_SOURCE_TRUST_REGISTRY.rules.every(Object.isFrozen));
assert.equal(new Set(GRANT_WEB_SOURCE_TRUST_REGISTRY.rules.map((r) => r.id)).size, GRANT_WEB_SOURCE_TRUST_REGISTRY.rules.length);
console.log(`Grant web source trust: ${cases.length} URL cases and immutable/version checks passed (offline).`);
