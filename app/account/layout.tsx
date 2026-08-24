import Link from "next/link";
import { redirect } from "next/navigation";
import { Microscope } from "lucide-react";
import { AccountNavigation } from "@/components/account/account-navigation";
import { AccountMenu } from "@/components/account/account-menu";
import { createClient } from "@/lib/supabase/server";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth?next=/account");

  return (
    <main className="min-h-dvh bg-[#f5f7f8]">
      <header className="border-b border-[#dbe4e7] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/chat" className="flex items-center gap-2.5 text-sm font-bold text-[#172126]">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#174866] text-white">
              <Microscope className="h-4 w-4" />
            </span>
            ResearchGPT
          </Link>
          <AccountMenu />
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-[#dbe4e7] bg-white p-3 shadow-sm">
          <div className="px-3 pb-3 pt-2">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#78909b]">Account</p>
            <h1 className="mt-1 text-lg font-semibold text-[#172126]">账号中心</h1>
          </div>
          <AccountNavigation />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}
