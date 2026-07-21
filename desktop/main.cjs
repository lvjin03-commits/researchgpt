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

function assertPdfPath(filePath) {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new Error("Missing PDF path.");
  }
  if (!filePath.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF files can be opened or read.");
  }
  return filePath;
}

async function scanPdfFiles(folderPath) {
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

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) {
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
  const scan = await scanPdfFiles(folderPath);

  return {
    canceled: false,
    folder: {
      id: Buffer.from(folderPath).toString("base64url"),
      name: path.basename(folderPath) || folderPath,
      path: folderPath,
      boundAt: new Date().toISOString(),
      pdfCount: scan.files.length,
      truncated: scan.truncated,
      files: scan.files,
    },
  };
}

async function openLocalPdf(filePath) {
  const normalizedPath = assertPdfPath(filePath);
  const stats = await fs.stat(normalizedPath);
  if (!stats.isFile()) throw new Error("PDF path is not a file.");

  const errorMessage = await shell.openPath(normalizedPath);
  if (errorMessage) throw new Error(errorMessage);
  return { opened: true };
}

async function readLocalPdfText(filePath, limit = DEFAULT_TEXT_LIMIT) {
  const normalizedPath = assertPdfPath(filePath);
  const stats = await fs.stat(normalizedPath);
  if (!stats.isFile()) throw new Error("PDF path is not a file.");
  if (stats.size > MAX_READ_BYTES) {
    throw new Error("PDF is too large for this preview reader.");
  }

  const buffer = await fs.readFile(normalizedPath);
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const extracted = await extractText(pdf, { mergePages: true });
  const text = typeof extracted.text === "string" ? extracted.text : "";
  const textLimit =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), DEFAULT_TEXT_LIMIT)
      : DEFAULT_TEXT_LIMIT;

  return {
    filePath: normalizedPath,
    name: path.basename(normalizedPath),
    pageCount: pdf.numPages,
    text: text.slice(0, textLimit),
    charCount: text.length,
    truncated: text.length > textLimit,
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

    if (request.method === "POST" && pathname === "/local-files/open") {
      void readJsonBody(request)
        .then((body) => openLocalPdf(body.path))
        .then((result) => writeJson(response, 200, result))
        .catch((error) => {
          console.error("[desktop] local PDF open failed:", error);
          writeJson(response, 500, {
            error:
              error instanceof Error ? error.message : "Failed to open PDF.",
          });
        });
      return;
    }

    if (request.method === "POST" && pathname === "/local-files/read") {
      void readJsonBody(request)
        .then((body) => readLocalPdfText(body.path, body.limit))
        .then((result) => writeJson(response, 200, result))
        .catch((error) => {
          console.error("[desktop] local PDF read failed:", error);
          writeJson(response, 500, {
            error:
              error instanceof Error ? error.message : "Failed to read PDF.",
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

function createMainWindow() {
  if (mainWindow) {
    focusMainWindow();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: APP_NAME,
    backgroundColor: "#f4f7f8",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadURL(WORKSPACE_URL);

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
    else if (SHOW_CONNECTOR_WINDOW) focusMainWindow();
    else createStatusServer();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    registerProtocol();
    createStatusServer();
    if (SHOW_CONNECTOR_WINDOW) createMainWindow();
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
