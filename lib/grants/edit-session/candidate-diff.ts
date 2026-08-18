import { z } from "zod";
import { sha256Canonical } from "../domain/canonical-json.ts";

export const GRANT_CANDIDATE_DIFF_VERSION = "grant-candidate-diff-v1" as const;

const TextRangeSchema = z.object({
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
}).strict().refine((range) => range.endOffset >= range.startOffset, {
  message: "A Diff range must not end before it starts.",
});

export const GrantCandidateDiffSpanSchema = z.object({
  kind: z.enum(["equal", "delete", "insert"]),
  text: z.string(),
}).strict();

export const GrantCandidateDiffChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("replace"),
    oldRange: TextRangeSchema,
    newRange: TextRangeSchema,
    oldText: z.string(),
    newText: z.string(),
    spans: z.array(GrantCandidateDiffSpanSchema),
  }).strict(),
  z.object({
    kind: z.literal("delete"),
    oldRange: TextRangeSchema,
    oldText: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("insert"),
    newRange: TextRangeSchema,
    newText: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("move"),
    oldRange: TextRangeSchema,
    newRange: TextRangeSchema,
    text: z.string(),
  }).strict(),
]);

export const GrantCandidateDiffSchema = z.object({
  contractVersion: z.literal(GRANT_CANDIDATE_DIFF_VERSION),
  coordinateSystem: z.literal("utf16_code_unit"),
  oldTextHash: z.string().regex(/^[a-f0-9]{64}$/),
  newTextHash: z.string().regex(/^[a-f0-9]{64}$/),
  diffHash: z.string().regex(/^[a-f0-9]{64}$/),
  counts: z.object({
    replacements: z.number().int().min(0),
    insertions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    moves: z.number().int().min(0),
  }).strict(),
  changes: z.array(GrantCandidateDiffChangeSchema),
}).strict();

export type GrantCandidateDiff = z.infer<typeof GrantCandidateDiffSchema>;
export type GrantCandidateDiffChange = z.infer<typeof GrantCandidateDiffChangeSchema>;

type Unit = { text: string; startOffset: number; endOffset: number };
type Span = z.infer<typeof GrantCandidateDiffSpanSchema>;

function normalizeText(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

function paragraphUnits(text: string): Unit[] {
  if (!text) return [];
  const units: Unit[] = [];
  const matcher = /[^\n]+/g;
  for (const match of text.matchAll(matcher)) {
    const startOffset = match.index;
    units.push({ text: match[0], startOffset, endOffset: startOffset + match[0].length });
  }
  return units;
}

function inlineTokens(text: string): string[] {
  return text.match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:[.·-][\p{L}\p{N}]+)*|\s+|[^\s\p{L}\p{N}]/gu) ?? [];
}

