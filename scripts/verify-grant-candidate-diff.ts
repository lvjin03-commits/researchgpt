import assert from "node:assert/strict";
import { computeGrantCandidateDiff, GRANT_CANDIDATE_DIFF_VERSION } from "../lib/grants/edit-session/candidate-diff.ts";

const wording = computeGrantCandidateDiff({
  oldText: "本项目拟研究锌负极界面稳定机制。",
  newText: "本项目聚焦锌负极界面的动态演化机制。",
});
assert.equal(wording.contractVersion, GRANT_CANDIDATE_DIFF_VERSION);
assert.equal(wording.coordinateSystem, "utf16_code_unit");
assert.equal(wording.counts.replacements, 1);
assert.deepEqual(wording.changes.map((change) => change.kind), ["replace"]);
const wordingSpans = wording.changes[0].kind === "replace" ? wording.changes[0].spans : [];
assert.ok(wordingSpans.some((span) => span.kind === "equal" && span.text.includes("本项目")));
assert.ok(wordingSpans.some((span) => span.kind === "delete"));
assert.ok(wordingSpans.some((span) => span.kind === "insert"));

const moved = computeGrantCandidateDiff({
  oldText: "第一段说明研究背景。\n\n第二段提出科学问题。\n\n第三段给出研究方案。",
  newText: "第一段说明研究背景。\n\n第三段给出研究方案。\n\n第二段提出科学问题。",
});
assert.equal(moved.counts.moves, 1, "a unique reordered Chinese paragraph must be a move");
assert.equal(moved.counts.insertions, 0);
assert.equal(moved.counts.deletions, 0);

const expanded = computeGrantCandidateDiff({
  oldText: "研究内容包括界面调控。",
  newText: "研究内容包括界面调控。\n\n进一步分析离子传输路径。",
});
assert.equal(expanded.counts.insertions, 1);

const split = computeGrantCandidateDiff({
  oldText: "研究内容包括界面调控，并进一步分析离子传输路径。",
  newText: "研究内容包括界面调控。\n\n进一步分析离子传输路径。",
});
assert.deepEqual(split.counts, { replacements: 1, insertions: 1, deletions: 0, moves: 0 });

const merged = computeGrantCandidateDiff({
  oldText: "研究内容包括界面调控。\n\n进一步分析离子传输路径。",
  newText: "研究内容包括界面调控，并进一步分析离子传输路径。",
});
assert.deepEqual(merged.counts, { replacements: 1, insertions: 0, deletions: 1, moves: 0 });

const newlineInvariant = computeGrantCandidateDiff({ oldText: "甲。\r\n\r\n乙。", newText: "甲。\n\n乙。" });
assert.deepEqual(newlineInvariant.counts, { replacements: 0, insertions: 0, deletions: 0, moves: 0 });

const repeated = computeGrantCandidateDiff({ oldText: "重复段。\n\n重复段。", newText: "重复段。" });
assert.equal(repeated.counts.moves, 0, "duplicate text must not be assigned an invented move identity");
assert.equal(repeated.counts.deletions, 1);

const emoji = computeGrantCandidateDiff({ oldText: "方案A😀。", newText: "方案B😀。" });
const emojiReplacement = emoji.changes[0];
assert.equal(emojiReplacement.kind, "replace");
if (emojiReplacement.kind === "replace") {
  assert.equal("方案A😀。".slice(emojiReplacement.oldRange.startOffset, emojiReplacement.oldRange.endOffset), emojiReplacement.oldText);
  assert.equal(emojiReplacement.oldRange.endOffset, "方案A😀。".length);
}

const deterministic = computeGrantCandidateDiff({ oldText: "原文。", newText: "新文。" });
assert.equal(deterministic.diffHash, computeGrantCandidateDiff({ oldText: "原文。", newText: "新文。" }).diffHash);
assert.notEqual(deterministic.diffHash, computeGrantCandidateDiff({ oldText: "原文。", newText: "另一版。" }).diffHash);

console.log("Grant candidate Chinese Diff verification passed.");
