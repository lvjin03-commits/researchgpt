import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { AccountSummary } from "@/lib/account/domain/contracts";
import { SupabasePointLedgerRepository } from "@/lib/billing/infrastructure/supabase/supabase-point-ledger-repository";

function metadataString(user: User, key: string): string | null {
  const value = user.user_metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function getAccountSummary(user: User): Promise<AccountSummary> {
  const email = user.email ?? null;
  const displayName =
    metadataString(user, "display_name") ??
    metadataString(user, "full_name") ??
    email?.split("@")[0] ??
    "ResearchGPT 用户";
  const avatarUrl = metadataString(user, "avatar_url");
  const base = {
    userId: user.id,
    email,
    displayName,
    avatarUrl,
    createdAt: user.created_at,
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    return { ...base, points: { status: "unavailable", available: null, reserved: null } };
  }

  try {
    const client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const snapshot = await new SupabasePointLedgerRepository(client).getAccount(user.id);
    return {
      ...base,
      points: {
        status: "available",
        available: snapshot?.account.availablePoints ?? 0,
        reserved: snapshot?.account.reservedPoints ?? 0,
      },
    };
  } catch (error) {
    console.error("[account-summary] point balance unavailable", error);
    return { ...base, points: { status: "unavailable", available: null, reserved: null } };
  }
}
