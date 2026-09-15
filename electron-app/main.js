const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

function htmlPath() {
  const inResources = path.join(process.resourcesPath, "cloud-title-app.html");
  if (fs.existsSync(inResources)) return inResources;
  return path.join(__dirname, "..", "cloud-title-app.html");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 840,
    minWidth: 920,
    minHeight: 660,
    backgroundColor: "#eaf6ff",
    title: "云朵跨境标题生成器",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.loadFile(htmlPath());
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
