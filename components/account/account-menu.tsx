"use client";

import Link from "next/link";
import { CircleUserRound, Coins, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { AccountSummary } from "@/lib/account/domain/contracts";

const integer = new Intl.NumberFormat("zh-CN");

export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const [summary, setSummary] = useState<AccountSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/account/summary", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setSummary(data as AccountSummary | null))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSummary(null);
      });
    return () => controller.abort();
  }, []);

  if (!summary) return null;

  const initial = summary.displayName.slice(0, 1).toUpperCase();
  const pointLabel =
    summary.points.status === "available" && summary.points.available !== null
      ? `${integer.format(summary.points.available)} 智点`
      : "智点 --";

  return (
    <details className="group relative shrink-0">
      <summary
        className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-full border border-[#d5e0e4] bg-white px-1.5 pr-3 text-[#42545c] transition-colors hover:border-[#9db5bf] hover:bg-[#f7fafb] [&::-webkit-details-marker]:hidden"
        aria-label="打开账号菜单"
      >
        <Avatar initial={initial} />
        {!compact && <span className="hidden text-xs font-bold sm:inline">{pointLabel}</span>}
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-[#dbe4e7] bg-white shadow-xl">
        <div className="border-b border-[#e8eef0] px-4 py-4">
          <div className="flex items-center gap-3">
            <Avatar initial={initial} large />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#172126]">{summary.displayName}</p>
              <p className="truncate text-xs text-[#718087]">{summary.email ?? "已登录账号"}</p>
            </div>
          </div>
        </div>
        <div className="border-b border-[#e8eef0] bg-[#f8fafb] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold text-[#607078]">
              <Coins className="h-4 w-4" />可用智点
            </span>
            <span className="text-sm font-bold text-[#174866]">{pointLabel}</span>
          </div>
          {summary.points.status === "available" && (summary.points.reserved ?? 0) > 0 && (
            <p className="mt-1 text-right text-xs text-[#7b8b92]">另有 {integer.format(summary.points.reserved ?? 0)} 智点处理中</p>
          )}
        </div>
        <div className="p-2">
          <Link href="/account" className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#42545c] hover:bg-[#f1f5f6]">
            <CircleUserRound className="h-4 w-4" />账号中心
          </Link>
          <Link href="/account/security" className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#42545c] hover:bg-[#f1f5f6]">
            <Settings className="h-4 w-4" />安全设置
          </Link>
        </div>
      </div>
    </details>
  );
}

function Avatar({ initial, large = false }: { initial: string; large?: boolean }) {
  const size = large ? "h-10 w-10" : "h-7 w-7";
  return <span className={`inline-flex ${size} items-center justify-center rounded-full bg-[#174866] text-xs font-bold text-white`}>{initial}</span>;
}
