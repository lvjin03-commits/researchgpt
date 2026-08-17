"use client";

import type { GrantAssistantDocumentSelectionContext } from "@/lib/grants/assistant/contracts";

export function GrantAssistantContextCards({ items, onRemove }: {
  items: GrantAssistantDocumentSelectionContext[];
  onRemove: (contextCardId: string) => void;
}) {
  if (items.length === 0) return null;
  return <section aria-label="已引用的正文" className="mb-3 shrink-0 space-y-2">
    <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-700">本轮引用</p><span className="text-xs text-slate-400">{items.length} 项</span></div>
    <div className="max-h-44 space-y-2 overflow-y-auto overscroll-contain">
      {items.map((item) => <article key={item.contextCardId} className="rounded-xl border border-blue-200 bg-blue-50/60 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><p className="truncate text-xs font-semibold text-blue-900">引用正文 · {item.targetLabel}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-600">“{item.text}”</p></div>
          <button type="button" aria-label={`移除引用 ${item.targetLabel}`} onClick={() => onRemove(item.contextCardId)} className="shrink-0 rounded-md px-1.5 py-0.5 text-sm text-slate-400 hover:bg-white hover:text-slate-700">×</button>
        </div>
      </article>)}
    </div>
  </section>;
}
