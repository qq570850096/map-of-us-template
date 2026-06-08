const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");

app.setName("Map of Us");

const isPackaged = app.isPackaged;
const appRoot = isPackaged ? app.getAppPath() : path.join(__dirname, "..");
const webOutDir = isPackaged
  ? path.join(appRoot, "web")
  : path.join(appRoot, "..", "web", "out");
const indexHtml = path.join(webOutDir, "index.html");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Map of Us",
    backgroundColor: "#fdfaf3",
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(indexHtml);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
