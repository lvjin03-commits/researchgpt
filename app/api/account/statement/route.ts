import { NextRequest, NextResponse } from "next/server";
import { PointStatementService } from "@/lib/billing/application/statement-service";
import { PointStatementFilterSchema } from "@/lib/billing/domain/statements";
import { SupabasePointStatementRepository } from "@/lib/billing/infrastructure/supabase/supabase-statement-repository";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limitValue = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const rawKind = request.nextUrl.searchParams.get("kind");
  const kind = rawKind ? PointStatementFilterSchema.safeParse(rawKind) : null;
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100 || (kind && !kind.success)) {
    return NextResponse.json({ error: "invalid_statement_query" }, { status: 400 });
  }

  try {
    const statement = await new PointStatementService(
      new SupabasePointStatementRepository(supabase),
    ).getStatement({ ownerId: user.id, cursor, limit: limitValue, kind: kind?.data });
    return NextResponse.json(statement, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[account-statement] query failed", error);
    return NextResponse.json({ error: "statement_unavailable" }, { status: 503 });
  }
}
