import Link from "next/link";

const startCommand = `cd C:\\Users\\j.lyu\\researchgpt
npm run desktop`;

const steps = [
  {
    title: "1. 启动本机连接器",
    body: "内测阶段还没有正式安装包，先用开发版启动命令运行本机连接器。启动后它会在后台为网页提供本地文件读取能力。",
  },
  {
    title: "2. 回到网页授权",
    body: "连接器启动后，回到 ResearchGPT 网页点击“绑定本地文件夹”。网页只会读取你主动选择的文件夹。",
  },
  {
    title: "3. 绑定项目资料",
    body: "把本地文件夹绑定到当前项目后，AI 默认只读取该项目绑定的资料，避免和其他项目文件混在一起。",
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
          本机连接器是网页读取本地科研资料的安全通道。它不是让用户单独操作的桌面产品，
          只在读取本地文件夹、打开本地文件、后续调用本地软件时在后台运行。
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

        <div className="mt-8 border-t border-[#e4ecef] pt-6">
          <h2 className="text-lg font-black text-[#17384a]">
            内测版启动方式
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#52666f]">
            目前还没有可一键安装的正式安装包。请先在 Cursor 终端运行下面命令，
            启动后再回网页绑定本地文件夹。
          </p>
          <pre className="mt-4 overflow-x-auto rounded-md border border-[#cbd9dd] bg-[#10212c] p-4 text-sm font-bold leading-7 text-white">
            <code>{startCommand}</code>
          </pre>
        </div>

        <div className="mt-8 flex flex-wrap gap-3 border-t border-[#e4ecef] pt-6">
          <a
            href="researchgpt://connect"
            className="inline-flex h-11 items-center rounded-md bg-[#174866] px-5 text-sm font-black text-white hover:bg-[#123a52]"
          >
            我已启动，启用本机连接器
          </a>
          <Link
            href="/chat"
            className="inline-flex h-11 items-center rounded-md border border-[#cbd9dd] bg-white px-5 text-sm font-bold text-[#174866] hover:bg-[#f1f6f8]"
          >
            返回 ResearchGPT
          </Link>
        </div>

        <div className="mt-6 border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          如果点击“我已启动”没有反应，说明本机连接器没有运行，或者浏览器没有获得唤醒权限。
          先在 Cursor 终端运行上面的命令；看到 ResearchGPT 本机连接器启动后，再刷新网页重试。
          后续正式版会补上真正的安装包下载按钮。
        </div>
      </section>
    </main>
  );
}
