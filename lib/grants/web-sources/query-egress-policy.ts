import { createHash } from "node:crypto";
import { z } from "zod";

export const GRANT_WEB_SEARCH_EGRESS_POLICY_VERSION = "grant-web-search-egress-v1";

export const GrantWebSearchEgressIssueSchema = z.enum([
  "query_too_short",
  "query_too_long",
  "contact_information",
  "url_or_network_identifier",
  "project_identifier",
  "precise_numeric_parameter",
  "document_sensitive_term",
  "long_verbatim_document_overlap",
]);

export type GrantWebSearchEgressIssue = z.infer<typeof GrantWebSearchEgressIssueSchema>;

export type GrantWebSearchEgressDecision = Readonly<({
  allowed: true;
  outgoingQuery: string;
  candidateHash: string;
  policyVersion: string;
  issues: readonly [];
} | {
  allowed: false;
  outgoingQuery: null;
  candidateHash: string;
  policyVersion: string;
  issues: readonly GrantWebSearchEgressIssue[];
})>;

function compact(value: string) {
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
}

function comparisonText(value: string) {
  return compact(value).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function hasLongVerbatimOverlap(query: string, documentText: string): boolean {
  const needle = comparisonText(query);
  const haystack = comparisonText(documentText);
  if (needle.length < 24 || haystack.length < 24) return false;
  for (let index = 0; index <= needle.length - 24; index += 1) {
    if (haystack.includes(needle.slice(index, index + 24))) return true;
  }
  return false;
}

export function assessGrantWebSearchEgress(input: {
  candidateQuery: string;
  documentText: string;
  sensitiveTerms: readonly string[];
}): GrantWebSearchEgressDecision {
  const query = compact(input.candidateQuery);
  const issues = new Set<GrantWebSearchEgressIssue>();
  if (query.length < 2) issues.add("query_too_short");
  if (query.length > 160) issues.add("query_too_long");
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(query) || /(?:\+?\d[\s().-]*){8,}/u.test(query)) issues.add("contact_information");
  if (/\b(?:https?:\/\/|www\.)\S+/iu.test(query) || /\b(?:\d{1,3}\.){3}\d{1,3}\b/u.test(query)) issues.add("url_or_network_identifier");
  if (/\b(?=[A-Z0-9-]{6,}\b)(?=[A-Z0-9-]*\d{4,})[A-Z0-9]+(?:-[A-Z0-9]+)*\b/iu.test(query)) issues.add("project_identifier");
  if (/(?:\d+[.]\d+|\d+\s*(?:[-–~至]\s*)\d+)\s*(?:%|°C|K|V|mV|A|mA|mAh|Ah|mol|mmol|μmol|nm|μm|mm|cm|Pa|kPa|MPa|h|min|s)\b/iu.test(query)) issues.add("precise_numeric_parameter");
  const comparedQuery = comparisonText(query);
  const sensitive = input.sensitiveTerms.map(compact).filter((term) => term.length >= 2);
  if (sensitive.some((term) => comparedQuery.includes(comparisonText(term)))) issues.add("document_sensitive_term");
  if (hasLongVerbatimOverlap(query, input.documentText)) issues.add("long_verbatim_document_overlap");
  const sortedIssues = [...issues].sort();
  const shared = { candidateHash: createHash("sha256").update(query, "utf8").digest("hex"),
    policyVersion: GRANT_WEB_SEARCH_EGRESS_POLICY_VERSION };
  return sortedIssues.length === 0
    ? Object.freeze({ ...shared, allowed: true, outgoingQuery: query, issues: Object.freeze([] as []) })
    : Object.freeze({ ...shared, allowed: false, outgoingQuery: null, issues: Object.freeze(sortedIssues) });
}
