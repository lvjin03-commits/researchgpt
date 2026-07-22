const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, dialog, shell } = require("electron");

const APP_NAME = "ResearchGPT 本机连接器";
const STATUS_PORT = Number(process.env.RESEARCHGPT_DESKTOP_PORT || 48732);
const WORKSPACE_URL =
  process.env.RESEARCHGPT_DESKTOP_URL ||
  "https://researchgpt-ivory.vercel.app/chat";
const SHOW_CONNECTOR_WINDOW =
  process.env.RESEARCHGPT_SHOW_CONNECTOR_WINDOW === "true";
const MAX_SCAN_FILES = 500;
const MAX_READ_BYTES = 80 * 1024 * 1024;
const DEFAULT_TEXT_LIMIT = 160000;
const SUPPORTED_LOCAL_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".tsv",
  ".ppt",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".txt",
  ".md",
  ".json",
]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv", ".tsv"]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
]);

let mainWindow = null;
let statusServer = null;

function writeJson(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function extensionFor(filePath) {
  return path.extname(filePath).toLowerCase();
}

function kindForExtension(extension) {
  if (extension === ".pdf") return "pdf";
  if (extension === ".doc" || extension === ".docx") return "word";
  if (extension === ".xls" || extension === ".xlsx") return "excel";
  if (extension === ".ppt" || extension === ".pptx") return "ppt";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "other";
}

function canExtractText(extension) {
  return (
    extension === ".pdf" ||
    extension === ".docx" ||
    extension === ".xlsx" ||
    extension === ".xls" ||
    extension === ".pptx" ||
    TEXT_EXTENSIONS.has(extension)
  );
}

function assertLocalFilePath(filePath) {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new Error("Missing file path.");
  }
  return filePath;
}

async function assertLocalFolderPath(folderPath) {
  if (typeof folderPath !== "string" || folderPath.trim().length === 0) {
    throw new Error("Missing folder path.");
  }
  const stats = await fs.stat(folderPath);
  if (!stats.isDirectory()) throw new Error("Path is not a folder.");
  return folderPath;
}

async function scanLocalFiles(folderPath) {
  const files = [];
  const queue = [folderPath];

  while (queue.length > 0 && files.length < MAX_SCAN_FILES) {
    const currentPath = queue.shift();
    let entries = [];

    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      console.warn("[desktop] cannot read folder:", currentPath, error);
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      const extension = extensionFor(entry.name);
      if (!entry.isFile() || !SUPPORTED_LOCAL_EXTENSIONS.has(extension)) {
        continue;
      }

      try {
        const stats = await fs.stat(entryPath);
        files.push({
          id: Buffer.from(entryPath).toString("base64url"),
          name: entry.name,
          path: entryPath,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          extension,
          kind: kindForExtension(extension),
          readable: canExtractText(extension),
        });
      } catch (error) {
        console.warn("[desktop] cannot stat file:", entryPath, error);
      }

      if (files.length >= MAX_SCAN_FILES) break;
    }
  }

  return { files, truncated: files.length >= MAX_SCAN_FILES };
}

async function selectLocalFolder() {
  const result = await dialog.showOpenDialog({
    title: "选择 ResearchGPT 本地文献文件夹",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const folderPath = result.filePaths[0];
  const scan = await scanLocalFiles(folderPath);
  const pdfCount = scan.files.filter((file) => file.kind === "pdf").length;

  return {
    canceled: false,
    folder: {
      id: Buffer.from(folderPath).toString("base64url"),
      name: path.basename(folderPath) || folderPath,
      path: folderPath,
      boundAt: new Date().toISOString(),
      pdfCount,
      fileCount: scan.files.length,
      truncated: scan.truncated,
      files: scan.files,
    },
  };
}

async function refreshLocalFolder(folderPath, boundAt) {
  const normalizedPath = await assertLocalFolderPath(folderPath);
  const scan = await scanLocalFiles(normalizedPath);
  const pdfCount = scan.files.filter((file) => file.kind === "pdf").length;

  return {
    folder: {
      id: Buffer.from(normalizedPath).toString("base64url"),
      name: path.basename(normalizedPath) || normalizedPath,
      path: normalizedPath,
      boundAt:
        typeof boundAt === "string" && boundAt.trim().length > 0
          ? boundAt
          : new Date().toISOString(),
      refreshedAt: new Date().toISOString(),
      pdfCount,
      fileCount: scan.files.length,
      truncated: scan.truncated,
      files: scan.files,
    },
  };
}

async function openLocalFile(filePath) {
  const normalizedPath = assertLocalFilePath(filePath);
  const stats = await fs.stat(normalizedPath);
  if (!stats.isFile()) throw new Error("Path is not a file.");

  const errorMessage = await shell.openPath(normalizedPath);
  if (errorMessage) throw new Error(errorMessage);
  return { opened: true };
}

async function readLocalFileBinary(filePath) {
  const normalizedPath = assertLocalFilePath(filePath);
  const stats = await fs.stat(normalizedPath);
  if (!stats.isFile()) throw new Error("Path is not a file.");
  if (stats.size > MAX_READ_BYTES) {
    throw new Error("File is too large for local document processing.");
  }

  const buffer = await fs.readFile(normalizedPath);
  return {
    filePath: normalizedPath,
    name: path.basename(normalizedPath),
    extension: extensionFor(normalizedPath),
    kind: kindForExtension(extensionFor(normalizedPath)),
    size: stats.size,
    fileBase64: buffer.toString("base64"),
  };
}

function applyTextLimit(text, limit) {
  const textLimit =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), DEFAULT_TEXT_LIMIT)
      : DEFAULT_TEXT_LIMIT;
  return {
    text: text.slice(0, textLimit),
    charCount: text.length,
    truncated: text.length > textLimit,
  };
}

