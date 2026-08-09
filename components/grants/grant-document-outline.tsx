"use client";

import type { CanonicalGrantSnapshot, GrantLengthEstimate, GrantRevisionSummary } from "@/lib/grants/domain/contracts";

type Props = {
  snapshot: CanonicalGrantSnapshot;
  estimate: GrantLengthEstimate | null;
  selectedSectionId: string | null;
  findingsBySection: Map<string, number>;
  revisionHistory: GrantRevisionSummary[];
  currentRevisionId: string;
  onSelectSection: (sectionId: string) => void;
  onRestore: (revisionId: string) => Promise<void>;
};

export function GrantDocumentOutline(props: Props) {
  return (
    <aside aria-label="文档结构" className="border-r border-slate-200 bg-white p-4">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="research-eyebrow">文档结构</p>
          <span className="text-xs text-slate-400">约 {props.estimate?.estimatedPages ?? 0} 页</span>
        </div>
        <nav className="mt-3 space-y-1">
          {[...props.snapshot.sections].sort((a, b) => a.order - b.order).map((section, index) => {
            const count = props.findingsBySection.get(section.sectionId) ?? 0;
            return (
              <button
                key={section.sectionId}
                type="button"
                onClick={() => props.onSelectSection(section.sectionId)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${props.selectedSectionId === section.sectionId ? "bg-blue-50 font-semibold text-[#174866]" : "text-slate-700 hover:bg-slate-50"}`}
              >
                <span className="w-5 text-xs text-slate-400">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{section.title}</span>
                {count > 0 && <span aria-label={`${count} 个问题`} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{count}</span>}
              </button>
            );
          })}
        </nav>

        <details className="mt-6 rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">版本记录</summary>
          <div className="mt-3 space-y-2">
            {props.revisionHistory.map((revision) => (
              <div key={revision.revisionId} className="rounded-lg bg-slate-50 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <strong>版本 {revision.revisionNumber}</strong>
                  <span className="text-slate-400">{new Date(revision.createdAt).toLocaleDateString("zh-CN")}</span>
                </div>
                {revision.revisionId !== props.currentRevisionId && (
                  <button type="button" className="mt-2 font-medium text-[#245d82]" onClick={() => void props.onRestore(revision.revisionId)}>恢复为新版本</button>
                )}
              </div>
            ))}
          </div>
        </details>
      </div>
    </aside>
  );
}
