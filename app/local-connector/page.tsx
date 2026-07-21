import Link from "next/link";

const steps = [
  {
    title: "1. 安装本机连接器",
    body: "本机连接器是 ResearchGPT 读取你授权本地文件夹的安全桥梁。内测阶段安装包由项目维护者发放，正式版会提供一键安装入口。",
  },
  {
    title: "2. 启用并授权",
    body: "安装后回到网页点击启用。浏览器会唤起本机连接器，你确认授权后，网页才可以读取你主动选择的本地文件夹。",
  },
  {
    title: "3. 绑定项目资料",
    body: "授权完成后，在项目里绑定本地文献文件夹。ResearchGPT 默认只读取当前项目绑定的资料，避免把其他文件夹混进分析。",
  },
];

export default function LocalConnectorPage() {
  return (
    <main className="min-h-screen bg-[#f5f8f8] px-4 py-10 text-[#16262d]">
      <section className="mx-auto max-w-4xl border border-[#dbe5e8] bg-white p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#1b5b7a]">
          ResearchGPT Local Connector
        </p>
        <h1 className="mt-3 text-3xl font-black tracking-tight">
          本机连接器安装与授权
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[#52666f]">
          本机连接器不是一个让用户单独操作的桌面产品，而是网页读取本地科研资料的安全通道。
          用户仍然主要在网页里工作；只有读取本地 PDF、打开本地文件、导出到本地软件时，才需要它在后台运行。
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {steps.map((step) => (
            <article
              key={step.title}
              className="border border-[#dbe5e8] bg-[#f9fbfb] p-4"
            >
              <h2 className="font-black text-[#17384a]">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#52666f]">
                {step.body}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3 border-t border-[#e4ecef] pt-6">
          <a
            href="researchgpt://connect"
            className="inline-flex h-11 items-center rounded-md bg-[#174866] px-5 text-sm font-black text-white hover:bg-[#123a52]"
          >
            我已安装，启用本机连接器
          </a>
          <Link
            href="/chat"
            className="inline-flex h-11 items-center rounded-md border border-[#cbd9dd] bg-white px-5 text-sm font-bold text-[#174866] hover:bg-[#f1f6f8]"
          >
            返回 ResearchGPT
          </Link>
        </div>

        <div className="mt-6 border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          如果点击启用没有反应，通常说明本机连接器尚未安装，或浏览器没有获得唤起本机连接器的权限。
          内测阶段请先使用项目提供的安装包；安装完成后刷新网页再重试。
        </div>
      </section>
    </main>
  );
}
