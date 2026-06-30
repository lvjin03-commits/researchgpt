import { type NextRequest, NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  if (!hasSupabaseEnv()) {
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  matcher: ["/chat", "/chat/:path*", "/translate", "/translate/:path*"],
};
