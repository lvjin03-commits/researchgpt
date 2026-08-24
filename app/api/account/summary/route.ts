import { NextResponse } from "next/server";
import { getAccountSummary } from "@/lib/account/server/account-summary";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getAccountSummary(user), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
