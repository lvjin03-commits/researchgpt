const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("researchGPTDesktop", {
  app: "ResearchGPT Desktop",
  capabilities: ["local_files", "open_pdf", "local_export"],
});
