import { NextRequest, NextResponse } from "next/server";
import { ResumeIntentService } from "@/lib/billing/application/resume-intent-service";
import { SupabaseResumeIntentRepository } from "@/lib/billing/infrastructure/supabase/supabase-resume-intent-repository";
import { createClient } from "@/lib/supabase/server";
import { createAccountAdminClient } from "@/lib/account/server/admin-client";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { operation?: unknown; requiredPoints?: unknown; context?: unknown };
    const intent = await new ResumeIntentService(
      new SupabaseResumeIntentRepository(createAccountAdminClient()),
    ).create({
      ownerId: user.id,
      operation: String(body.operation ?? ""),
      requiredPoints: Number(body.requiredPoints),
      context: body.context,
    });
    return NextResponse.json(intent, { status: 201 });
  } catch (error) {
    console.error("[resume-intent] creation rejected", error);
    return NextResponse.json({ error: "invalid_resume_intent" }, { status: 400 });
  }
}
