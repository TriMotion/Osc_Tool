import { app, BrowserWindow } from "electron";
import path from "path";
import { registerIpcHandlers } from "./ipc-handlers";
import { setupAutoUpdater } from "./auto-updater";

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {

let mainWindow: BrowserWindow | null = null;
let cleanup: (() => void) | null = null;

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#1a1a2e",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  cleanup = registerIpcHandlers(mainWindow);

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../out/index.html"));
    setupAutoUpdater(mainWindow);
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  cleanup?.();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

} // end single instance lock