function lcsPairs<T>(left: T[], right: T[], key: (value: T) => string): Array<[number, number]> {
  const rows = left.length + 1;
  const columns = right.length + 1;
  if (rows * columns > 4_000_000) throw new Error("candidate_diff_budget_exceeded");
  const table = Array.from({ length: rows }, () => new Uint32Array(columns));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = key(left[i]) === key(right[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < left.length && j < right.length;) {
    if (key(left[i]) === key(right[j])) { pairs.push([i, j]); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

function pushSpan(spans: Span[], kind: Span["kind"], text: string) {
  if (!text) return;
  const previous = spans.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else spans.push({ kind, text });
}

function inlineDiff(oldText: string, newText: string): Span[] {
  const oldTokens = inlineTokens(oldText);
  const newTokens = inlineTokens(newText);
  const pairs = lcsPairs(oldTokens, newTokens, (value) => value);
  const spans: Span[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (const [matchedOld, matchedNew] of [...pairs, [oldTokens.length, newTokens.length] as [number, number]]) {
    pushSpan(spans, "delete", oldTokens.slice(oldIndex, matchedOld).join(""));
    pushSpan(spans, "insert", newTokens.slice(newIndex, matchedNew).join(""));
    if (matchedOld < oldTokens.length) pushSpan(spans, "equal", oldTokens[matchedOld]);
    oldIndex = matchedOld + 1;
    newIndex = matchedNew + 1;
  }
  return spans;
}

function unmatchedIndexes(length: number, matched: Set<number>) {
  return Array.from({ length }, (_, index) => index).filter((index) => !matched.has(index));
}

export function computeGrantCandidateDiff(input: { oldText: string; newText: string }): GrantCandidateDiff {
  const oldText = normalizeText(input.oldText);
  const newText = normalizeText(input.newText);
  const oldUnits = paragraphUnits(oldText);
  const newUnits = paragraphUnits(newText);
  const stablePairs = lcsPairs(oldUnits, newUnits, (unit) => unit.text);
  const matchedOld = new Set(stablePairs.map(([index]) => index));
  const matchedNew = new Set(stablePairs.map(([, index]) => index));
  const oldRemaining = unmatchedIndexes(oldUnits.length, matchedOld);
  const newRemaining = unmatchedIndexes(newUnits.length, matchedNew);
  const changes: GrantCandidateDiffChange[] = [];

  // Exact, unique unmatched paragraphs are moves. Ambiguous duplicates remain
  // inserts/deletes so the program never invents a move identity.
  for (const oldIndex of [...oldRemaining]) {
    const candidates = newRemaining.filter((newIndex) => newUnits[newIndex].text === oldUnits[oldIndex].text);
    const reverseCount = oldRemaining.filter((index) => oldUnits[index].text === oldUnits[oldIndex].text).length;
    if (candidates.length !== 1 || reverseCount !== 1) continue;
    const newIndex = candidates[0];
    matchedOld.add(oldIndex);
    matchedNew.add(newIndex);
    changes.push({
      kind: "move",
      oldRange: { startOffset: oldUnits[oldIndex].startOffset, endOffset: oldUnits[oldIndex].endOffset },
      newRange: { startOffset: newUnits[newIndex].startOffset, endOffset: newUnits[newIndex].endOffset },
      text: oldUnits[oldIndex].text,
    });
  }

  const deletions = unmatchedIndexes(oldUnits.length, matchedOld);
  const insertions = unmatchedIndexes(newUnits.length, matchedNew);
  const pairedCount = Math.min(deletions.length, insertions.length);
  for (let index = 0; index < pairedCount; index += 1) {
    const oldUnit = oldUnits[deletions[index]];
    const newUnit = newUnits[insertions[index]];
    changes.push({
      kind: "replace",
      oldRange: { startOffset: oldUnit.startOffset, endOffset: oldUnit.endOffset },
      newRange: { startOffset: newUnit.startOffset, endOffset: newUnit.endOffset },
      oldText: oldUnit.text,
      newText: newUnit.text,
      spans: inlineDiff(oldUnit.text, newUnit.text),
    });
  }
  for (const oldIndex of deletions.slice(pairedCount)) {
    const unit = oldUnits[oldIndex];
    changes.push({ kind: "delete", oldRange: { startOffset: unit.startOffset, endOffset: unit.endOffset }, oldText: unit.text });
  }
  for (const newIndex of insertions.slice(pairedCount)) {
    const unit = newUnits[newIndex];
    changes.push({ kind: "insert", newRange: { startOffset: unit.startOffset, endOffset: unit.endOffset }, newText: unit.text });
  }

  changes.sort((left, right) => {
    const leftOffset = "newRange" in left ? left.newRange.startOffset : left.oldRange.startOffset;
    const rightOffset = "newRange" in right ? right.newRange.startOffset : right.oldRange.startOffset;
    return leftOffset - rightOffset;
  });
  const counts = {
    replacements: changes.filter((change) => change.kind === "replace").length,
    insertions: changes.filter((change) => change.kind === "insert").length,
    deletions: changes.filter((change) => change.kind === "delete").length,
    moves: changes.filter((change) => change.kind === "move").length,
  };
  const payload = {
    contractVersion: GRANT_CANDIDATE_DIFF_VERSION,
    coordinateSystem: "utf16_code_unit" as const,
    oldTextHash: sha256Canonical(oldText),
    newTextHash: sha256Canonical(newText),
    counts,
    changes,
  };
  return GrantCandidateDiffSchema.parse({ ...payload, diffHash: sha256Canonical(payload) });
}
