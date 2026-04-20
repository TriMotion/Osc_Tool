import { autoUpdater } from "electron-updater";
import { BrowserWindow, dialog, shell } from "electron";

const GITHUB_RELEASES_BASE = "https://github.com/TriMotion/Osc_Tool/releases";

// macOS Squirrel refuses to install an update whose code signature doesn't match
// the installed app's designated requirement. With ad-hoc signing every build has
// a different DR, so auto-install always fails. On darwin we show a manual-update
// dialog instead of triggering downloadUpdate(); windows keeps the Squirrel flow.
const IS_MAC = process.platform === "darwin";

export function setupAutoUpdater(getWindow: () => BrowserWindow | null) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = !IS_MAC;

  autoUpdater.on("update-available", (info) => {
    const win = getWindow();
    if (!win) return;
    if (IS_MAC) {
      const dmgUrl = buildDmgUrl(info.version, info.files);
      dialog
        .showMessageBox(win, {
          type: "info",
          title: "Update Available",
          message: `Version ${info.version} is available.`,
          detail:
            "Automatic install on macOS is disabled for unsigned builds. " +
            "Download the dmg, drag Oscilot to Applications, and replace the existing app.",
          buttons: ["Download DMG", "Open Release Page", "Later"],
          defaultId: 0,
          cancelId: 2,
        })
        .then(({ response }) => {
          if (response === 0 && dmgUrl) shell.openExternal(dmgUrl);
          else if (response === 1) shell.openExternal(`${GITHUB_RELEASES_BASE}/tag/v${info.version}`);
        });
      return;
    }
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

function buildDmgUrl(version: string, files: Array<{ url: string }> | undefined): string | null {
  const dmg = files?.find((f) => f.url.toLowerCase().endsWith(".dmg"));
  if (!dmg) return null;
  return `${GITHUB_RELEASES_BASE}/download/v${version}/${dmg.url}`;
}
