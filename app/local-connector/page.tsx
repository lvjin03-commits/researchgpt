import Link from "next/link";
import { Download, PlugZap, ShieldCheck } from "lucide-react";

const installerUrl =
  process.env.NEXT_PUBLIC_LOCAL_CONNECTOR_DOWNLOAD_URL ||
  "https://github.com/lvjin03-commits/researchgpt/releases/download/local-connector-v0.1.0/ResearchGPT-Local-Connector-Setup.exe";

const buildCommand = `cd C:\\Users\\j.lyu\\researchgpt
npm run desktop:publish-installer`;

const devCommand = `cd C:\\Users\\j.lyu\\researchgpt
npm run desktop`;

const installSteps = [
  {
    title: "1. 下载安装包",
    body: "下载 ResearchGPT 本机连接器安装包。它是网页读取本地文件的安全通道，不是需要用户单独操作的桌面软件。",
  },
  {
    title: "2. 安装并后台运行",
    body: "安装完成后连接器会自动启动，并在后台保持运行。后续打开电脑时也会自动启动，用户不需要再打开终端。",
  },
  {
    title: "3. 回到网页授权",
    body: "回到 ResearchGPT 网页点击启用或绑定本地文件夹。网页只会读取用户主动选择和绑定的资料位置。",
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
          安装 ResearchGPT 本机连接器
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[#52666f]">
          本机连接器让网页能够在用户授权后读取本地科研资料、打开本地文件、同步项目资料。
          用户主要仍然在网页里工作，连接器只作为后台能力插件运行。
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {installSteps.map((step) => (
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

        <div className="mt-8 border-t border-[#e4ecef] pt-6">
          <h2 className="text-lg font-black text-[#17384a]">用户安装入口</h2>
          <p className="mt-2 text-sm leading-6 text-[#52666f]">
            如果安装包已经发布到网站下载目录，用户点击下面按钮即可下载并安装。
            安装完成后回到网页，点击“启用本机连接器”完成授权。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={installerUrl}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-[#174866] px-5 text-sm font-black text-white hover:bg-[#123a52]"
            >
              <Download className="h-4 w-4" />
              下载本机连接器
            </a>
            <a
              href="researchgpt://connect"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-5 text-sm font-black text-emerald-800 hover:bg-emerald-100"
            >
              <PlugZap className="h-4 w-4" />
              我已安装，启用连接器
            </a>
            <Link
              href="/chat"
              className="inline-flex h-11 items-center rounded-md border border-[#cbd9dd] bg-white px-5 text-sm font-bold text-[#174866] hover:bg-[#f1f6f8]"
            >
              返回 ResearchGPT
            </Link>
          </div>
        </div>

        <div className="mt-6 border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
          <div className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              安全说明：网页不能随意读取电脑文件。只有用户主动绑定的本地文件夹会进入项目资料范围；
              用户可以随时移除项目绑定或退出本机连接器。
            </p>
          </div>
        </div>

        <details className="mt-8 rounded-md border border-[#dbe5e8] bg-[#f9fbfb] p-4 text-sm leading-6 text-[#52666f]">
          <summary className="cursor-pointer font-black text-[#17384a]">
            维护者：生成并发布安装包
          </summary>
          <p className="mt-3">
            运行下面命令会生成 Windows 安装包，并复制到网站下载目录
            <code className="mx-1 rounded bg-white px-1 py-0.5">
              public/downloads
            </code>
            。之后提交并部署，用户就能从上面的按钮下载。
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md border border-[#cbd9dd] bg-[#10212c] p-4 text-sm font-bold leading-7 text-white">
            <code>{buildCommand}</code>
          </pre>
        </details>

        <details className="mt-4 rounded-md border border-[#dbe5e8] bg-white p-4 text-sm leading-6 text-[#52666f]">
          <summary className="cursor-pointer font-black text-[#17384a]">
            开发调试方式
          </summary>
          <p className="mt-3">
            这只适合开发者本机调试，不适合给普通用户使用。
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md border border-[#cbd9dd] bg-[#10212c] p-4 text-sm font-bold leading-7 text-white">
            <code>{devCommand}</code>
          </pre>
        </details>

        <div className="mt-6 border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          如果点击启用没有反应，通常是尚未安装、连接器未启动，或浏览器没有获得唤醒权限。
          请先下载安装包并完成安装，再刷新网页重试。
        </div>
      </section>
    </main>
  );
}
