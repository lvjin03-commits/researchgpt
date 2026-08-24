import { NextRequest, NextResponse } from "next/server";
import { PointPaymentQueryService } from "@/lib/billing/application/payment-query-service";
import { SupabasePaymentQueryRepository } from "@/lib/billing/infrastructure/supabase/supabase-payment-query-repository";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "30");
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  try {
    const page = await new PointPaymentQueryService(
      new SupabasePaymentQueryRepository(supabase),
    ).listOrders({ ownerId: user.id, limit, cursor, status });
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RangeError) return NextResponse.json({ error: "invalid_order_query" }, { status: 400 });
    console.error("[account-orders] query failed", error);
    return NextResponse.json({ error: "orders_unavailable" }, { status: 503 });
  }
}
