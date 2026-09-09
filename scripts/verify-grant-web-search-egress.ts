import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantWebSearchEgressAuditSchema } from "../lib/grants/web-sources/query-audit-contracts.ts";
import { assessGrantWebSearchEgress, GRANT_WEB_SEARCH_EGRESS_POLICY_VERSION } from "../lib/grants/web-sources/query-egress-policy.ts";

const safe = assessGrantWebSearchEgress({
  candidateQuery: "  zinc ion battery electrolyte interface regulation  ",
  documentText: "Confidential application text about a particular experimental route.",
  sensitiveTerms: ["Dr Example", "Partner Laboratory"],
});
assert.equal(safe.allowed, true);
assert.equal(safe.outgoingQuery, "zinc ion battery electrolyte interface regulation");
assert.equal(safe.policyVersion, GRANT_WEB_SEARCH_EGRESS_POLICY_VERSION);
assert.match(safe.candidateHash, /^[a-f0-9]{64}$/u);

const blockedCases: Array<[string, string]> = [
  ["contact me at applicant@example.org zinc battery", "contact_information"],
  ["zinc battery https://private.example/path", "url_or_network_identifier"],
  ["NSFC-5260022912 zinc battery", "project_identifier"],
  ["electrolyte voltage 0.76 V zinc battery", "precise_numeric_parameter"],
  ["Partner Laboratory zinc battery", "document_sensitive_term"],
  ["本项目拟通过原位拉曼光谱揭示锌离子界面溶剂化结构动态演化规律", "long_verbatim_document_overlap"],
];
for (const [query, expected] of blockedCases) {
  const decision = assessGrantWebSearchEgress({
    candidateQuery: query,
    documentText: "本项目拟通过原位拉曼光谱揭示锌离子界面溶剂化结构动态演化规律，并建立调控机制。",
    sensitiveTerms: ["Partner Laboratory"],
  });
  assert.equal(decision.allowed, false, query);
  assert.equal(decision.outgoingQuery, null, "blocked candidate text must not be retained as an outgoing query");
  assert.ok(decision.issues.includes(expected as never), `${query}: expected ${expected}`);
}

const auditBase = {
  auditId: randomUUID(), documentId: randomUUID(), sourceRevision: 3, actorId: randomUUID(),
  providerId: "google_custom_search" as const, policyVersion: safe.policyVersion,
  candidateHash: safe.candidateHash, createdAt: "2026-09-08T12:00:00.000Z",
};
GrantWebSearchEgressAuditSchema.parse({ ...auditBase, decision: "allowed", outgoingQuery: safe.outgoingQuery, issues: [] });
GrantWebSearchEgressAuditSchema.parse({ ...auditBase, decision: "blocked", outgoingQuery: null, issues: ["document_sensitive_term"] });
assert.throws(() => GrantWebSearchEgressAuditSchema.parse({ ...auditBase, decision: "blocked", outgoingQuery: "secret query", issues: ["document_sensitive_term"] }));
assert.throws(() => GrantWebSearchEgressAuditSchema.parse({ ...auditBase, decision: "allowed", outgoingQuery: safe.outgoingQuery, issues: ["document_sensitive_term"] }));

console.log("Grant web-search egress policy and audit contracts verified offline.");
