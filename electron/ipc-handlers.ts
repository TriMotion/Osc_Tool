import { ipcMain, BrowserWindow } from "electron";
import { OscManager } from "./osc-manager";
import { DiagnosticsRunner } from "./diagnostics";
import { WebServer } from "./web-server";
import { EndpointsStore } from "./endpoints-store";
import { DeckStore } from "./deck-store";
import { MidiManager } from "./midi-manager";
import { MidiStore } from "./midi-store";
import { RecordingStore } from "./recording-store";
import { ListenerConfig, SenderConfig, OscArg, MidiMappingRule, Recording } from "../src/lib/types";

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null) {
  const oscManager = new OscManager();
  const diagnostics = new DiagnosticsRunner();
  const endpointsStore = new EndpointsStore();
  const deckStore = new DeckStore();
  const webServer = new WebServer(oscManager, deckStore);
  const midiStore = new MidiStore();
  const midiManager = new MidiManager(oscManager);
  const recordingStore = new RecordingStore();

  // --- Endpoints ---
  ipcMain.handle("endpoints:get-all", (_e, type?: "listener" | "sender") => endpointsStore.getAll(type));
  ipcMain.handle("endpoints:add", (_e, endpoint) => endpointsStore.add(endpoint));
  ipcMain.handle("endpoints:update", (_e, id: string, updates) => {
    const result = endpointsStore.update(id, updates);
    if (result && (updates.host !== undefined || updates.port !== undefined)) {
      deckStore.updateEndpointTargets(id, result.host, result.port);
      webServer.broadcastDeckUpdate(deckStore.getDecks());
    }
    return result;
  });
  ipcMain.handle("endpoints:remove", (_e, id: string) => endpointsStore.remove(id));

  // --- System ---
  ipcMain.handle("system:get-local-ip", () => {
    const { networkInterfaces } = require("os");
    const nets = networkInterfaces();
    const preferred = ["en0", "en1", "eth0", "Wi-Fi", "Ethernet"];
    for (const ifName of preferred) {
      const addrs = nets[ifName];
      if (!addrs) continue;
      const ipv4 = addrs.find((n: any) => n.family === "IPv4" && !n.internal);
      if (ipv4) return ipv4.address;
    }
    for (const name of Object.keys(nets)) {
      if (/^(utun|tun|lo)/.test(name)) continue;
      const ipv4 = nets[name]?.find((n: any) => n.family === "IPv4" && !n.internal);
      if (ipv4) return ipv4.address;
    }
    return "unknown";
  });

  // --- Deck ---
  ipcMain.handle("deck:get-all", () => deckStore.getDecks());
  ipcMain.handle("deck:get", (_e, id: string) => deckStore.getDeck(id));
  ipcMain.handle("deck:create", (_e, name: string) => { const r = deckStore.createDeck(name); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:update", (_e, id: string, updates) => { const r = deckStore.updateDeck(id, updates); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:delete", (_e, id: string) => { const r = deckStore.deleteDeck(id); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:create-page", (_e, deckId: string, name: string) => { const r = deckStore.createPage(deckId, name); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:update-page", (_e, deckId: string, pageId: string, updates) => { const r = deckStore.updatePage(deckId, pageId, updates); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:delete-page", (_e, deckId: string, pageId: string) => { const r = deckStore.deletePage(deckId, pageId); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:add-item", (_e, deckId: string, pageId: string, item) => { const r = deckStore.addItem(deckId, pageId, item); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:update-item", (_e, deckId: string, pageId: string, itemId: string, updates) => { const r = deckStore.updateItem(deckId, pageId, itemId, updates); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:remove-item", (_e, deckId: string, pageId: string, itemId: string) => { const r = deckStore.removeItem(deckId, pageId, itemId); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:add-group", (_e, deckId: string, pageId: string, group) => { const r = deckStore.addGroup(deckId, pageId, group); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:update-group", (_e, deckId: string, pageId: string, groupId: string, updates) => { const r = deckStore.updateGroup(deckId, pageId, groupId, updates); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:remove-group", (_e, deckId: string, pageId: string, groupId: string) => { const r = deckStore.removeGroup(deckId, pageId, groupId); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:move-item-to-group", (_e, deckId: string, pageId: string, itemId: string, groupId: string, absCol?: number, absRow?: number) => { const r = deckStore.moveItemToGroup(deckId, pageId, itemId, groupId, absCol, absRow); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });
  ipcMain.handle("deck:move-item-out-of-group", (_e, deckId: string, pageId: string, itemId: string, groupId: string, absCol?: number, absRow?: number) => { const r = deckStore.moveItemOutOfGroup(deckId, pageId, itemId, groupId, absCol, absRow); webServer.broadcastDeckUpdate(deckStore.getDecks()); return r; });

  // --- Deck live values (synced across all clients) ---
  const itemValues: Map<string, unknown> = new Map();

  function broadcastValue(itemId: string, value: unknown) {
    itemValues.set(itemId, value);
    const payload = { type: "deck-value", itemId, value };
    getMainWindow()?.webContents.send("deck:value", payload);
    webServer.broadcastMessage(payload);
  }

  webServer.setValueChangeHandler((itemId, value) => {
    broadcastValue(itemId, value);
  });

  ipcMain.handle("deck:send-osc", async (_e, host: string, port: number, address: string, args: OscArg[]) => {
    await oscManager.sendMessage({ host, port }, address, args);
    return { ok: true };
  });

  ipcMain.handle("deck:set-value", (_e, itemId: string, value: unknown) => {
    broadcastValue(itemId, value);
    return { ok: true };
  });

  ipcMain.handle("deck:get-values", () => {
    return Object.fromEntries(itemValues);
  });

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

  // --- MIDI ---
  ipcMain.handle("midi:get-devices", () => midiManager.getDevices());

  ipcMain.handle("midi:get-status", () => midiManager.isRunning());

  ipcMain.handle("midi:start", () => {
    const { deviceFilters, mappingRules, target } = midiStore.getState();
    midiManager.start(deviceFilters, mappingRules, target);
    return { ok: true };
  });

  ipcMain.handle("midi:stop", () => {
    midiManager.stop();
    return { ok: true };
  });

  ipcMain.handle("midi:get-mapping-rules", () => midiStore.getState().mappingRules);

  ipcMain.handle("midi:set-mapping-rules", (_e, rules: MidiMappingRule[]) => {
    midiStore.setState({ mappingRules: rules });
    return { ok: true };
  });

  ipcMain.handle("midi:get-device-filters", () => midiStore.getState().deviceFilters);

  ipcMain.handle("midi:set-device-filters", (_e, filters: string[]) => {
    midiStore.setState({ deviceFilters: filters });
    return { ok: true };
  });

  ipcMain.handle("midi:get-target", () => midiStore.getState().target);

  ipcMain.handle("midi:set-target", (_e, target: { host: string; port: number }) => {
    midiStore.setState({ target });
    return { ok: true };
  });

  // --- Recording / Timeline ---
  ipcMain.handle("recording:save", async (_e, rec: Recording, suggestedPath?: string) => {
    return recordingStore.saveDialog(getMainWindow(), rec, suggestedPath);
  });

  ipcMain.handle("recording:save-as", async (_e, rec: Recording) => {
    return recordingStore.saveDialog(getMainWindow(), rec);
  });

  ipcMain.handle("recording:load", async () => {
    try {
      return await recordingStore.loadDialog(getMainWindow());
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("recording:load-path", async (_e, filePath: string) => {
    try {
      const recording = recordingStore.readFile(filePath);
      return { recording, path: filePath };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("recording:list-recent", () => {
    return { entries: recordingStore.listRecent() };
  });

  ipcMain.handle("recording:pick-audio", async () => {
    return recordingStore.pickAudio(getMainWindow());
  });

  ipcMain.handle("recording:read-audio-bytes", (_e, filePath: string) => {
    try {
      return recordingStore.readAudioBytes(filePath);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  // --- Forward OSC messages to renderer (batched) ---
  let messageBatch: unknown[] = [];
  const flushMessages = () => {
    if (messageBatch.length > 0) {
      getMainWindow()?.webContents.send("osc:messages", messageBatch);
      messageBatch = [];
    }
  };
  const batchInterval = setInterval(flushMessages, 50);

  oscManager.on("message", (msg) => {
    messageBatch.push(msg);
  });

  oscManager.on("throughput", (count) => {
    getMainWindow()?.webContents.send("osc:throughput", count);
  });

  // --- Forward MIDI events to renderer (batched) ---
  let midiBatch: unknown[] = [];
  const flushMidiEvents = () => {
    if (midiBatch.length > 0) {
      getMainWindow()?.webContents.send("midi:events", midiBatch);
      midiBatch = [];
    }
  };
  const midiBatchInterval = setInterval(flushMidiEvents, 50);

  midiManager.on("event", (evt) => {
    midiBatch.push(evt);
  });

  midiManager.on("error", (err) => {
    getMainWindow()?.webContents.send("midi:error", err);
  });

  oscManager.on("error", (err) => {
    getMainWindow()?.webContents.send("osc:error", err);
  });

  diagnostics.on("progress", (progress) => {
    getMainWindow()?.webContents.send("diag:progress", progress);
  });

  // Cleanup
  return () => {
    clearInterval(batchInterval);
    clearInterval(midiBatchInterval);
    oscManager.stopAll();
    midiManager.stop();
    webServer.stop();
  };
}
