import { redirect } from "next/navigation";
import { ResearchPageHeader } from "@/components/research-page-header";
import { createClient } from "@/lib/supabase/server";

type UsageRow = {
  id: string;
  feature: string;
  task_kind: string | null;
  model: string;
  model_tier: string | null;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  web_search_calls: number;
  estimated_cost_usd: number;
  created_at: string;
};

const usd = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const integer = new Intl.NumberFormat("zh-CN");

export default async function UsagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("ai_usage_events")
    .select(
      "id,feature,task_kind,model,model_tier,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,web_search_calls,estimated_cost_usd,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as UsageRow[];
  const totals = rows.reduce(
    (sum, row) => ({
      cost: sum.cost + Number(row.estimated_cost_usd || 0),
      input: sum.input + row.input_tokens,
      cached: sum.cached + row.cached_input_tokens,
      output: sum.output + row.output_tokens,
      reasoning: sum.reasoning + row.reasoning_tokens,
      searches: sum.searches + row.web_search_calls,
    }),
    { cost: 0, input: 0, cached: 0, output: 0, reasoning: 0, searches: 0 },
  );
  const cacheRate =
    totals.input > 0 ? Math.round((totals.cached / totals.input) * 100) : 0;

  return (
    <main className="min-h-screen bg-gray-50">
      <ResearchPageHeader
        title="AI 用量与成本"
        description="查看最近 100 次模型调用，及时发现高成本任务。"
        maxWidth="6xl"
      />
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {error && (
          <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            用量表尚未启用。请先在 Supabase 执行
            <code className="mx-1 font-semibold">
              010_ai_usage_events.sql
            </code>
            ，之后的新请求会自动记录。
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="模型估算费用" value={usd.format(totals.cost)} />
          <Metric label="AI 请求" value={`${rows.length} 次`} />
          <Metric
            label="缓存输入"
            value={`${integer.format(totals.cached)} tokens`}
            detail={`命中率约 ${cacheRate}%`}
          />
          <Metric
            label="高成本操作"
            value={`${integer.format(totals.reasoning)} 推理 tokens`}
            detail={`${totals.searches} 次联网搜索`}
          />
        </section>

        <section className="border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3">
            <h2 className="font-bold text-gray-950">最近调用</h2>
            <p className="mt-1 text-xs text-gray-500">
              费用为模型 token 估算，不含第三方搜索、存储和带宽费用。
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">时间</th>
                  <th className="px-4 py-3 font-semibold">任务</th>
                  <th className="px-4 py-3 font-semibold">模型</th>
                  <th className="px-4 py-3 font-semibold">输入 / 缓存</th>
                  <th className="px-4 py-3 font-semibold">输出</th>
                  <th className="px-4 py-3 font-semibold">估算费用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {new Date(row.created_at).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-4 py-3 text-gray-800">
                      {row.task_kind || row.feature}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {row.model}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {integer.format(row.input_tokens)} /{" "}
                      {integer.format(row.cached_input_tokens)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {integer.format(row.output_tokens)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-gray-950">
                      {usd.format(Number(row.estimated_cost_usd || 0))}
                    </td>
                  </tr>
                ))}
                {!error && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                      暂无用量记录。下一次 AI 请求完成后会显示在这里。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="mt-2 text-xl font-bold text-gray-950">{value}</p>
      {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
    </div>
  );
}
