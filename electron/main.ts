import { app, BrowserWindow } from "electron";
import path from "path";
import { registerIpcHandlers } from "./ipc-handlers";

let mainWindow: BrowserWindow | null = null;
let cleanup: (() => void) | null = null;

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
