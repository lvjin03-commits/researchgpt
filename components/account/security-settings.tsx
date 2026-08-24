"use client";
import { useState } from "react";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function SecuritySettings({ email, lastSignInAt }: { email: string; lastSignInAt: string | null }) {
  const [busy, setBusy] = useState<"reset" | "sessions" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  async function sendReset() {
    setBusy("reset"); setNotice(null);
    const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth?mode=recovery` });
    setNotice(error ? { kind: "error", text: error.message } : { kind: "ok", text: "密码重置邮件已发送，请检查邮箱。" }); setBusy(null);
  }
  async function signOutOthers() {
    setBusy("sessions"); setNotice(null);
    const { error } = await createClient().auth.signOut({ scope: "others" });
    setNotice(error ? { kind: "error", text: error.message } : { kind: "ok", text: "其他登录会话已退出，当前设备保持登录。" }); setBusy(null);
  }
  return <div className="space-y-5">
    <section className="rounded-2xl border border-[#dbe4e7] bg-white p-6 shadow-sm"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#174866]" /><div><h2 className="font-semibold text-[#172126]">安全设置</h2><p className="mt-1 text-sm text-[#607d8b]">认证和会话由 Supabase Auth 统一管理。</p></div></div>{notice && <p className={`mt-4 rounded-xl px-4 py-3 text-sm ${notice.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{notice.text}</p>}</section>
    <section className="rounded-2xl border border-[#dbe4e7] bg-white p-6 shadow-sm"><h3 className="font-medium text-[#172126]">当前账号</h3><p className="mt-2 text-sm text-[#455a64]">{email}</p><p className="mt-1 text-xs text-[#78909b]">最近登录：{lastSignInAt ? new Date(lastSignInAt).toLocaleString("zh-CN") : "暂无记录"}</p></section>
    <section className="grid gap-4 md:grid-cols-2">
      <button onClick={sendReset} disabled={busy !== null} className="rounded-2xl border border-[#dbe4e7] bg-white p-5 text-left shadow-sm hover:border-[#9fb4bd] disabled:opacity-60"><KeyRound className="h-5 w-5 text-[#174866]" /><span className="mt-3 block font-medium text-[#172126]">重置密码</span><span className="mt-1 block text-sm text-[#607d8b]">向当前邮箱发送安全重置链接。</span></button>
      <button onClick={signOutOthers} disabled={busy !== null} className="rounded-2xl border border-[#dbe4e7] bg-white p-5 text-left shadow-sm hover:border-[#9fb4bd] disabled:opacity-60"><LogOut className="h-5 w-5 text-[#174866]" /><span className="mt-3 block font-medium text-[#172126]">退出其他会话</span><span className="mt-1 block text-sm text-[#607d8b]">撤销其他浏览器的登录，不影响当前设备。</span></button>
    </section>
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h3 className="font-medium text-amber-950">账号注销</h3><p className="mt-2 text-sm leading-6 text-amber-800">注销前由国自然、文档、智点与支付模块分别确认没有未完成事项。首期不直接删除账号，财务与必要审计记录按规则保留。</p><button disabled className="mt-4 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm text-amber-500">注销申请暂未开放</button></section>
  </div>;
}
