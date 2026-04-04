import { ipcMain, BrowserWindow } from "electron";
import { OscManager } from "./osc-manager";
import { DiagnosticsRunner } from "./diagnostics";
import { WebServer } from "./web-server";
import { EndpointsStore } from "./endpoints-store";
import { ListenerConfig, SenderConfig, OscArg } from "../src/lib/types";

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  const oscManager = new OscManager();
  const diagnostics = new DiagnosticsRunner();
  const webServer = new WebServer(oscManager);
  const endpointsStore = new EndpointsStore();

  // --- Endpoints ---
  ipcMain.handle("endpoints:get-all", (_e, type?: "listener" | "sender") => endpointsStore.getAll(type));
  ipcMain.handle("endpoints:add", (_e, endpoint) => endpointsStore.add(endpoint));
  ipcMain.handle("endpoints:update", (_e, id: string, updates) => endpointsStore.update(id, updates));
  ipcMain.handle("endpoints:remove", (_e, id: string) => endpointsStore.remove(id));

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
