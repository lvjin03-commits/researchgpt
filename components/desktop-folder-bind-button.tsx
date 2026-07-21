"use client";

import { FolderPlus, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  launchDesktopConnect,
  selectDesktopLocalFolder,
  type LocalFolderBinding,
} from "@/lib/desktop/connection";

type DesktopFolderBindButtonProps = {
  disabled?: boolean;
  onBound: (folder: LocalFolderBinding) => void;
};

export function DesktopFolderBindButton({
  disabled = false,
  onBound,
}: DesktopFolderBindButtonProps) {
  const [isBinding, setIsBinding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(
      () => setMessage(null),
      messageKind === "error" ? 6000 : 3000,
    );
    return () => window.clearTimeout(timeout);
  }, [message, messageKind]);

  const bindFolder = useCallback(async () => {
    if (disabled || isBinding) return;
    setIsBinding(true);
    setMessage(null);

    try {
      const result = await selectDesktopLocalFolder();
      if (result.canceled) {
        setMessageKind("info");
        setMessage("已取消选择");
        return;
      }
      onBound(result.folder);
      setMessageKind("info");
      setMessage(`已绑定 ${result.folder.pdfCount} 个 PDF`);
    } catch (error) {
      launchDesktopConnect();
      setMessageKind("error");
      setMessage(
        error instanceof Error
          ? `本机未连接或选择失败：${error.message}`
          : "本机未连接或选择失败",
      );
    } finally {
      setIsBinding(false);
    }
  }, [disabled, isBinding, onBound]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={bindFolder}
        disabled={disabled || isBinding}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[#cddadd] bg-white px-3 text-xs font-bold text-[#42545c] hover:border-[#8eabb8] hover:bg-[#f1f6f8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isBinding ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-[#245d82]" />
        ) : (
          <FolderPlus className="h-4 w-4 text-[#245d82]" />
        )}
        绑定本地文件夹
      </button>
      {message && (
        <div
          className={`absolute right-0 top-full z-50 mt-2 flex w-72 items-start gap-2 rounded-md border px-3 py-2 text-xs font-semibold shadow-xl ${
            messageKind === "error"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          <span className="min-w-0 flex-1 leading-5">{message}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-current opacity-70 hover:bg-black/5 hover:opacity-100"
            aria-label="关闭提示"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
