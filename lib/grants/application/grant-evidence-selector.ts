import type { GrantEvidenceCard, GrantEvidenceResource } from "../evidence/contracts.ts";

const MAX_EVIDENCE_CARDS = 8;
const MAX_EVIDENCE_CHARACTERS = 18_000;

function searchUnits(text: string): Set<string> {
  const normalized = text.toLocaleLowerCase().replace(/\s+/gu, " ");
  const units = new Set(normalized.match(/[a-z0-9][a-z0-9_-]{2,}|[\u3400-\u9fff]{2}/gu) ?? []);
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    if (/[\u3400-\u9fff]{2}/u.test(pair)) units.add(pair);
  }
  return units;
}

function relevance(card: GrantEvidenceCard, query: Set<string>): number {
  let score = 0;
  const units = searchUnits(card.excerpt);
  for (const unit of query) if (units.has(unit)) score += unit.length > 2 ? 2 : 1;
  return score;
}

export function selectGrantEvidenceCards(resources: GrantEvidenceResource[], queryText: string) {
  const query = searchUnits(queryText);
  const candidates = resources.flatMap((resource) => resource.cards
    .filter((card) => card.status === "active")
    .map((card) => ({ resource, card, score: relevance(card, query) })));
  candidates.sort((left, right) => right.score - left.score
    || left.resource.source.createdAt.localeCompare(right.resource.source.createdAt)
    || left.card.order - right.card.order);

  const selected: typeof candidates = [];
  let characters = 0;
  for (const candidate of candidates) {
    if (selected.length >= MAX_EVIDENCE_CARDS) break;
    if (selected.length > 0 && characters + candidate.card.excerpt.length > MAX_EVIDENCE_CHARACTERS) continue;
    selected.push(candidate);
    characters += candidate.card.excerpt.length;
  }
  return selected;
}
