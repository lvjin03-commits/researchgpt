"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BookOpenCheck,
  ChartNoAxesCombined,
  Coins,
  Languages,
  Library,
  MessageSquareText,
  Microscope,
  Search,
} from "lucide-react";

type ResearchPageHeaderProps = {
  title: string;
  description: string;
  actions?: ReactNode;
  maxWidth?: "4xl" | "5xl" | "6xl";
};

const PRIMARY_NAV = [
  { href: "/chat", label: "研究助手", match: "/chat", icon: MessageSquareText },
  { href: "/literature", label: "文献工作台", match: "/literature", icon: Library },
  { href: "/presentation", label: "成果制作", match: "/presentation", icon: ChartNoAxesCombined },
  { href: "/translate", label: "学术翻译", match: "/translate", icon: Languages },
  { href: "/usage", label: "成本", match: "/usage", icon: Coins },
] as const;

const LITERATURE_NAV = [
  { href: "/literature", label: "搜索与追踪", icon: Search },
  { href: "/literature/library", label: "文献库", icon: Library },
  { href: "/literature/reading", label: "单篇精读", icon: BookOpenCheck },
  { href: "/literature/review", label: "文献分析", icon: Microscope },
] as const;

const MAX_WIDTH_CLASS = {
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
} as const;

function isExactOrChild(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ResearchPageHeader({
  title,
  description,
  actions,
  maxWidth = "5xl",
}: ResearchPageHeaderProps) {
  const pathname = usePathname();
  const isLiteratureWorkspace = pathname.startsWith("/literature");

  return (
    <header className="border-b border-[#dbe4e7] bg-white/95 backdrop-blur">
      <div className="border-b border-[#e8eef0] px-4 sm:px-6">
        <div
          className={`mx-auto flex ${MAX_WIDTH_CLASS[maxWidth]} items-center justify-between gap-5 py-2.5`}
        >
          <Link href="/chat" className="flex shrink-0 items-center gap-2.5 text-sm font-bold text-[#172126]">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#174866] text-white shadow-sm">
              <Microscope className="h-4 w-4" />
            </span>
            <span className="hidden sm:block">ResearchGPT</span>
          </Link>
          <nav
            aria-label="主要功能"
            className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {PRIMARY_NAV.map((item) => {
              const active = pathname.startsWith(item.match);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-colors ${
                    active
                      ? "bg-[#e7f0f4] text-[#174866]"
                      : "text-[#52636b] hover:bg-[#f0f4f5] hover:text-[#172126]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {isLiteratureWorkspace && (
        <div className="border-b border-[#e8eef0] bg-[#f8fafb] px-4 sm:px-6">
          <nav
            aria-label="文献工作台"
            className={`mx-auto flex ${MAX_WIDTH_CLASS[maxWidth]} gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
          >
            {LITERATURE_NAV.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/literature"
                  ? pathname === item.href
                  : item.href === "/literature/review"
                    ? isExactOrChild(pathname, item.href) ||
                      /^\/literature\/papers\/[^/]+\/reading(?:\/|$)/.test(pathname)
                    : item.href === "/literature/reading"
                      ? isExactOrChild(pathname, item.href) ||
                        /^\/literature\/papers\/[^/]+\/reading(?:\/|$)/.test(pathname)
                    : isExactOrChild(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors ${
                    active
                      ? "border-[#245d82] text-[#174866]"
                      : "border-transparent text-[#607078] hover:text-[#172126]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      <div className="px-4 py-5 sm:px-6">
        <div
          className={`mx-auto flex ${MAX_WIDTH_CLASS[maxWidth]} flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}
        >
          <div className="min-w-0">
            <p className="research-eyebrow">Research workspace</p>
            <h1 className="mt-1 text-2xl font-semibold text-[#172126]">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#607078]">{description}</p>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </header>
  );
}
