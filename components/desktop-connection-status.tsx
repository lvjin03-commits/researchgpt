"use client";

import { MonitorUp, PlugZap, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchDesktopStatus,
  launchDesktopConnect,
  type DesktopConnectionState,
  type DesktopStatus,
} from "@/lib/desktop/connection";

const AUTO_CONNECT_KEY = "researchgpt-desktop-auto-connect";
const CHECK_INTERVAL_MS = 15_000;
const CONNECT_RECHECK_DELAYS = [900, 2200, 4200];

type DesktopConnectionStatusProps = {
  compact?: boolean;
};

function labelForState(state: DesktopConnectionState): string {
  switch (state) {
    case "checking":
      return "检测本机能力";
    case "connected":
      return "本机能力已连接";
    case "connecting":
      return "正在连接本机";
    case "failed":
      return "连接失败";
    case "disconnected":
    default:
      return "连接本机能力";
  }
}

function capabilityText(status: DesktopStatus | null): string {
  if (!status?.capabilities?.length) return "可接管本地文件任务";
  const labels: Record<string, string> = {
    local_files: "本地文件",
    open_pdf: "打开 PDF",
    local_export: "本地导出",
    office: "Office/WPS",
  };

  return status.capabilities
    .slice(0, 3)
    .map((capability) => labels[capability] ?? capability)
    .join(" / ");
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
      const nextStatus = await fetchDesktopStatus(controller.signal);
      setLastCheckedAt(new Date());
      setStatus(nextStatus);
      setState(nextStatus ? "connected" : "disconnected");
      return Boolean(nextStatus);
    } catch {
      setLastCheckedAt(new Date());
      setStatus(null);
      setState((current) =>
        current === "connecting" ? "connecting" : "disconnected",
      );
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const connectDesktop = useCallback(() => {
    setState("connecting");
    launchDesktopConnect();

    for (const delay of CONNECT_RECHECK_DELAYS) {
      window.setTimeout(() => {
        void checkStatus().then((connected) => {
          if (!connected && delay === CONNECT_RECHECK_DELAYS.at(-1)) {
            setState("failed");
          }
        });
      }, delay);
    }
  }, [checkStatus]);

  useEffect(() => {
    const savedAutoConnect =
      window.localStorage.getItem(AUTO_CONNECT_KEY) === "true";
    setAutoConnect(savedAutoConnect);

    void checkStatus().then((connected) => {
      if (!connected && savedAutoConnect && !attemptedAutoConnectRef.current) {
        attemptedAutoConnectRef.current = true;
        connectDesktop();
      }
    });

    const interval = window.setInterval(() => {
      void checkStatus();
    }, CHECK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [checkStatus, connectDesktop]);

  const connected = state === "connected";
  const busy = state === "checking" || state === "connecting";

  return (
    <div
      className={`group relative flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm transition ${
        connected
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : state === "failed"
            ? "border-amber-200 bg-amber-50 text-amber-800"
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
        onClick={connected ? () => void checkStatus() : connectDesktop}
        className="min-w-0 text-left"
      >
        <span className="block truncate font-bold">
          {labelForState(state)}
        </span>
        {!compact && (
          <span className="block truncate text-[11px] font-medium opacity-80">
            {connected
              ? capabilityText(status)
              : "需要本地文件时自动接管"}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => void checkStatus()}
        disabled={busy}
        className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-current opacity-70 hover:bg-black/5 hover:opacity-100 disabled:opacity-40"
        aria-label="刷新本机连接状态"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      </button>

      {!connected && (
        <button
          type="button"
          onClick={connectDesktop}
          className="hidden h-6 shrink-0 items-center gap-1 rounded bg-[#174866] px-2 text-[11px] font-bold text-white hover:bg-[#123a52] sm:inline-flex"
        >
          <PlugZap className="h-3 w-3" />
          打开
        </button>
      )}

      <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-72 rounded-md border border-gray-200 bg-white p-3 text-left text-xs text-gray-600 shadow-xl group-hover:block">
        <p className="font-bold text-gray-950">
          {connected ? "ResearchGPT Desktop 在线" : "ResearchGPT Desktop 未连接"}
        </p>
        <p className="mt-1 leading-5">
          {connected
            ? `设备：${status?.deviceName || status?.app || "本机"}`
            : "点击连接后，网页会尝试唤起 researchgpt://connect。桌面端启动后会自动回到同一个工作区。"}
        </p>
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
          打开网页时自动连接本机能力
        </label>
        {lastCheckedAt && (
          <p className="mt-2 text-[11px] text-gray-400">
            最近检测：{lastCheckedAt.toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}
