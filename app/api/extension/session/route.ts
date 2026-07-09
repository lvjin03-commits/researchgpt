import {
  extensionCorsHeaders,
  extensionCorsPreflight,
} from "@/lib/http/extension-cors";
import { LiteratureError } from "@/lib/literature/errors";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new LiteratureError("Unauthorized", 401);
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new LiteratureError("Unauthorized", 401);
    }

    return Response.json(
      {
        accessToken: session.access_token,
        expiresAt: session.expires_at ?? null,
        userId: user.id,
        email: user.email ?? null,
      },
      { headers: extensionCorsHeaders(request) },
    );
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json(
        { error: error.message },
        {
          status: error.statusCode,
          headers: extensionCorsHeaders(request),
        },
      );
    }

    console.error("[extension] session failed:", error);
    return Response.json(
      { error: "Failed to load session." },
      { status: 500, headers: extensionCorsHeaders(request) },
    );
  }
}
