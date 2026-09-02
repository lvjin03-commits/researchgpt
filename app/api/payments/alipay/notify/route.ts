import { createAccountAdminClient } from "@/lib/account/server/admin-client";
import { createAlipayPaymentService } from "@/lib/billing/server/alipay-composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notificationResponse(value: "success" | "fail") {
  return new Response(value, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    await createAlipayPaymentService(createAccountAdminClient()).confirmWebhook({
      rawBody,
      headers: request.headers,
    });
    return notificationResponse("success");
  } catch (error) {
    console.error("[alipay-notify] notification rejected", error instanceof Error ? error.message : "unknown");
    return notificationResponse("fail");
  }
}
