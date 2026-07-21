const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, dialog, shell } = require("electron");

const APP_NAME = "ResearchGPT Desktop";
const STATUS_PORT = Number(process.env.RESEARCHGPT_DESKTOP_PORT || 48732);
const WORKSPACE_URL =
  process.env.RESEARCHGPT_DESKTOP_URL ||
  "https://researchgpt-ivory.vercel.app/chat";

let mainWindow = null;
let statusServer = null;

function writeJson(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(data));
}

async function scanPdfFiles(folderPath) {
  const files = [];
  const queue = [folderPath];
  const maxFiles = 500;

  while (queue.length > 0 && files.length < maxFiles) {
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

      if (files.length >= maxFiles) break;
    }
  }

  return { files, truncated: files.length >= maxFiles };
}

async function selectLocalFolder() {
  const window = createMainWindow();
  const result = await dialog.showOpenDialog(window, {
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
        capabilities: ["local_files", "open_pdf", "local_export"],
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
                : "Failed to select local folder",
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
  createMainWindow();
  focusMainWindow();
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith("researchgpt://"));
    if (deepLink) handleDeepLink(deepLink);
    else focusMainWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(() => {
    registerProtocol();
    createStatusServer();
    createMainWindow();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else focusMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      statusServer?.close();
      app.quit();
    }
  });
}
