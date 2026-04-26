import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
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
    backgroundColor: "#000000",
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

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "Open…",
          accelerator: "CmdOrCtrl+O",
          click: () => mainWindow?.webContents.send("app:menu-load"),
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => mainWindow?.webContents.send("app:menu-save"),
        },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => mainWindow?.webContents.send("app:menu-save-as"),
        },
      ],
    },
    { label: "Edit", submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ]},
    { label: "View", submenu: [
      { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
      { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
      { type: "separator" }, { role: "togglefullscreen" },
    ]},
    { label: "Window", submenu: [
      { role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" },
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  let forceClose = false;

  mainWindow.on("close", (e) => {
    if (forceClose) return;
    e.preventDefault();
    mainWindow!.webContents.send("app:check-unsaved");
  });

  ipcMain.on("app:unsaved-status", (_event, hasUnsaved: boolean) => {
    if (!hasUnsaved) {
      forceClose = true;
      mainWindow?.close();
      return;
    }
    dialog
      .showMessageBox(mainWindow!, {
        type: "warning",
        buttons: ["Save", "Don’t Save", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        message: "You have unsaved changes",
        detail: "Do you want to save before closing?",
      })
      .then(async ({ response }) => {
        if (response === 2) return;
        if (response === 0) {
          mainWindow!.webContents.send("app:save-before-close");
          return;
        }
        forceClose = true;
        mainWindow?.close();
      });
  });

  ipcMain.on("app:save-done", () => {
    forceClose = true;
    mainWindow?.close();
  });

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
