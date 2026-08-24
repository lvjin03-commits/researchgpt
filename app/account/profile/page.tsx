import { redirect } from "next/navigation";
import { CalendarDays, CircleUserRound, Mail } from "lucide-react";
import { getAccountSummary } from "@/lib/account/server/account-summary";
import { createClient } from "@/lib/supabase/server";

export default async function AccountProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth?next=/account/profile");
  const summary = await getAccountSummary(user);

  return (
    <section className="rounded-2xl border border-[#dbe4e7] bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-4">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#174866] text-xl font-bold text-white">
          {summary.displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-[#172126]">{summary.displayName}</h2>
          <p className="mt-1 text-sm text-[#607078]">账号资料由认证系统提供</p>
        </div>
      </div>
      <dl className="mt-7 divide-y divide-[#edf1f2] rounded-xl border border-[#e1e8ea]">
        <ProfileRow icon={<Mail className="h-4 w-4" />} label="登录邮箱" value={summary.email ?? "未提供"} />
        <ProfileRow icon={<CircleUserRound className="h-4 w-4" />} label="用户 ID" value={summary.userId} mono />
        <ProfileRow icon={<CalendarDays className="h-4 w-4" />} label="注册时间" value={new Date(summary.createdAt).toLocaleString("zh-CN")} />
      </dl>
      <p className="mt-5 text-xs leading-5 text-[#718087]">昵称、头像编辑将在 Profile Service 接入后开放；登录邮箱不会由本页面直接修改。</p>
    </section>
  );
}

function ProfileRow({ icon, label, value, mono = false }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-2 px-4 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
      <dt className="flex items-center gap-2 text-sm font-semibold text-[#607078]">{icon}{label}</dt>
      <dd className={`break-all text-sm text-[#172126] ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</dd>
    </div>
  );
}
