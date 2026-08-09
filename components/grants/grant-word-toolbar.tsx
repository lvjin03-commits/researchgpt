"use client";

import type { ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ImageIcon,
  Italic,
  List,
  ListOrdered,
  MessageSquare,
  MoreHorizontal,
  Redo2,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";

const buttonClass = "flex h-8 w-8 items-center justify-center rounded text-slate-500 disabled:cursor-default disabled:opacity-70";

function ToolbarButton({ label, children }: { label: string; children: ReactNode }) {
  return <button type="button" disabled title={`${label}（格式由导出模板统一控制）`} aria-label={label} className={buttonClass}>{children}</button>;
}

export function GrantWordToolbar() {
  return (
    <div className="sticky top-16 z-20 border-b border-slate-200 bg-white shadow-sm xl:top-0">
      <div className="flex min-h-12 items-center gap-1 overflow-x-auto px-4 py-2">
        <ToolbarButton label="撤销"><Undo2 size={17} /></ToolbarButton>
        <ToolbarButton label="重做"><Redo2 size={17} /></ToolbarButton>
        <span className="mx-1 h-6 w-px bg-slate-200" />
        <div title="格式由导出模板统一控制" className="flex h-8 min-w-24 items-center justify-between rounded border border-slate-200 bg-white px-2 text-sm text-slate-700">正文<ChevronDown size={14} /></div>
        <div title="格式由导出模板统一控制" className="flex h-8 min-w-20 items-center justify-between rounded border border-slate-200 bg-white px-2 text-sm text-slate-700">宋体<ChevronDown size={14} /></div>
        <div title="格式由导出模板统一控制" className="flex h-8 min-w-16 items-center justify-between rounded border border-slate-200 bg-white px-2 text-sm text-slate-700">小四<ChevronDown size={14} /></div>
        <span className="mx-1 h-6 w-px bg-slate-200" />
        <ToolbarButton label="加粗"><Bold size={17} /></ToolbarButton>
        <ToolbarButton label="斜体"><Italic size={17} /></ToolbarButton>
        <ToolbarButton label="下划线"><Underline size={17} /></ToolbarButton>
        <span className="mx-1 h-6 w-px bg-slate-200" />
        <ToolbarButton label="左对齐"><AlignLeft size={17} /></ToolbarButton>
        <ToolbarButton label="居中"><AlignCenter size={17} /></ToolbarButton>
        <ToolbarButton label="右对齐"><AlignRight size={17} /></ToolbarButton>
        <ToolbarButton label="项目符号"><List size={17} /></ToolbarButton>
        <ToolbarButton label="编号"><ListOrdered size={17} /></ToolbarButton>
        <span className="mx-1 h-6 w-px bg-slate-200" />
        <ToolbarButton label="表格"><Table2 size={17} /></ToolbarButton>
        <ToolbarButton label="图片"><ImageIcon size={17} /></ToolbarButton>
        <ToolbarButton label="批注"><MessageSquare size={17} /></ToolbarButton>
        <ToolbarButton label="更多"><MoreHorizontal size={18} /></ToolbarButton>
        <span className="ml-auto whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">格式由导出模板控制</span>
      </div>
      <div aria-hidden className="relative h-7 border-t border-slate-100 bg-[#fbfcfe] px-10">
        <div className="absolute inset-x-10 top-0 flex h-full items-end justify-between text-[9px] text-slate-400">
          {Array.from({ length: 17 }, (_, index) => <span key={index} className="relative h-2 border-l border-slate-300"><span className="absolute -top-3 -translate-x-1/2">{index}</span></span>)}
        </div>
      </div>
    </div>
  );
}
