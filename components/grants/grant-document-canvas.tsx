"use client";

import type { CanonicalGrantSnapshot } from "@/lib/grants/domain/contracts";
import { grantSectionBreadcrumbs, projectGrantSectionSubtree } from "@/lib/grants/presentation/document-tree";

type Props = {
  snapshot: CanonicalGrantSnapshot;
  selectedSectionId: string | null;
  selectedFindingId: string | null;
  findingsByNode: Map<string, string[]>;
  onSectionTitleChange: (sectionId: string, title: string) => void;
  onNodeContentChange: (nodeId: string, value: string) => void;
  onNodeFindingSelect: (nodeId: string) => void;
  onAddParagraph: () => void;
  onRemoveNode: (nodeId: string) => void;
};

function nodeText(node: CanonicalGrantSnapshot["nodes"][number]): string {
  if (node.nodeType === "paragraph" || node.nodeType === "heading") return node.content.text;
  if (node.nodeType === "list") return node.content.items.join("\n");
  if (node.nodeType === "table") return node.content.rows.map((row) => row.join("\t")).join("\n");
  if (node.nodeType === "formula") return node.content.latex;
  if (node.nodeType === "figure") return node.content.altText;
  return node.content.referenceId;
}

export function GrantDocumentCanvas(props: Props) {
  const sections = projectGrantSectionSubtree(props.snapshot, props.selectedSectionId);
  const breadcrumbs = grantSectionBreadcrumbs(props.snapshot, props.selectedSectionId);
  const nodesById = new Map(props.snapshot.nodes.map((node) => [node.nodeId, node]));

  const renderNode = (node: CanonicalGrantSnapshot["nodes"][number]) => {
    const findingIds = props.findingsByNode.get(node.nodeId) ?? [];
    const selectedNode = findingIds.includes(props.selectedFindingId ?? "");
    return (
      <div
        id={`grant-node-${node.nodeId}`}
        key={node.nodeId}
        data-grant-node-id={node.nodeId}
        className={`group relative rounded-xl border p-2 transition ${selectedNode ? "border-[#155eef] bg-blue-50/40 ring-2 ring-blue-100" : "border-transparent hover:border-slate-200"}`}
      >
        {findingIds.length > 0 && (
          <button
            type="button"
            aria-label={`查看此处的 ${findingIds.length} 个问题`}
            onClick={() => props.onNodeFindingSelect(node.nodeId)}
            className="absolute -right-3 top-3 z-10 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 shadow-sm"
          >
            {findingIds.length}
          </button>
        )}
        {node.nodeType === "paragraph" && <textarea aria-label="正文段落" className="research-focus min-h-28 w-full resize-y rounded-lg border border-slate-200 px-4 py-3 leading-7" value={nodeText(node)} onChange={(event) => props.onNodeContentChange(node.nodeId, event.target.value)} />}
        {node.nodeType === "heading" && <input aria-label="正文标题" className="research-focus w-full rounded-lg border border-slate-200 px-4 py-3 font-semibold" value={nodeText(node)} onChange={(event) => props.onNodeContentChange(node.nodeId, event.target.value)} />}
        {node.nodeType === "list" && <textarea aria-label="列表内容" className="research-focus min-h-28 w-full rounded-lg border border-slate-200 px-4 py-3" value={nodeText(node)} onChange={(event) => props.onNodeContentChange(node.nodeId, event.target.value)} />}
        {node.nodeType === "table" && <textarea aria-label="表格内容" className="research-focus min-h-32 w-full rounded-lg border border-slate-200 px-4 py-3 font-mono text-sm" value={nodeText(node)} onChange={(event) => props.onNodeContentChange(node.nodeId, event.target.value)} />}
        {node.nodeType === "formula" && <input aria-label="公式" className="research-focus w-full rounded-lg border border-slate-200 px-4 py-3 font-mono" value={nodeText(node)} onChange={(event) => props.onNodeContentChange(node.nodeId, event.target.value)} />}
        {node.nodeType === "figure" && <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">图片资产：{node.content.altText}</div>}
        {node.nodeType === "citation" && <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">引用：{node.content.referenceId}</div>}
        <button type="button" className="absolute -left-2 -top-2 hidden rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-red-700 shadow-sm group-hover:block" onClick={() => props.onRemoveNode(node.nodeId)}>删除</button>
      </div>
    );
  };

  return (
    <section aria-label="申请书正文" className="bg-slate-100/70 p-5 sm:p-8">
      <div className="mx-auto min-h-[900px] max-w-3xl rounded-sm border border-slate-200 bg-white px-6 py-10 shadow-sm sm:px-14 sm:py-16">
        {sections.length > 0 && (
          <>
            <nav aria-label="当前位置" className="mb-8 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>申请书正文</span>
              {breadcrumbs.map((section) => <span key={section.sectionId}>› {section.title}</span>)}
            </nav>
            <div className="space-y-10">
              {sections.map(({ section, depth }) => {
                const nodes = section.nodeIds.map((nodeId) => nodesById.get(nodeId)).filter(Boolean) as CanonicalGrantSnapshot["nodes"];
                return (
                  <article key={section.sectionId} className="space-y-5">
                    <input
                      aria-label="章节标题"
                      className={`research-focus w-full rounded-lg border border-transparent px-2 py-2 font-semibold text-slate-900 hover:border-slate-200 ${depth === 0 ? "text-2xl" : depth === 1 ? "text-xl" : "text-lg"}`}
                      value={section.title}
                      onChange={(event) => props.onSectionTitleChange(section.sectionId, event.target.value)}
                    />
                    {nodes.map(renderNode)}
                  </article>
                );
              })}
              <button type="button" className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-600 hover:border-[#245d82] hover:text-[#245d82]" onClick={props.onAddParagraph}>＋ 添加正文段落</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
