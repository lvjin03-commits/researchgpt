import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAccountAdminClient } from "@/lib/account/server/admin-client";
import { createAlipaySandboxPaymentService } from "@/lib/billing/server/alipay-sandbox-composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action https://openapi-sandbox.dl.alipaydev.com",
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
    const result = await createAlipaySandboxPaymentService(createAccountAdminClient()).createCheckout({
      ownerId: user.id,
      requestedPoints,
      returnContextId: returnContextValue || undefined,
    });
    if (result.checkout.checkoutKind !== "html_form") throw new Error("Unexpected checkout kind.");
    return htmlResponse(result.checkout.checkoutHtml);
  } catch (error) {
    console.error("[alipay-sandbox-checkout] checkout rejected", error instanceof Error ? error.message : "unknown");
    return htmlResponse("<p>支付宝沙箱订单创建失败，请返回智点账户后重试。</p>", 400);
  }
}
