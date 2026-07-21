const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("researchGPTLocalConnector", {
  app: "ResearchGPT 本机连接器",
  capabilities: ["local_files", "open_pdf", "read_pdf", "local_export"],
});
