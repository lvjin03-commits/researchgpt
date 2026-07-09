import { ExtensionConnectPanel } from "@/components/extension-connect-panel";

export default function ExtensionConnectPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-4 py-12">
      <div className="w-full max-w-lg rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">连接 Chrome 扩展</h1>
        <p className="mt-2 text-sm text-gray-500">
          此页面用于向 ResearchAI Scholar Saver 扩展提供 Supabase JWT。
        </p>
        <div className="mt-6">
          <ExtensionConnectPanel />
        </div>
      </div>
    </div>
  );
}
