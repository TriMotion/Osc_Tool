import { autoUpdater } from "electron-updater";
import { BrowserWindow, dialog } from "electron";

export function setupAutoUpdater(getWindow: () => BrowserWindow | null) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    const win = getWindow();
    if (!win) return;
    dialog
      .showMessageBox(win, {
        type: "info",
        title: "Update Available",
        message: `Version ${info.version} is available. Download now?`,
        buttons: ["Download", "Later"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on("update-downloaded", () => {
    const win = getWindow();
    if (!win) return;
    dialog
      .showMessageBox(win, {
        type: "info",
        title: "Update Ready",
        message: "Update downloaded. The app will restart to install it.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("download-progress", (progress) => {
    const win = getWindow();
    if (win) {
      win.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on("error", (err) => {
    const win = getWindow();
    if (win) {
      dialog.showMessageBox(win, {
        type: "error",
        title: "Update Error",
        message: `Update failed: ${err.message}`,
      });
      win.setProgressBar(-1);
    }
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
}
