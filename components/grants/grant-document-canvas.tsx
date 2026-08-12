"use client";

import { useEffect, useState } from "react";
import type { GrantFigureDisplayAsset } from "@/lib/grants/application/figure-display-service";
import type { CanonicalGrantSnapshot } from "@/lib/grants/domain/contracts";
import { grantSectionBreadcrumbs, projectGrantSectionSubtree } from "@/lib/grants/presentation/document-tree";
import { GrantWordToolbar } from "./grant-word-toolbar";

type Props = {
  snapshot: CanonicalGrantSnapshot;
  figureAssets: GrantFigureDisplayAsset[];
  selectedSectionId: string | null;
  selectedFindingId: string | null;
  findingsByNode: Map<string, string[]>;
  onSectionTitleChange: (sectionId: string, title: string) => void;
  onNodeContentChange: (nodeId: string, value: string) => void;
  onNodeFindingSelect: (nodeId: string) => void;
  onNodeAiEdit: (nodeId: string) => void;
  onAddParagraph: () => void;
  onRemoveNode: (nodeId: string) => void;
};

function GrantImportedFigure({
  node,
  asset,
}: {
  node: Extract<CanonicalGrantSnapshot["nodes"][number], { nodeType: "figure" }>;
  asset: GrantFigureDisplayAsset | undefined;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const readUrl = asset?.status === "ready" ? asset.readUrl : null;
  useEffect(() => setLoadFailed(false), [asset?.assetId, asset?.status, readUrl]);

  const caption = node.content.caption?.trim() || node.content.altText;
  const ready = asset?.status === "ready" && !loadFailed;
  return (
    <figure className="my-5 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-center text-sm text-slate-600">
      {ready ? (
        <img
          src={asset.readUrl}
          alt={node.content.altText}
          width={asset.widthPx ?? undefined}
          height={asset.heightPx ?? undefined}
          loading="lazy"
          decoding="async"
          onError={() => setLoadFailed(true)}
          className="mx-auto max-h-[720px] max-w-full rounded-md bg-white object-contain shadow-sm"
        />
      ) : (
        <div className="mx-auto flex min-h-40 max-w-xl items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 text-slate-500">
          {asset?.status === "unsupported_format"
            ? `当前浏览器暂不支持预览 ${asset.mediaType} 图片，原始资产仍已安全保存。`
            : loadFailed
              ? "图片读取地址已失效或加载失败，请刷新页面后重试。"
              : "图片资产暂时无法读取，正文位置和图注已保留。"}
        </div>
      )}
      <figcaption className="mx-auto mt-3 max-w-2xl leading-6 text-slate-700">{caption}</figcaption>
    </figure>
  );
}

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
  const figureAssetsById = new Map(props.figureAssets.map((asset) => [asset.assetId, asset]));

  const updateTableCell = (
    node: Extract<CanonicalGrantSnapshot["nodes"][number], { nodeType: "table" }>,
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) => {
    const rows = node.content.rows.map((row, currentRow) => row.map((cell, currentColumn) => (
      currentRow === rowIndex && currentColumn === columnIndex ? value : cell
    )));
    props.onNodeContentChange(node.nodeId, rows.map((row) => row.join("\t")).join("\n"));
  };

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
        {node.nodeType === "paragraph" && <textarea aria-label="正文段落" className="research-focus min-h-12 w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-2 py-1 text-[15px] leading-8 text-slate-800 [field-sizing:content] hover:bg-slate-50/70 focus:bg-blue-50/30" value={nodeText(node)} onChange={(event) => props.onNodeContentChange(node.nodeId, event.target.value)} />}
        {node.nodeType === "heading" && <input aria-label="正文标题" className="research-focus w-full rounded border border-transparent bg-transparent px-2 py-1 text-base font-semibold hover:bg-slate-50/70 focus:bg-blue-50/30" value={nodeText(node)} onChange={(event) => props.onNodeContentChange(node.nodeId, event.target.value)} />}
        {node.nodeType === "list" && <textarea aria-label="列表内容" className="research-focus min-h-20 w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-8 py-1 text-[15px] leading-8 [field-sizing:content] hover:bg-slate-50/70 focus:bg-blue-50/30" value={nodeText(node)} onChange={(event) => props.onNodeContentChange(node.nodeId, event.target.value)} />}
        {node.nodeType === "table" && (
          <div className="overflow-x-auto py-2">
            <table className="w-full border-collapse text-sm text-slate-800">
              <tbody>{node.content.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{row.map((cell, columnIndex) => (
                  <td key={columnIndex} className="border border-slate-300 p-0">
                    <input aria-label={`表格第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`} className="research-focus w-full border-0 bg-transparent px-3 py-2" value={cell} onChange={(event) => updateTableCell(node, rowIndex, columnIndex, event.target.value)} />
                  </td>
                ))}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {node.nodeType === "formula" && <input aria-label="公式" className="research-focus w-full border-0 bg-transparent px-4 py-3 text-center font-mono" value={nodeText(node)} onChange={(event) => props.onNodeContentChange(node.nodeId, event.target.value)} />}
        {node.nodeType === "figure" && (
          <GrantImportedFigure node={node} asset={figureAssetsById.get(node.content.assetId)} />
        )}
        {node.nodeType === "citation" && <div className="border-l-2 border-slate-300 px-4 py-2 text-sm text-slate-600">引用：{node.content.referenceId}</div>}
        {(node.nodeType === "paragraph" || node.nodeType === "heading" || node.nodeType === "list" || node.nodeType === "table" || node.nodeType === "formula") && (
          <button type="button" className="absolute -left-2 -top-2 hidden rounded-full border border-blue-200 bg-white px-2 py-1 text-xs font-semibold text-[#155eef] shadow-sm group-hover:block focus:block" onClick={() => props.onNodeAiEdit(node.nodeId)}>AI 修改</button>
        )}
        <button type="button" className="absolute -left-2 top-7 hidden rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-red-700 shadow-sm group-hover:block focus:block" onClick={() => props.onRemoveNode(node.nodeId)}>删除</button>
      </div>
    );
  };

  return (
    <section aria-label="申请书正文" className="min-w-0 bg-[#eef1f5]">
      <GrantWordToolbar />
      <div className="border-b border-slate-200 bg-white px-5 py-2">
        <nav aria-label="当前位置" className="mx-auto flex max-w-[794px] flex-wrap gap-2 text-xs text-slate-500">
          <span>申请书正文</span>
          {breadcrumbs.map((section) => <span key={section.sectionId}>› {section.title}</span>)}
        </nav>
      </div>
      <div className="relative mx-auto my-8 min-h-[1123px] w-[calc(100%-2rem)] max-w-[794px] border border-slate-300 bg-white px-10 py-16 shadow-[0_3px_16px_rgba(15,23,42,0.16)] sm:px-20" style={{ fontFamily: 'SimSun, "Songti SC", serif' }}>
        <div aria-hidden className="absolute bottom-10 left-5 top-10 w-4 border-r border-slate-200 text-[9px] text-slate-400">
          {Array.from({ length: 20 }, (_, index) => <span key={index} className="absolute right-0 w-2 border-t border-slate-300" style={{ top: `${index * 5}%` }} />)}
        </div>
        {sections.length > 0 && (
          <>
            <div className="space-y-10">
              {sections.map(({ section, depth }) => {
                const nodes = section.nodeIds.map((nodeId) => nodesById.get(nodeId)).filter(Boolean) as CanonicalGrantSnapshot["nodes"];
                return (
                  <article key={section.sectionId} className="space-y-5">
                    <input
                      aria-label="章节标题"
                      className={`research-focus w-full rounded border border-transparent bg-transparent px-2 py-2 font-bold text-slate-950 hover:bg-slate-50/70 focus:bg-blue-50/30 ${depth === 0 ? "text-2xl" : depth === 1 ? "text-xl" : "text-lg"}`}
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
        <footer className="absolute inset-x-0 bottom-5 text-center text-[11px] text-slate-400">连续编辑视图 · 导出时按申请书模板分页</footer>
      </div>
    </section>
  );
}
