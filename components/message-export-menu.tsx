"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExportIcon } from "@/components/icons";
import { exportContent, ExportError } from "@/lib/export/client";
import type { ExportFormat } from "@/lib/export/types";

type MessageExportMenuProps = {
  content: string;
  chatTitle: string;
};

const EXPORT_OPTIONS: { format: ExportFormat; label: string }[] = [
  { format: "docx", label: "生成 Word 文档" },
  { format: "pptx", label: "生成 PowerPoint" },
  { format: "xlsx", label: "生成 Excel 工作簿" },
  { format: "pdf", label: "生成 PDF 报告" },
  { format: "png", label: "生成 PNG 成果图" },
  { format: "svg", label: "生成可编辑 SVG" },
  { format: "md", label: "生成 Markdown" },
  { format: "txt", label: "生成纯文本" },
  { format: "json", label: "生成 JSON" },
];

export function MessageExportMenu({
  content,
  chatTitle,
}: MessageExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setExportingFormat(format);
      setError(null);

      try {
        await exportContent({
          format,
          title: chatTitle,
          content,
          metadata: {
            source: "assistant-message",
          },
        });

        setOpen(false);
      } catch (err) {
        const message =
          err instanceof ExportError
            ? err.message
            : "导出消息失败，请重试。";
        setError(message);
      } finally {
        setExportingFormat(null);
      }
    },
    [chatTitle, content],
  );

  return (
    <div ref={menuRef} className="relative mt-1.5 flex flex-col items-start">
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
        }}
        aria-label="生成成果文件"
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-gray-600 transition-colors hover:bg-white hover:text-gray-950"
      >
        <ExportIcon className="h-3.5 w-3.5" />
        生成文件
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 max-h-[360px] min-w-[220px] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {EXPORT_OPTIONS.map((option) => (
            <button
              key={option.format}
              type="button"
              role="menuitem"
              disabled={exportingFormat !== null}
              onClick={() => {
                void handleExport(option.format);
              }}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportingFormat === option.format ? "正在导出…" : option.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
