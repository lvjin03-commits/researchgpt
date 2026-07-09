"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type SessionState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "ready"; accessToken: string; expiresAt: number | null; email: string | null };

export function ExtensionConnectPanel() {
  const [sessionState, setSessionState] = useState<SessionState>({
    status: "loading",
  });
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setSessionState({ status: "signed_out" });
        return;
      }

      setSessionState({
        status: "ready",
        accessToken: session.access_token,
        expiresAt: session.expires_at ?? null,
        email: session.user.email ?? null,
      });
    })();
  }, []);

  const handleCopy = async () => {
    if (sessionState.status !== "ready") {
      return;
    }

    try {
      await navigator.clipboard.writeText(sessionState.accessToken);
      setCopyMessage("已复制访问令牌。返回扩展弹窗即可使用。");
    } catch {
      setCopyMessage("复制失败，请手动选择下方令牌。");
    }
  };

  if (sessionState.status === "loading") {
    return <p className="text-sm text-gray-500">正在读取登录会话…</p>;
  }

  if (sessionState.status === "signed_out") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          请先登录 ResearchGPT，扩展才能获取 JWT 访问令牌。
        </p>
        <Link
          href="/auth?next=/extension/connect"
          className="inline-flex rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          前往登录
        </Link>
      </div>
    );
  }

  const expiresLabel = sessionState.expiresAt
    ? new Date(sessionState.expiresAt * 1000).toLocaleString()
    : "未知";

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        {sessionState.email
          ? `已登录：${sessionState.email}`
          : "已登录。扩展可使用下方 JWT。"}
      </p>
      <p className="text-xs text-gray-500">
        会话存储在浏览器 Cookie 中（不是 Local Storage）。令牌过期时间：{expiresLabel}
      </p>
      <textarea
        readOnly
        value={sessionState.accessToken}
        rows={4}
        className="w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800"
      />
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
      >
        复制访问令牌
      </button>
      {copyMessage && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {copyMessage}
        </p>
      )}
      <p className="text-xs text-gray-500">
        若已安装 Chrome 扩展，本页会自动尝试把令牌发送给扩展。你也可以在扩展弹窗点击
        「连接账号」。
      </p>
    </div>
  );
}
