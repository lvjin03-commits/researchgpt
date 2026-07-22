import Link from "next/link";

const startCommand = `cd C:\\Users\\j.lyu\\researchgpt
npm run desktop`;

const installerCommand = `cd C:\\Users\\j.lyu\\researchgpt
npm run desktop:installer`;

const packagedCommand = `cd C:\\Users\\j.lyu\\researchgpt
npm run desktop:dir`;

const installerOutput =
  "C:\\Users\\j.lyu\\researchgpt\\release\\ResearchGPT Local Connector Setup 0.1.0.exe";
const packagedOutput =
  "C:\\Users\\j.lyu\\researchgpt\\release-local-v2\\win-unpacked\\ResearchGPT Local Connector.exe";

const steps = [
  {
    title: "1. 安装本机连接器",
    body: "内测阶段可以先在本机生成 Windows 安装包。安装后它会像普通软件一样存在电脑里，后续网页可以自动检测和唤起。",
  },
  {
    title: "2. 启用并授权",
    body: "安装后回到 ResearchGPT 网页点击“启用本机连接器”或“绑定本地文件夹”。网页只会读取你主动选择的文件夹。",
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
            内测实体版
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#52666f]">
            现在已经加入实体程序打包能力。优先生成内测实体版，生成后直接双击运行；
            连接器会像本机能力插件一样在后台提供本地文件读取能力。
          </p>
          <pre className="mt-4 overflow-x-auto rounded-md border border-[#cbd9dd] bg-[#10212c] p-4 text-sm font-bold leading-7 text-white">
            <code>{packagedCommand}</code>
          </pre>
          <div className="mt-4 rounded-md border border-[#cbd9dd] bg-[#f7fafb] p-4 text-sm leading-6 text-[#334950]">
            <p className="font-black text-[#17384a]">实体程序位置</p>
            <p className="mt-1 break-all font-mono text-xs">{packagedOutput}</p>
            <p className="mt-2">
              这就是当前内测阶段推荐使用的“本机连接器实体”。后续稳定后再发布单文件安装向导版。
            </p>
          </div>
          <details className="mt-4 rounded-md border border-[#dbe5e8] bg-white p-4 text-sm leading-6 text-[#52666f]">
            <summary className="cursor-pointer font-black text-[#17384a]">
              生成安装向导版
            </summary>
            <p className="mt-3">
              如果需要安装到开始菜单和桌面快捷方式，可以运行下面命令生成安装向导版。
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-[#cbd9dd] bg-[#10212c] p-4 text-sm font-bold leading-7 text-white">
              <code>{installerCommand}</code>
            </pre>
            <p className="mt-3 break-all font-mono text-xs text-[#334950]">
              {installerOutput}
            </p>
          </details>
        </div>

        <div className="mt-8 border-t border-[#e4ecef] pt-6">
          <h2 className="text-lg font-black text-[#17384a]">
            开发调试启动方式
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#52666f]">
            如果暂时不想安装，也可以用开发命令启动。本方式只适合你自己测试，不适合发给普通用户。
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
          如果点击“我已启动”没有反应，通常说明本机连接器没有运行、尚未安装，或者浏览器没有获得唤醒权限。
          先安装或启动本机连接器；看到系统已允许 ResearchGPT 本机连接器运行后，再刷新网页重试。
          等内测安装包稳定后，可以把安装包上传到网站下载区，用户就不需要接触 Cursor 命令。
        </div>
      </section>
    </main>
  );
}
