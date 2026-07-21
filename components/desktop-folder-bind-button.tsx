"use client";

import {
  Download,
  FolderPlus,
  LoaderCircle,
  PlugZap,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  DESKTOP_CONNECTOR_INSTALL_URL,
  inspectDesktopConnector,
  launchDesktopConnect,
  selectDesktopLocalFolder,
  waitForDesktopConnector,
  type DesktopConnectionState,
  type LocalFolderBinding,
} from "@/lib/desktop/connection";

type DesktopFolderBindButtonProps = {
  disabled?: boolean;
  onBound: (folder: LocalFolderBinding) => void;
};

type NoticeKind = "info" | "error" | "install" | "authorize";

type ConnectorNotice = {
  kind: NoticeKind;
  message: string;
  state?: DesktopConnectionState;
};

function noticeStyle(kind: NoticeKind): string {
  if (kind === "error") return "border-amber-200 bg-amber-50 text-amber-800";
  if (kind === "install") return "border-blue-200 bg-blue-50 text-blue-900";
  if (kind === "authorize")
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function connectorUnavailableNotice(state?: DesktopConnectionState): ConnectorNotice {
  if (state === "permission_required") {
    return {
      kind: "authorize",
      state,
      message:
        "本机连接器已安装，但还没有授权网页读取本地文件。启用后，AI 只会读取你主动选择的文件夹。",
    };
  }

  if (state === "version_mismatch") {
    return {
      kind: "install",
      state,
      message: "本机连接器版本过旧，请更新后再绑定本地文件夹。",
    };
  }

  return {
    kind: "install",
    state: "not_installed",
    message:
      "未检测到 ResearchGPT 本机连接器。安装后，网页才能安全读取你授权的本地文献文件夹。",
  };
}

export function DesktopFolderBindButton({
  disabled = false,
  onBound,
}: DesktopFolderBindButtonProps) {
  const [isBinding, setIsBinding] = useState(false);
  const [notice, setNotice] = useState<ConnectorNotice | null>(null);

  useEffect(() => {
    if (!notice || notice.kind === "install" || notice.kind === "authorize") {
      return;
    }
    const timeout = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const openFolderPicker = useCallback(async () => {
    const result = await selectDesktopLocalFolder();
    if (result.canceled) {
      setNotice({ kind: "info", message: "已取消选择" });
      return;
    }
    onBound(result.folder);
    setNotice({
      kind: "info",
      message: `已绑定 ${result.folder.pdfCount} 个 PDF`,
    });
  }, [onBound]);

  const connectAndContinue = useCallback(async () => {
    setNotice({
      kind: "info",
      message: "正在唤起本机连接器...",
      state: "connecting",
    });
    launchDesktopConnect();
    const next = await waitForDesktopConnector();
    if (next.state === "connected") {
      await openFolderPicker();
      return;
    }
    setNotice(connectorUnavailableNotice(next.state));
  }, [openFolderPicker]);

  const bindFolder = useCallback(async () => {
    if (disabled || isBinding) return;
    setIsBinding(true);
    setNotice(null);

    try {
      const current = await inspectDesktopConnector();
      if (current.state === "connected") {
        await openFolderPicker();
        return;
      }
      if (
        current.state === "permission_required" ||
        current.state === "version_mismatch"
      ) {
        setNotice(connectorUnavailableNotice(current.state));
        return;
      }
      await connectAndContinue();
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? `本机连接器暂时不可用：${error.message}`
            : "本机连接器暂时不可用",
      });
    } finally {
      setIsBinding(false);
    }
  }, [connectAndContinue, disabled, isBinding, openFolderPicker]);

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

      {notice && (
        <div
          className={`absolute right-0 top-full z-50 mt-2 w-80 rounded-md border p-3 text-xs font-semibold shadow-xl ${noticeStyle(
            notice.kind,
          )}`}
        >
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 leading-5">{notice.message}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-current opacity-70 hover:bg-black/5 hover:opacity-100"
              aria-label="关闭提示"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {notice.kind === "authorize" && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-emerald-200 pt-2">
              <button
                type="button"
                onClick={() => void connectAndContinue()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-700 px-3 text-[11px] font-bold text-white hover:bg-emerald-800"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                同意授权并继续
              </button>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="inline-flex h-8 items-center rounded-md border border-emerald-300 bg-white px-3 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
              >
                暂不启用
              </button>
            </div>
          )}

          {notice.kind === "install" && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-blue-200 pt-2">
              <a
                href={DESKTOP_CONNECTOR_INSTALL_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#174866] px-3 text-[11px] font-bold text-white hover:bg-[#123a52]"
              >
                <Download className="h-3.5 w-3.5" />
                安装本机连接器
              </a>
              <button
                type="button"
                onClick={() => void connectAndContinue()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-300 bg-white px-3 text-[11px] font-bold text-blue-800 hover:bg-blue-100"
              >
                <PlugZap className="h-3.5 w-3.5" />
                我已安装，重新连接
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
