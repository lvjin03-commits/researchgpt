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

async function openLocalFile(filePath) {
  const normalizedPath = assertLocalFilePath(filePath);
  const stats = await fs.stat(normalizedPath);
  if (!stats.isFile()) throw new Error("Path is not a file.");

  const errorMessage = await shell.openPath(normalizedPath);
  if (errorMessage) throw new Error(errorMessage);
  return { opened: true };
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