function stripXmlText(xml) {
  return xml
    .replace(/<a:t[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readLocalFileText(filePath, limit = DEFAULT_TEXT_LIMIT) {
  const normalizedPath = assertLocalFilePath(filePath);
  const stats = await fs.stat(normalizedPath);
  if (!stats.isFile()) throw new Error("Path is not a file.");
  if (stats.size > MAX_READ_BYTES) {
    throw new Error("File is too large for this preview reader.");
  }

  const extension = extensionFor(normalizedPath);
  const kind = kindForExtension(extension);
  const buffer = await fs.readFile(normalizedPath);
  let pageCount = 1;
  let text = "";

  if (extension === ".pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const extracted = await extractText(pdf, { mergePages: true });
    text = typeof extracted.text === "string" ? extracted.text : "";
    pageCount = pdf.numPages;
  } else if (extension === ".docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = typeof result.value === "string" ? result.value : "";
  } else if (extension === ".doc") {
    throw new Error(
      "无法识别旧版 .doc 文件。请用 Word 或 WPS 将文件另存为 .docx 后再读取。",
    );
  } else if (extension === ".xlsx" || extension === ".xls") {
    const XLSX = require("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    text = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      return `# Sheet: ${sheetName}\n${csv}`;
    }).join("\n\n");
    pageCount = workbook.SheetNames.length || 1;
  } else if (extension === ".pptx") {
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((left, right) => {
        const leftNum = Number(left.match(/slide(\d+)\.xml/)?.[1] ?? 0);
        const rightNum = Number(right.match(/slide(\d+)\.xml/)?.[1] ?? 0);
        return leftNum - rightNum;
      });
    const slides = [];
    for (const slideName of slideNames) {
      const xml = await zip.files[slideName].async("string");
      const slideText = stripXmlText(xml);
      if (slideText) slides.push(`# ${path.basename(slideName, ".xml")}\n${slideText}`);
    }
    text = slides.join("\n\n");
    pageCount = slideNames.length || 1;
  } else if (extension === ".ppt") {
    throw new Error(
      "无法识别旧版 .ppt 文件。请用 PowerPoint 或 WPS 将文件另存为 .pptx 后再读取。",
    );
  } else if (TEXT_EXTENSIONS.has(extension)) {
    text = buffer.toString("utf8");
  } else if (IMAGE_EXTENSIONS.has(extension)) {
    text = [
      `[Image file: ${path.basename(normalizedPath)}]`,
      "This file can be displayed and opened from the local connector.",
      "Text extraction for images requires OCR or a vision model and is not available in the current local text reader.",
    ].join("\n");
  } else {
    throw new Error("This file type is not readable yet.");
  }

  const limited = applyTextLimit(text, limit);

  return {
    filePath: normalizedPath,
    name: path.basename(normalizedPath),
    extension,
    kind,
    pageCount,
    text: limited.text,
    charCount: limited.charCount,
    truncated: limited.truncated,
  };
}

function createStatusServer() {
  if (statusServer) return statusServer;

  statusServer = http.createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Private-Network", "true");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const pathname = request.url?.split("?")[0];

    if (request.method === "GET" && pathname === "/status") {
      writeJson(response, 200, {
        online: true,
        app: APP_NAME,
        version: app.getVersion(),
        deviceName: os.hostname(),
        authorized: true,
        state: "connected",
        capabilities: [
          "local_files",
          "open_file",
          "read_file_text",
          "read_file_binary",
          "open_pdf",
          "read_pdf",
          "read_pdf_text",
          "local_export",
        ],
      });
      return;
    }

    if (request.method === "POST" && pathname === "/local-folders/select") {
      void selectLocalFolder()
        .then((result) => writeJson(response, 200, result))
        .catch((error) => {
          console.error("[desktop] local folder select failed:", error);
          writeJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Failed to select local folder.",
          });
        });
      return;
    }

    if (request.method === "POST" && pathname === "/local-folders/refresh") {
      void readJsonBody(request)
        .then((body) => refreshLocalFolder(body.path, body.boundAt))
        .then((result) => writeJson(response, 200, result))
        .catch((error) => {
          console.error("[desktop] local folder refresh failed:", error);
          writeJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : "Failed to refresh local folder.",
          });
        });
      return;
    }

    if (request.method === "POST" && pathname === "/local-files/open") {
      void readJsonBody(request)
        .then((body) => openLocalFile(body.path))
        .then((result) => writeJson(response, 200, result))
        .catch((error) => {
          console.error("[desktop] local file open failed:", error);
          writeJson(response, 500, {
            error:
              error instanceof Error ? error.message : "Failed to open file.",
          });
        });
      return;
    }

    if (request.method === "POST" && pathname === "/local-files/read") {
      void readJsonBody(request)
        .then((body) => readLocalFileText(body.path, body.limit))
        .then((result) => writeJson(response, 200, result))
        .catch((error) => {
          console.error("[desktop] local file read failed:", error);
          writeJson(response, 500, {
            error:
              error instanceof Error ? error.message : "Failed to read file.",
          });
        });
      return;
    }

    if (request.method === "POST" && pathname === "/local-files/binary") {
      void readJsonBody(request)
        .then((body) => readLocalFileBinary(body.path))
        .then((result) => writeJson(response, 200, result))
        .catch((error) => {
          console.error("[desktop] local file binary read failed:", error);
          writeJson(response, 500, {
            error:
              error instanceof Error ? error.message : "Failed to read file.",
          });
        });
      return;
    }

    writeJson(response, 404, { error: "Not found" });
  });

  statusServer.on("error", (error) => {
    console.error("[desktop] status server failed:", error);
  });

  statusServer.listen(STATUS_PORT, "127.0.0.1", () => {
    console.log(`[desktop] status server: http://127.0.0.1:${STATUS_PORT}`);
  });

  return statusServer;
}

