export type GrantWebSourceQualityTier =
  | "academic_database" | "official_institution" | "university_research"
  | "general_web" | "low_trust";

export interface GrantWebTrustRule {
  readonly id: string;
  readonly domain: string;
  readonly includeSubdomains: boolean;
  readonly qualityTier: GrantWebSourceQualityTier;
  readonly rationale: string;
}

// Policy data, not a model prompt or a claim-verification mechanism.
export const GRANT_WEB_SOURCE_TRUST_REGISTRY = Object.freeze({
  name: "grant_web_source_trust_registry",
  version: "1",
  owner: "Grant architecture maintainer",
  reviewPolicy: "Human-reviewed PR; quarterly and incident-triggered review",
  rules: Object.freeze([
    { id: "openalex-domain", domain: "openalex.org", includeSubdomains: true, qualityTier: "academic_database", rationale: "Project policy: OpenAlex domain; not provenance for arbitrary landing URLs" },
    { id: "government-us", domain: "gov", includeSubdomains: true, qualityTier: "official_institution", rationale: "Government namespace provenance only" },
    { id: "government-cn", domain: "gov.cn", includeSubdomains: true, qualityTier: "official_institution", rationale: "Government namespace provenance only" },
    { id: "education-us", domain: "edu", includeSubdomains: true, qualityTier: "university_research", rationale: "Educational namespace; includes non-research and user-authored pages" },
    { id: "education-cn", domain: "edu.cn", includeSubdomains: true, qualityTier: "university_research", rationale: "Educational namespace; not peer-review certification" },
    { id: "education-uk", domain: "ac.uk", includeSubdomains: true, qualityTier: "university_research", rationale: "Academic namespace; not peer-review certification" },
  ].map((rule) => Object.freeze(rule as GrantWebTrustRule))),
});

export interface GrantWebSourceClassification {
  readonly hostname: string | null;
  readonly qualityTier: GrantWebSourceQualityTier;
  readonly registryVersion: string;
  readonly ruleId: string | null;
  readonly reason: "domain_rule" | "unknown_domain" | "invalid_url";
}

/** Classifies URLs only. Never accepts a tier or provider label from a model. */
export function classifyGrantWebSource(url: string): GrantWebSourceClassification {
  const registry = GRANT_WEB_SOURCE_TRUST_REGISTRY;
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error("unsupported URL");
    hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname || hostname.endsWith(".")) throw new Error("invalid host");
  } catch {
    return Object.freeze({ hostname: null, qualityTier: "low_trust", registryVersion: registry.version, ruleId: null, reason: "invalid_url" });
  }
  const matched = registry.rules.filter((rule) => hostname === rule.domain ||
    (rule.includeSubdomains && hostname.endsWith(`.${rule.domain}`)))
    .sort((a, b) => Number(b.qualityTier === "low_trust") - Number(a.qualityTier === "low_trust") ||
      b.domain.length - a.domain.length || a.id.localeCompare(b.id))[0];
  return Object.freeze({ hostname, qualityTier: matched?.qualityTier ?? "general_web",
    registryVersion: registry.version, ruleId: matched?.id ?? null,
    reason: matched ? "domain_rule" : "unknown_domain" });
}
