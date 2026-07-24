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
    const raw = error.message.toLowerCase();
    let message = error.message;
    let code = "AI_PROVIDER_ERROR";

    if (error.statusCode === 429 || raw.includes("quota") || raw.includes("rate limit")) {
      if (raw.includes("daily ai budget reached")) {
        message =
          "今天的 AI 成本保护额度已用完。为了避免继续烧钱，系统已暂停新的 AI 调用。你可以明天再试，或在 Vercel 环境变量里提高 AI_DAILY_USER_BUDGET_USD。";
      } else {
        message =
          "当前模型额度不足或请求过快。系统会优先建议切换到 ResearchGPT Nano；如果仍失败，通常说明供应商账号余额不足、API Key 权限不足，或需要稍后重试。";
      }
      code = "AI_QUOTA_EXCEEDED";
    } else if (
      error.statusCode === 403 ||
      raw.includes("model_not_found") ||
      raw.includes("does not have access")
    ) {
      message = "当前账号暂时没有该模型权限。请切换到其他模型，或检查 OpenAI Project 的模型权限。";
      code = "MODEL_UNAVAILABLE";
    } else if (error.statusCode === 401) {
      message = "登录状态已失效，请重新登录后继续。";
      code = "AUTH_EXPIRED";
    } else if (error.statusCode >= 500) {
      message = "AI 服务暂时不可用，请稍后重试；如持续失败，请切换到标准或经济模式。";
      code = "AI_TEMPORARILY_UNAVAILABLE";
    }

    return {
      status: error.statusCode,
      body: {
        error: message,
        code,
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