function registerProtocol() {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient("researchgpt", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
    return;
  }

  app.setAsDefaultProtocolClient("researchgpt");
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function connectorStatusHtml() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${APP_NAME}</title>
    <style>
      body {
        margin: 0;
        background: #f5f8f8;
        color: #172a33;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        box-sizing: border-box;
        min-height: 100vh;
        padding: 28px;
      }
      .card {
        border: 1px solid #d9e5e8;
        background: #ffffff;
        box-shadow: 0 10px 30px rgba(22, 38, 45, 0.08);
        padding: 24px;
      }
      .eyebrow {
        color: #1b5b7a;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      h1 {
        margin: 10px 0 0;
        font-size: 24px;
        line-height: 1.25;
      }
      p {
        color: #52666f;
        font-size: 14px;
        line-height: 1.8;
      }
      .status {
        margin-top: 18px;
        border: 1px solid #b8efcc;
        background: #ecfff3;
        color: #0b6b3a;
        padding: 12px 14px;
        font-weight: 800;
      }
      .meta {
        margin-top: 14px;
        border: 1px solid #e2eaed;
        background: #f8fbfc;
        padding: 12px 14px;
        color: #52666f;
        font-size: 13px;
        line-height: 1.8;
      }
      .actions {
        display: flex;
        gap: 10px;
        margin-top: 20px;
      }
      button {
        height: 42px;
        border-radius: 8px;
        border: 1px solid #cbd9dd;
        background: white;
        color: #174866;
        cursor: pointer;
        font-weight: 800;
        padding: 0 16px;
      }
      button.primary {
        background: #174866;
        border-color: #174866;
        color: #ffffff;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <div class="eyebrow">ResearchGPT Local Connector</div>
        <h1>本机连接器正在运行</h1>
        <p>
          它会在后台为 ResearchGPT 网页提供本地文件夹读取、打开文件和文件翻译等能力。
          网页只会读取你主动授权和绑定的本地资料。
        </p>
        <div class="status">已连接：127.0.0.1:${STATUS_PORT}</div>
        <div class="meta">
          设备：${os.hostname()}<br />
          版本：${app.getVersion()}<br />
          关闭这个窗口不会影响后台连接器运行。
        </div>
        <div class="actions">
          <button class="primary" onclick="location.href='${WORKSPACE_URL}'">打开 ResearchGPT</button>
          <button onclick="window.close()">隐藏到后台</button>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function createMainWindow() {
  if (mainWindow) {
    focusMainWindow();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 560,
    height: 520,
    minWidth: 480,
    minHeight: 420,
    title: APP_NAME,
    backgroundColor: "#f4f7f8",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(connectorStatusHtml())}`,
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function handleDeepLink(url) {
  console.log("[desktop] protocol:", url);
  createStatusServer();
  if (SHOW_CONNECTOR_WINDOW) {
    createMainWindow();
    focusMainWindow();
  }
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith("researchgpt://"));
    if (deepLink) handleDeepLink(deepLink);
    else {
      createStatusServer();
      createMainWindow();
      focusMainWindow();
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    registerProtocol();
    createStatusServer();
    const launchedByProtocol = process.argv.some((arg) =>
      arg.startsWith("researchgpt://"),
    );
    if (SHOW_CONNECTOR_WINDOW || !launchedByProtocol) createMainWindow();
  });

  app.on("activate", () => {
    if (!SHOW_CONNECTOR_WINDOW) {
      createStatusServer();
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else focusMainWindow();
  });

  app.on("window-all-closed", () => {
    if (SHOW_CONNECTOR_WINDOW && process.platform !== "darwin") {
      statusServer?.close();
      app.quit();
    }
  });
}
