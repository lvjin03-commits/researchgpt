import { sha256Canonical } from "../domain/canonical-json.ts";
import {
  GrantAiEditClaimBindingSchema,
  GrantAiEditFactCheckReportSchema,
  type GrantAiEditClaimBinding,
  type GrantAiEditFactCheckReport,
} from "./contracts.ts";

type ClaimKind = "numeric_assertion" | "factual_assertion" | "citation_marker" | "reference_entry";
type LocatedClaim = { kind: ClaimKind; startOffset: number; endOffset: number; text: string };

const RULES: ReadonlyArray<{ kind: ClaimKind; pattern: RegExp }> = [
  { kind: "reference_entry", pattern: /(?:^|\n)\s*(?:参考文献|References?)\s*[:：]?|(?:^|\n)\s*\[[0-9]{1,3}\]\s+[^\n]+/gimu },
  { kind: "citation_marker", pattern: /\[[0-9]{1,3}(?:\s*[-,，]\s*[0-9]{1,3})*\]|\([A-Z][A-Za-z-]+\s*,?\s*(?:19|20)\d{2}[a-z]?\)/gu },
  { kind: "numeric_assertion", pattern: /(?<![A-Za-z])\d+(?:\.\d+)?\s*(?:%|％|h|小时|次|圈|mA\s*cm[-−–—]?2|mAh\s*cm[-−–—]?2|Wh\s*kg[-−–—]?1|MPa|GPa|℃|°C|倍|天|年)/giu },
  { kind: "factual_assertion", pattern: /(?:结果|实验|数据)(?:表明|显示|证实)|研究发现|前期(?:研究|实验|工作|成果)(?:表明|显示|证实|发现|已成功)|申请人(?:已成功|发现|证实|建立|制备)/gu },
];

function occurrences(text: string, rule: { kind: ClaimKind; pattern: RegExp }): LocatedClaim[] {
  return [...text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))].map((match) => ({
    kind: rule.kind, startOffset: match.index, endOffset: match.index + match[0].length, text: match[0],
  }));
}

function newlyIntroduced(oldText: string, newText: string): LocatedClaim[] {
  const claims: LocatedClaim[] = [];
  for (const rule of RULES) {
    const oldCounts = new Map<string, number>();
    for (const item of occurrences(oldText, rule)) oldCounts.set(item.text, (oldCounts.get(item.text) ?? 0) + 1);
    for (const item of occurrences(newText, rule)) {
      const remaining = oldCounts.get(item.text) ?? 0;
      if (remaining > 0) oldCounts.set(item.text, remaining - 1);
      else claims.push(item);
    }
  }
  return claims.sort((left, right) => left.startOffset - right.startOffset || left.kind.localeCompare(right.kind));
}

export function evaluateGrantAiEditFactSafety(input: {
  oldText: string;
  newText: string;
  proposedBindings?: GrantAiEditClaimBinding[];
  authorizedEvidenceCardIds?: string[];
  authorizedWebSourceSnapshotIds?: string[];
}): GrantAiEditFactCheckReport {
  const claims = newlyIntroduced(input.oldText, input.newText).map((claim, index) => ({
    claimRef: `C${index + 1}`, kind: claim.kind, startOffset: claim.startOffset,
    endOffset: claim.endOffset, textHash: sha256Canonical(claim.text),
  }));
  const claimRefs = new Set(claims.map((claim) => claim.claimRef));
  const authorizedEvidence = new Set(input.authorizedEvidenceCardIds ?? []);
  const authorizedWeb = new Set(input.authorizedWebSourceSnapshotIds ?? []);
  const bindings = (input.proposedBindings ?? []).map((binding) => GrantAiEditClaimBindingSchema.parse(binding));
  const issues: Array<{ code: "new_reference_forbidden" | "claim_binding_missing" | "claim_binding_unknown" | "claim_source_unauthorized"; claimRef?: string }> = [];
  for (const binding of bindings) {
    if (!claimRefs.has(binding.claimRef)) issues.push({ code: "claim_binding_unknown", claimRef: binding.claimRef });
    else if ((binding.evidenceCardId && !authorizedEvidence.has(binding.evidenceCardId)) || (binding.webSourceSnapshotId && !authorizedWeb.has(binding.webSourceSnapshotId))) {
      issues.push({ code: "claim_source_unauthorized", claimRef: binding.claimRef });
    }
  }
  for (const claim of claims) {
    if (claim.kind === "reference_entry" || claim.kind === "citation_marker") {
      issues.push({ code: "new_reference_forbidden", claimRef: claim.claimRef });
      continue;
    }
    const validBinding = bindings.some((binding) => binding.claimRef === claim.claimRef
      && ((!binding.evidenceCardId || authorizedEvidence.has(binding.evidenceCardId))
        && (!binding.webSourceSnapshotId || authorizedWeb.has(binding.webSourceSnapshotId))));
    if (!validBinding) issues.push({ code: "claim_binding_missing", claimRef: claim.claimRef });
  }
  const state = issues.some((issue) => issue.code === "new_reference_forbidden" || issue.code === "claim_binding_unknown" || issue.code === "claim_source_unauthorized")
    ? "blocked"
    : issues.length > 0 ? "needs_confirmation" : "passed";
  return GrantAiEditFactCheckReportSchema.parse({ policyVersion: "grant-edit-fact-check-v1", claims, bindings, issues, state });
}

