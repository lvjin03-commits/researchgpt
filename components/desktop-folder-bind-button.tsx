"use client";

import { FolderPlus, LoaderCircle } from "lucide-react";
import { useCallback, useState } from "react";
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

  const bindFolder = useCallback(async () => {
    if (disabled || isBinding) return;
    setIsBinding(true);
    setMessage(null);

    try {
      const result = await selectDesktopLocalFolder();
      if (result.canceled) {
        setMessage("已取消选择");
        return;
      }
      onBound(result.folder);
      setMessage(`已绑定 ${result.folder.pdfCount} 个 PDF`);
    } catch (error) {
      launchDesktopConnect();
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
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-xl">
          {message}
        </div>
      )}
    </div>
  );
}
