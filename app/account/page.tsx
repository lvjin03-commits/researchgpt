import { CircleUserRound, Coins, ShieldCheck } from "lucide-react";

export default function AccountOverviewPage() {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[#dbe4e7] bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#78909b]">Overview</p>
        <h2 className="mt-2 text-2xl font-semibold text-[#172126]">管理你的 ResearchGPT 账号</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#607078]">
          账号中心将统一承载个人资料、智点、订单与安全设置。当前已完成账号入口和权限保护，其他能力会分阶段开放。
        </p>
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        <OverviewCard icon={<CircleUserRound className="h-5 w-5" />} title="个人资料" text="查看并管理账号资料。" />
        <OverviewCard icon={<Coins className="h-5 w-5" />} title="智点账户" text="后续统一展示余额与明细。" />
        <OverviewCard icon={<ShieldCheck className="h-5 w-5" />} title="账号安全" text="后续管理密码与登录会话。" />
      </div>
    </div>
  );
}

function OverviewCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <section className="rounded-2xl border border-[#dbe4e7] bg-white p-5 shadow-sm">
      <div className="text-[#245d82]">{icon}</div>
      <h3 className="mt-3 font-semibold text-[#172126]">{title}</h3>
      <p className="mt-1 text-sm text-[#607078]">{text}</p>
    </section>
  );
}
