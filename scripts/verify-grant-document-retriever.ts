import assert from "node:assert/strict";
import { buildGrantDocumentSearchBlocks, retrieveGrantDocumentBlocks } from "../lib/grants/application/grant-document-retriever.ts";

const snapshot = {
  schemaVersion: "grant-canonical-v1" as const,
  title: "锌离子电池界面稳定性研究",
  sections: [
    { sectionId: "00000000-0000-4000-8000-000000000001", semanticRole: "background", title: "研究意义", order: 0, nodeIds: ["00000000-0000-4000-8000-000000000011"] },
    { sectionId: "00000000-0000-4000-8000-000000000002", semanticRole: "method", title: "研究方案", order: 1, nodeIds: ["00000000-0000-4000-8000-000000000012"] },
  ],
  nodes: [
    { nodeId: "00000000-0000-4000-8000-000000000011", sectionId: "00000000-0000-4000-8000-000000000001", order: 0, nodeType: "paragraph" as const, content: { text: "本研究聚焦锌负极界面稳定性与枝晶抑制机制。" } },
    { nodeId: "00000000-0000-4000-8000-000000000012", sectionId: "00000000-0000-4000-8000-000000000002", order: 0, nodeType: "paragraph" as const, content: { text: "拟采用原位表征和电化学测试验证研究方案。" } },
  ],
};

const revisionId = "00000000-0000-4000-8000-000000000099";
const blocks = buildGrantDocumentSearchBlocks(snapshot, revisionId);
assert.equal(blocks.length, 2);
assert.equal(blocks[0]?.sourceRevisionId, revisionId);
assert.equal(retrieveGrantDocumentBlocks({ snapshot, sourceRevisionId: revisionId, query: "枝晶抑制" })[0]?.sectionId, snapshot.sections[0].sectionId);
assert.equal(retrieveGrantDocumentBlocks({ snapshot, sourceRevisionId: revisionId, query: "原位表征" })[0]?.nodeId, snapshot.nodes[1].nodeId);
assert.deepEqual(retrieveGrantDocumentBlocks({ snapshot, sourceRevisionId: revisionId, query: "完全不存在的内容" }), []);
console.log("Grant document retriever checks passed.");
