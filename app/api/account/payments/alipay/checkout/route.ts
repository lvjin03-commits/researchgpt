import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAccountAdminClient } from "@/lib/account/server/admin-client";
import { alipayCheckoutOrigin, createAlipayPaymentService } from "@/lib/billing/server/alipay-composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action ${alipayCheckoutOrigin()}`,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return htmlResponse("<p>请先登录 ResearchGPT。</p>", 401);
  try {
    const form = await request.formData();
    const requestedPoints = Number(form.get("requestedPoints"));
    const returnContextValue = String(form.get("returnContextId") ?? "").trim();
    const result = await createAlipayPaymentService(createAccountAdminClient()).createCheckout({
      ownerId: user.id,
      requestedPoints,
      returnContextId: returnContextValue || undefined,
    });
    if (result.checkout.checkoutKind !== "redirect") throw new Error("Unexpected checkout kind.");
    return Response.redirect(result.checkout.checkoutUrl, 303);
  } catch (error) {
    console.error("[alipay-checkout] checkout rejected", error instanceof Error ? error.message : "unknown");
    return htmlResponse("<p>支付宝订单创建失败，请返回智点账户后重试。</p>", 400);
  }
}
