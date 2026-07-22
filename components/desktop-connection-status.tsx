"use client";

import { MonitorUp, PlugZap, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DESKTOP_CONNECTOR_INSTALL_URL,
  inspectDesktopConnector,
  launchDesktopConnect,
  type DesktopConnectionState,
  type DesktopStatus,
} from "@/lib/desktop/connection";

const AUTO_CONNECT_KEY = "researchgpt-local-connector-auto-connect";
const CHECK_INTERVAL_MS = 15_000;
const CONNECT_RECHECK_DELAYS = [900, 2200, 4200];

type DesktopConnectionStatusProps = {
  compact?: boolean;
};

function labelForState(state: DesktopConnectionState): string {
  switch (state) {
    case "checking":
      return "检测本机连接器";
    case "connected":
      return "本机连接器已连接";
    case "permission_required":
      return "本机连接器待授权";
    case "connecting":
      return "正在连接本机连接器";
    case "not_installed":
      return "需要安装本机连接器";
    case "version_mismatch":
      return "本机连接器需更新";
    case "failed":
      return "连接失败";
    case "disconnected":
    default:
      return "启用本机连接器";
  }
}

function capabilityText(status: DesktopStatus | null): string {
  if (!status?.capabilities?.length) return "可接管本地文件任务";
  const labels: Record<string, string> = {
    local_files: "本地文件",
    open_file: "打开文件",
    read_file_text: "读取文件",
    open_pdf: "打开 PDF",
    read_pdf: "读取 PDF",
    local_export: "本地导出",
    office: "Office/WPS",
  };

  return status.capabilities
    .slice(0, 3)
    .map((capability) => labels[capability] ?? capability)
    .join(" / ");
}

function detailForState(
  state: DesktopConnectionState,
  status: DesktopStatus | null,
): string {
  if (state === "connected") {
    return `设备：${status?.deviceName || status?.app || "本机"}`;
  }
  if (state === "permission_required") {
    return "已检测到本机连接器。授权后，网页才能读取你主动选择的本地文件夹。";
  }
  if (state === "not_installed") {
    return "未检测到本机连接器。安装后，网页可安全读取你授权的本地文献文件夹。";
  }
  if (state === "version_mismatch") {
    return "当前本机连接器版本过旧，请更新后继续使用本地文件能力。";
  }
  return "需要本地文件时，网页会尝试唤起本机连接器并在后台完成连接。";
}

export function DesktopConnectionStatus({
  compact = false,
}: DesktopConnectionStatusProps) {
  const [state, setState] = useState<DesktopConnectionState>("checking");
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [autoConnect, setAutoConnect] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const attemptedAutoConnectRef = useRef(false);

  const checkStatus = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 900);

    try {
      const result = await inspectDesktopConnector(controller.signal);
      setLastCheckedAt(new Date());
      setStatus(result.status);
      setState(result.state);
      return result.state;
    } catch {
      setLastCheckedAt(new Date());
      setStatus(null);
      setState((current) =>
        current === "connecting" ? "connecting" : "disconnected",
      );
      return "disconnected" as DesktopConnectionState;
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const connectConnector = useCallback(() => {
    setState("connecting");
    launchDesktopConnect();

    for (const delay of CONNECT_RECHECK_DELAYS) {
      window.setTimeout(() => {
        void checkStatus().then((nextState) => {
          if (
            nextState !== "connected" &&
            nextState !== "permission_required" &&
            delay === CONNECT_RECHECK_DELAYS.at(-1)
          ) {
            setState("not_installed");
          }
        });
      }, delay);
    }
  }, [checkStatus]);

  useEffect(() => {
    const savedAutoConnect =
      window.localStorage.getItem(AUTO_CONNECT_KEY) === "true";
    setAutoConnect(savedAutoConnect);

    void checkStatus().then((nextState) => {
      if (
        nextState !== "connected" &&
        savedAutoConnect &&
        !attemptedAutoConnectRef.current
      ) {
        attemptedAutoConnectRef.current = true;
        connectConnector();
      }
    });

    const interval = window.setInterval(() => {
      void checkStatus();
    }, CHECK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [checkStatus, connectConnector]);

  const connected = state === "connected";
  const needsAuth = state === "permission_required";
  const busy = state === "checking" || state === "connecting";

  return (
    <div
      className={`group relative flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm transition ${
        connected
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : needsAuth
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : state === "not_installed" || state === "version_mismatch"
              ? "border-blue-200 bg-blue-50 text-blue-900"
              : "border-[#d4dfe2] bg-white text-[#42545c]"
      }`}
    >
      <MonitorUp
        className={`h-4 w-4 shrink-0 ${
          connected ? "text-emerald-700" : "text-[#607078]"
        }`}
      />
      <button
        type="button"
        onClick={connected ? () => void checkStatus() : connectConnector}
        className="min-w-0 text-left"
      >
        <span className="block truncate font-bold">{labelForState(state)}</span>
        {!compact && (
          <span className="block truncate text-[11px] font-medium opacity-80">
            {connected ? capabilityText(status) : detailForState(state, status)}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => void checkStatus()}
        disabled={busy}
        className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-current opacity-70 hover:bg-black/5 hover:opacity-100 disabled:opacity-40"
        aria-label="刷新本机连接器状态"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      </button>

      {!connected && (
        <button
          type="button"
          onClick={connectConnector}
          className="hidden h-6 shrink-0 items-center gap-1 rounded bg-[#174866] px-2 text-[11px] font-bold text-white hover:bg-[#123a52] sm:inline-flex"
        >
          {needsAuth ? (
            <ShieldCheck className="h-3 w-3" />
          ) : (
            <PlugZap className="h-3 w-3" />
          )}
          {needsAuth ? "授权" : "启用"}
        </button>
      )}

      <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-72 rounded-md border border-gray-200 bg-white p-3 text-left text-xs text-gray-600 shadow-xl group-hover:block">
        <p className="font-bold text-gray-950">{labelForState(state)}</p>
        <p className="mt-1 leading-5">{detailForState(state, status)}</p>
        <label className="pointer-events-auto mt-3 flex items-center gap-2 border-t border-gray-100 pt-2 text-[11px] font-semibold text-gray-700">
          <input
            type="checkbox"
            checked={autoConnect}
            onChange={(event) => {
              const enabled = event.target.checked;
              setAutoConnect(enabled);
              window.localStorage.setItem(AUTO_CONNECT_KEY, String(enabled));
            }}
          />
          打开网页时自动启用本机连接器
        </label>
        {(state === "not_installed" || state === "version_mismatch") && (
          <a
            href={DESKTOP_CONNECTOR_INSTALL_URL}
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto mt-3 inline-flex h-8 items-center justify-center rounded-md bg-[#174866] px-3 text-[11px] font-bold text-white hover:bg-[#123a52]"
          >
            下载安装本机连接器
          </a>
        )}
        {lastCheckedAt && (
          <p className="mt-2 text-[11px] text-gray-400">
            最近检测：{lastCheckedAt.toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}
