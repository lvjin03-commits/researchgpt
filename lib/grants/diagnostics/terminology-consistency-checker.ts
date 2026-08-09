import type { GrantChecker, GrantCheckerFindingCandidate, GrantCheckerInput } from "./checker.ts";
import { grantNodeText } from "./node-text.ts";

const TERM_DEFINITION = /([\p{Script=Han}]{2,16}|[A-Za-z][A-Za-z -]{3,60})\s*[（(]\s*([A-Z][A-Z0-9-]{1,9})\s*[）)]/gu;

type Definition = {
  acronym: string;
  term: string;
  normalizedTerm: string;
  nodeId: string;
  sectionId: string;
  start: number;
  end: number;
};

function normalizeTerm(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function cleanDefinition(value: string): string {
  let result = value.trim();
  const prefixes = /^(?:本项目|本研究|本课题|研究目标包括|申请人|拟|将|采用|使用|通过|基于|构建|建立|开发|引入)/u;
  while (prefixes.test(result)) result = result.replace(prefixes, "").trim();
  return result || value.trim();
}

export class GrantTerminologyConsistencyChecker implements GrantChecker {
  readonly checkerId = "grant.terminology_consistency";
  readonly checkerVersion = "1.0.0";
  readonly contractVersion = "grant-checker-v1";
  readonly inputMode = "full_document" as const;
  readonly supportedInputModes = ["full_document", "section_bundle"] as const;

  async check(input: GrantCheckerInput) {
    const allowedNodeIds = new Set(input.inputNodeIds);
    const definitions: Definition[] = [];
    for (const node of input.snapshot.nodes) {
      if (!["paragraph", "list", "table"].includes(node.nodeType)) continue;
      const text = grantNodeText(node);
      TERM_DEFINITION.lastIndex = 0;
      for (const match of text.matchAll(TERM_DEFINITION)) {
        const term = cleanDefinition(match[1]);
        definitions.push({
          acronym: match[2],
          term,
          normalizedTerm: normalizeTerm(term),
          nodeId: node.nodeId,
          sectionId: node.sectionId,
          start: match.index ?? 0,
          end: (match.index ?? 0) + match[0].length,
        });
      }
    }
    const findings: GrantCheckerFindingCandidate[] = [];
    const byAcronym = new Map<string, Definition[]>();
    for (const definition of definitions) {
      byAcronym.set(definition.acronym, [...(byAcronym.get(definition.acronym) ?? []), definition]);
    }
    for (const [acronym, group] of byAcronym) {
      const distinct = new Map(group.map((definition) => [definition.normalizedTerm, definition.term]));
      if (distinct.size < 2) continue;
      const anchor = group.find((definition, index) => allowedNodeIds.has(definition.nodeId)
        && group.slice(0, index).some((previous) => previous.normalizedTerm !== definition.normalizedTerm))
        ?? group.find((definition) => allowedNodeIds.has(definition.nodeId));
      if (!anchor) continue;
      findings.push({
        code: "acronym_definition_inconsistent",
        message: `缩写“${acronym}”在全文中对应了不同术语：${[...distinct.values()].map((term) => `“${term}”`).join("、")}。`,
        recommendation: "核对这些术语是否确实指向同一概念；如果是同一概念，请统一首次定义和后续称谓，如果不是，请改用不同缩写。",
        assessment: { scope: "term_or_citation", confidence: 0.99, actionability: "requires_expert_judgment" },
        subjectKey: `acronym:${acronym}:definition_consistency`,
        conclusion: "inconsistent",
        sectionId: anchor.sectionId,
        nodeId: anchor.nodeId,
        startOffset: anchor.start,
        endOffset: anchor.end,
      });
    }
    return { findings, metadata: { definitionCount: definitions.length, checkedAcronymCount: byAcronym.size } };
  }
}
