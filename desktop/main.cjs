const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, shell } = require("electron");

const APP_NAME = "ResearchGPT Desktop";
const STATUS_PORT = Number(process.env.RESEARCHGPT_DESKTOP_PORT || 48732);
const WORKSPACE_URL =
  process.env.RESEARCHGPT_DESKTOP_URL ||
  "https://researchgpt-ivory.vercel.app/chat";

let mainWindow = null;
let statusServer = null;

function createStatusServer() {
  if (statusServer) return statusServer;

  statusServer = http.createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method !== "GET" || request.url?.split("?")[0] !== "/status") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        online: true,
        app: APP_NAME,
        version: app.getVersion(),
        deviceName: os.hostname(),
        capabilities: ["local_files", "open_pdf", "local_export"],
      }),
    );
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
