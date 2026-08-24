import { redirect } from "next/navigation";
import { SecuritySettings } from "@/components/account/security-settings";
import { createClient } from "@/lib/supabase/server";

export default async function AccountSecurityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/auth?next=/account/security");
  return <SecuritySettings email={user.email} lastSignInAt={user.last_sign_in_at ?? null} />;
}
