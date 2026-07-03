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
  { format: "docx", label: "导出为 Word" },
  { format: "pdf", label: "导出为 PDF" },
  { format: "md", label: "导出为 Markdown" },
  { format: "txt", label: "导出为纯文本" },
  { format: "json", label: "导出为 JSON" },
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
        aria-label="导出回复"
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-white hover:text-gray-700"
      >
        <ExportIcon className="h-3.5 w-3.5" />
        导出
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
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
