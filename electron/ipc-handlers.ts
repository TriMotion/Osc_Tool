import { ipcMain, BrowserWindow } from "electron";
import { OscManager } from "./osc-manager";
import { PresetsStore } from "./presets-store";
import { DiagnosticsRunner } from "./diagnostics";
import { WebServer } from "./web-server";
import { ListenerConfig, SenderConfig, OscArg } from "../src/lib/types";

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  const oscManager = new OscManager();
  const presetsStore = new PresetsStore();
  const diagnostics = new DiagnosticsRunner();
  const webServer = new WebServer(oscManager);

  // --- Listener ---
  ipcMain.handle("osc:start-listener", async (_e, config: ListenerConfig) => {
    await oscManager.startListener(config);
    return { ok: true };
  });

  ipcMain.handle("osc:stop-listener", (_e, port: number) => {
    oscManager.stopListener(port);
    return { ok: true };
  });

  ipcMain.handle("osc:get-active-listeners", () => {
    return oscManager.getActiveListeners();
  });

  // --- Sender ---
  ipcMain.handle("osc:send", async (_e, config: SenderConfig, address: string, args: OscArg[]) => {
    await oscManager.sendMessage(config, address, args);
    return { ok: true };
  });

  // --- Presets ---
  ipcMain.handle("presets:get-all", () => presetsStore.getAll());
  ipcMain.handle("presets:add", (_e, preset) => presetsStore.add(preset));
  ipcMain.handle("presets:update", (_e, id: string, updates) => presetsStore.update(id, updates));
  ipcMain.handle("presets:remove", (_e, id: string) => presetsStore.remove(id));
  ipcMain.handle("presets:reorder", (_e, ids: string[]) => {
    presetsStore.reorder(ids);
    return { ok: true };
  });
  ipcMain.handle("presets:export", () => presetsStore.exportAll());
  ipcMain.handle("presets:import", (_e, json: string) => presetsStore.importPresets(json));

  // --- Diagnostics ---
  ipcMain.handle("diag:run-loopback", async (_e, count: number, rate: number) => {
    return diagnostics.runLoopbackTest(count, rate);
  });

  // --- Web Server ---
  ipcMain.handle("web:start", (_e, port: number) => {
    const url = webServer.start(port);
    return { ok: true, url };
  });

  ipcMain.handle("web:stop", () => {
    webServer.stop();
    return { ok: true };
  });

  ipcMain.handle("web:status", () => {
    return { running: webServer.isRunning() };
  });

  // --- Forward OSC messages to renderer (batched) ---
  let messageBatch: unknown[] = [];
  const flushMessages = () => {
    if (messageBatch.length > 0) {
      mainWindow.webContents.send("osc:messages", messageBatch);
      messageBatch = [];
    }
  };
  const batchInterval = setInterval(flushMessages, 50);

  oscManager.on("message", (msg) => {
    messageBatch.push(msg);
  });

  oscManager.on("throughput", (count) => {
    mainWindow.webContents.send("osc:throughput", count);
  });

  oscManager.on("error", (err) => {
    mainWindow.webContents.send("osc:error", err);
  });

  diagnostics.on("progress", (progress) => {
    mainWindow.webContents.send("diag:progress", progress);
  });

  // Cleanup
  return () => {
    clearInterval(batchInterval);
    oscManager.stopAll();
    webServer.stop();
  };
}
