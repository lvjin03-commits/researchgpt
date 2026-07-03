import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";

export default function AuthPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-4 py-12">
      <Suspense
        fallback={
          <div className="text-sm text-gray-400">正在加载登录…</div>
        }
      >
        <AuthForm />
      </Suspense>
    </div>
  );
}
