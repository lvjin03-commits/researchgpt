// Server-only module. Do not import from client components or /api/chat.

import { createClient } from "@/lib/supabase/server";
import { AIProviderError } from "@/lib/ai/errors";
import { UploadError } from "@/lib/uploads/errors";

type ChatApiErrorBody = {
  error: string;
  code?: string;
};

export async function requireChatUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AIProviderError("Unauthorized", { statusCode: 401 });
  }

  return user;
}

export function toChatApiErrorResponse(
  error: unknown,
): { body: ChatApiErrorBody; status: number } {
  if (error instanceof AIProviderError) {
    return {
      status: error.statusCode,
      body: {
        error: error.message,
        code: "AI_PROVIDER_ERROR",
      },
    };
  }

  if (error instanceof UploadError) {
    return {
      status: error.statusCode,
      body: {
        error: error.message,
        code: "UPLOAD_ERROR",
      },
    };
  }

  if (error instanceof SyntaxError) {
    return {
      status: 400,
      body: {
        error: "Invalid JSON body",
        code: "INVALID_JSON",
      },
    };
  }

  console.error("[api/chat] Unexpected error:", error);

  const isDev = process.env.NODE_ENV !== "production";
  const detail =
    isDev && error instanceof Error && error.message
      ? error.message
      : "Internal server error";

  return {
    status: 500,
    body: {
      error: detail,
      code: "INTERNAL_ERROR",
    },
  };
}
