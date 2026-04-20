import { app, BrowserWindow } from "electron";
import path from "path";
import express from "express";
import http from "http";
import { registerIpcHandlers } from "./ipc-handlers";
import { setupAutoUpdater } from "./auto-updater";

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {

let mainWindow: BrowserWindow | null = null;
let cleanup: (() => void) | null = null;

function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return null;
}

app.on("second-instance", () => {
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

let rendererPort = 0;

function startRendererServer(): Promise<number> {
  return new Promise((resolve) => {
    const rendererApp = express();
    rendererApp.use(express.static(path.join(__dirname, "../out")));
    rendererApp.use((_req, res) => {
      res.sendFile(path.join(__dirname, "../out/index.html"));
    });
    const server = http.createServer(rendererApp);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

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
      backgroundThrottling: false,
    },
  });

  if (!cleanup) {
    cleanup = registerIpcHandlers(getMainWindow);
    if (process.env.NODE_ENV !== "development") {
      setupAutoUpdater(getMainWindow);
    }
  }

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.loadURL(`http://localhost:${rendererPort}`);
  }
}

app.whenReady().then(async () => {
  if (process.env.NODE_ENV !== "development") {
    rendererPort = await startRendererServer();
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    cleanup?.();
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

} // end single instance lock
