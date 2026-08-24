"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleUserRound,
  Coins,
  CreditCard,
  LayoutDashboard,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import type { AccountSectionId } from "@/lib/account/domain/contracts";

const ITEMS: ReadonlyArray<{
  id: AccountSectionId;
  href: string;
  label: string;
  icon: typeof CircleUserRound;
}> = [
  { id: "overview", href: "/account", label: "账号概览", icon: LayoutDashboard },
  { id: "profile", href: "/account/profile", label: "个人资料", icon: CircleUserRound },
  { id: "points", href: "/account/points", label: "智点与充值", icon: Coins },
  { id: "transactions", href: "/account/transactions", label: "智点明细", icon: ListChecks },
  { id: "orders", href: "/account/orders", label: "订单记录", icon: CreditCard },
  { id: "security", href: "/account/security", label: "安全设置", icon: ShieldCheck },
];

export function AccountNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="账号中心" className="space-y-1">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active =
          item.href === "/account"
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
              active
                ? "bg-[#e7f0f4] text-[#174866]"
                : "text-[#52636b] hover:bg-[#f3f6f7] hover:text-[#172126]"
            }`}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
