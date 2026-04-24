# MIDI-to-OSC Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MIDI tab to Oscilot that listens to all connected MIDI devices and converts incoming messages to OSC, sending them to a configurable target.

**Architecture:** A `MidiManager` class (main process, EventEmitter) receives raw MIDI bytes from `@julusian/midi`, applies custom mapping rules or auto-maps to OSC addresses, and sends OSC via the existing `OscManager.sendMessage()`. Events are batched at 50ms intervals and pushed to the renderer via IPC, where the MIDI tab displays them as paired MIDI IN / OSC OUT rows.

**Tech Stack:** `@julusian/midi` (N-API RtMidi wrapper), existing `osc-manager.ts`, Electron IPC, React + Tailwind + Framer Motion.

---

## File Map

**Create:**
- `electron/midi-manager.ts` — device enumeration, raw byte parsing, mapping, OSC output
- `electron/midi-store.ts` — persist `{ deviceFilters, mappingRules, target }` to `midi.json`
- `src/hooks/use-midi.ts` — renderer-side React hooks for all `midi:*` IPC channels
- `src/app/midi/page.tsx` — MIDI tab UI

**Modify:**
- `src/lib/types.ts` — add `MidiEvent`, `MidiMappingRule`
- `electron/ipc-handlers.ts` — register all `midi:*` handlers, wire batching and cleanup
- `src/components/sidebar.tsx` — add MIDI nav item

---

## Task 1: Install @julusian/midi and add TypeScript types

**Files:**
- Modify: `package.json` (via pnpm)
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Install the package and electron-rebuild**

```bash
cd /path/to/osc_tool
pnpm add @julusian/midi
pnpm add -D @electron/rebuild
pnpm exec electron-rebuild -f -w @julusian/midi
```

Expected: rebuild completes without errors. If it fails on macOS with "xcode-select" error, run `xcode-select --install` first.

- [ ] **Step 2: Add `MidiEvent` and `MidiMappingRule` to `src/lib/types.ts`**

Append to the end of `src/lib/types.ts`:

```typescript
// --- MIDI types ---

export interface MidiEvent {
  midi: {
    type: "noteon" | "noteoff" | "cc" | "pitch" | "aftertouch" | "program";
    channel: number;     // 1–16
    data1: number;       // note number, CC number, or program number
    data2: number;       // velocity, value, or pressure (0 for 2-byte messages)
    timestamp: number;   // Date.now()
    deviceName: string;
  };
  osc: OscMessage;       // the converted OSC output
}

export interface MidiMappingRule {
  id: string;
  type: "noteon" | "noteoff" | "cc" | "pitch" | "aftertouch" | "program";
  channel?: number;            // 1–16; undefined = any
  data1?: number;              // note or CC number; undefined = any
  address: string;             // OSC address override, e.g. "/fader/master"
  argType: "f" | "i";         // float or int output
  scale?: [number, number];    // output range; default [0, 1]
}
```

- [ ] **Step 3: Verify types compile**

```bash
pnpm exec tsc --noEmit --project tsconfig.json
```

Expected: no errors (or only pre-existing errors unrelated to MIDI types).

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts package.json pnpm-lock.yaml
git commit -m "feat: add MidiEvent and MidiMappingRule types, install @julusian/midi"
```

---

## Task 2: Create `electron/midi-store.ts`

**Files:**
- Create: `electron/midi-store.ts`

- [ ] **Step 1: Write the file**

Create `electron/midi-store.ts`:

```typescript
import { app } from "electron";
import fs from "fs";
import path from "path";
import { MidiMappingRule } from "../src/lib/types";

interface MidiState {
  deviceFilters: string[];
  mappingRules: MidiMappingRule[];
  target: { host: string; port: number };
}

const DEFAULT: MidiState = {
  deviceFilters: [],
  mappingRules: [],
  target: { host: "127.0.0.1", port: 8000 },
};

export class MidiStore {
  private filePath: string;
  private state: MidiState = { ...DEFAULT };

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "midi.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.state = { ...DEFAULT, ...JSON.parse(raw) };
      }
    } catch {
      this.state = { ...DEFAULT };
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  getState(): MidiState {
    return { ...this.state };
  }

  setState(updates: Partial<MidiState>): void {
    this.state = { ...this.state, ...updates };
    this.save();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/midi-store.ts
git commit -m "feat: add MidiStore for persisting MIDI bridge config"
```

---

## Task 3: Create `electron/midi-manager.ts`

**Files:**
- Create: `electron/midi-manager.ts`

- [ ] **Step 1: Write the file**

Create `electron/midi-manager.ts`:

```typescript
import { Input } from "@julusian/midi";
import { EventEmitter } from "events";
import { OscManager } from "./osc-manager";
import { MidiEvent, MidiMappingRule, OscArg, OscMessage, SenderConfig } from "../src/lib/types";

export class MidiManager extends EventEmitter {
  private inputs: Array<{ input: Input; name: string }> = [];
  private running = false;

  constructor(private oscManager: OscManager) {
    super();
  }

  getDevices(): string[] {
    const temp = new Input();
    const count = temp.getPortCount();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      names.push(temp.getPortName(i));
    }
    return names;
  }

  start(
    deviceFilters: string[],
    rules: MidiMappingRule[],
    target: SenderConfig
  ): void {
    if (this.running) this.stop();

    const temp = new Input();
    const count = temp.getPortCount();

    for (let i = 0; i < count; i++) {
      const name = temp.getPortName(i);
      if (deviceFilters.includes(name)) continue;

      try {
        const input = new Input();
        input.ignoreTypes(true, true, true); // ignore sysex, timing, active sensing
        input.openPort(i);
        input.on("message", (_deltaTime: number, message: number[]) => {
          const event = this.parseMessage(message, name, rules, target);
          if (event) this.emit("event", event);
        });
        this.inputs.push({ input, name });
      } catch {
        // Skip unavailable ports
      }
    }

    this.running = true;
  }

  stop(): void {
    for (const { input } of this.inputs) {
      try { input.closePort(); } catch { /* ignore */ }
    }
    this.inputs = [];
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private parseMessage(
    message: number[],
    deviceName: string,
    rules: MidiMappingRule[],
    target: SenderConfig
  ): MidiEvent | null {
    const [statusByte = 0, data1 = 0, data2 = 0] = message;
    const statusType = statusByte & 0xF0;
    const channel = (statusByte & 0x0F) + 1; // 1-indexed

    let midiType: MidiEvent["midi"]["type"];
    switch (statusType) {
      case 0x80: midiType = "noteoff"; break;
      case 0x90: midiType = data2 === 0 ? "noteoff" : "noteon"; break;
      case 0xA0: midiType = "aftertouch"; break;
      case 0xB0: midiType = "cc"; break;
      case 0xC0: midiType = "program"; break;
      case 0xD0: midiType = "aftertouch"; break;
      case 0xE0: midiType = "pitch"; break;
      default: return null;
    }

    const rule = this.findRule(rules, midiType, channel, data1);
    let address: string;
    let arg: OscArg;

    if (rule) {
      let rawNormalized: number;
      if (midiType === "pitch") {
        rawNormalized = ((data2 << 7) | data1) / 16383;
      } else if (statusType === 0xD0) {
        rawNormalized = data1 / 127; // channel aftertouch: pressure in data1
      } else {
        rawNormalized = data2 / 127;
      }
      const [minOut, maxOut] = rule.scale ?? [0, 1];
      const scaled = minOut + rawNormalized * (maxOut - minOut);
      address = rule.address;
      arg = rule.argType === "i"
        ? { type: "i", value: Math.round(scaled) }
        : { type: "f", value: scaled };
    } else {
      [address, arg] = this.autoMap(midiType, statusType, channel, data1, data2);
    }

    const osc: OscMessage = {
      address,
      args: [arg],
      timestamp: Date.now(),
    };

    this.oscManager.sendMessage(target, address, [arg]).catch(() => {});

    return {
      midi: { type: midiType, channel, data1, data2, timestamp: Date.now(), deviceName },
      osc,
    };
  }

  private autoMap(
    midiType: MidiEvent["midi"]["type"],
    statusType: number,
    channel: number,
    data1: number,
    data2: number
  ): [string, OscArg] {
    switch (midiType) {
      case "noteon":
        return [`/midi/ch${channel}/note/${data1}/on`, { type: "f", value: data2 / 127 }];
      case "noteoff":
        return [`/midi/ch${channel}/note/${data1}/off`, { type: "f", value: data2 / 127 }];
      case "cc":
        return [`/midi/ch${channel}/cc/${data1}`, { type: "f", value: data2 / 127 }];
      case "pitch": {
        const pitchVal = (data2 << 7) | data1;
        return [`/midi/ch${channel}/pitch`, { type: "f", value: (pitchVal - 8192) / 8192 }];
      }
      case "aftertouch":
        if (statusType === 0xA0) {
          // Poly aftertouch: data1=note, data2=pressure
          return [`/midi/ch${channel}/aftertouch/${data1}`, { type: "f", value: data2 / 127 }];
        }
        // Channel aftertouch: data1=pressure
        return [`/midi/ch${channel}/aftertouch`, { type: "f", value: data1 / 127 }];
      case "program":
        return [`/midi/ch${channel}/program`, { type: "i", value: data1 }];
    }
  }

  private findRule(
    rules: MidiMappingRule[],
    type: MidiEvent["midi"]["type"],
    channel: number,
    data1: number
  ): MidiMappingRule | undefined {
    return rules.find((r) => {
      if (r.type !== type) return false;
      if (r.channel !== undefined && r.channel !== channel) return false;
      if (r.data1 !== undefined && r.data1 !== data1) return false;
      return true;
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/midi-manager.ts
git commit -m "feat: add MidiManager with auto-mapping and custom rule support"
```

---

## Task 4: Wire MIDI into `electron/ipc-handlers.ts`

**Files:**
- Modify: `electron/ipc-handlers.ts`

- [ ] **Step 1: Add imports at the top of `ipc-handlers.ts`**

After the existing imports, add:

```typescript
import { MidiManager } from "./midi-manager";
import { MidiStore } from "./midi-store";
import { MidiMappingRule } from "../src/lib/types";
```

- [ ] **Step 2: Instantiate MidiManager and MidiStore inside `registerIpcHandlers`**

After the line `const webServer = new WebServer(oscManager, deckStore);`, add:

```typescript
  const midiStore = new MidiStore();
  const midiManager = new MidiManager(oscManager);
```

- [ ] **Step 3: Register midi:* IPC handlers**

After the `// --- Web Server ---` block (around line 120) and before the `// --- Forward OSC messages ---` batching section, add a new `// --- MIDI ---` section:

```typescript
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
```

- [ ] **Step 4: Add MIDI event batching**

In the `// --- Forward OSC messages to renderer (batched) ---` section (around line 136), after the existing OSC batching code, add:

```typescript
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
```

- [ ] **Step 5: Add midiManager cleanup to the return function**

The existing cleanup return at the bottom reads:

```typescript
  return () => {
    clearInterval(batchInterval);
    oscManager.stopAll();
    webServer.stop();
  };
```

Change it to:

```typescript
  return () => {
    clearInterval(batchInterval);
    clearInterval(midiBatchInterval);
    oscManager.stopAll();
    midiManager.stop();
    webServer.stop();
  };
```

- [ ] **Step 6: Verify the app starts without errors**

```bash
pnpm electron:dev
```

Expected: app opens, no console errors related to MIDI. MIDI tab doesn't exist yet (that's Task 7).

- [ ] **Step 7: Commit**

```bash
git add electron/ipc-handlers.ts
git commit -m "feat: register midi:* IPC handlers and event batching"
```

---

## Task 5: Create `src/hooks/use-midi.ts`

**Files:**
- Create: `src/hooks/use-midi.ts`

- [ ] **Step 1: Write the file**

Create `src/hooks/use-midi.ts`:

```typescript
"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import type { MidiEvent, MidiMappingRule } from "@/lib/types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useMidiEvents(onEvents: (events: MidiEvent[]) => void) {
  const callbackRef = useRef(onEvents);
  callbackRef.current = onEvents;

  useEffect(() => {
    const api = getAPI();
    if (!api) return;
    return api.on("midi:events", (events) => {
      callbackRef.current(events as MidiEvent[]);
    });
  }, []);
}

export function useMidiControl() {
  const [running, setRunning] = useState(false);
  const [devices, setDevices] = useState<string[]>([]);

  const refreshDevices = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    setDevices((await api.invoke("midi:get-devices")) as string[]);
  }, []);

  const checkStatus = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    setRunning((await api.invoke("midi:get-status")) as boolean);
  }, []);

  const start = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("midi:start");
    setRunning(true);
  }, []);

  const stop = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("midi:stop");
    setRunning(false);
  }, []);

  useEffect(() => {
    checkStatus();
    refreshDevices();
  }, [checkStatus, refreshDevices]);

  return { running, devices, start, stop, refreshDevices };
}

export function useMidiConfig() {
  const [rules, setRules] = useState<MidiMappingRule[]>([]);
  const [deviceFilters, setDeviceFilters] = useState<string[]>([]);
  const [target, setTargetState] = useState<{ host: string; port: number }>({
    host: "127.0.0.1",
    port: 8000,
  });

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const [r, f, t] = await Promise.all([
      api.invoke("midi:get-mapping-rules"),
      api.invoke("midi:get-device-filters"),
      api.invoke("midi:get-target"),
    ]);
    setRules(r as MidiMappingRule[]);
    setDeviceFilters(f as string[]);
    setTargetState(t as { host: string; port: number });
  }, []);

  const saveRules = useCallback(async (newRules: MidiMappingRule[]) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("midi:set-mapping-rules", newRules);
    setRules(newRules);
  }, []);

  const saveDeviceFilters = useCallback(async (filters: string[]) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("midi:set-device-filters", filters);
    setDeviceFilters(filters);
  }, []);

  const saveTarget = useCallback(async (t: { host: string; port: number }) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("midi:set-target", t);
    setTargetState(t);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { rules, deviceFilters, target, saveRules, saveDeviceFilters, saveTarget };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-midi.ts
git commit -m "feat: add useMidi hooks (events, control, config)"
```

---

## Task 6: Add MIDI to sidebar navigation

**Files:**
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Add MIDI nav item**

In `src/components/sidebar.tsx`, the `navItems` array currently reads:

```typescript
const navItems = [
  { href: "/listener", label: "Listener", icon: "📡" },
  { href: "/sender", label: "Sender", icon: "📤" },
  { href: "/deck", label: "Deck", icon: "🎛" },
  { href: "/diagnostics", label: "Diagnostics", icon: "🔬" },
];
```

Change it to:

```typescript
const navItems = [
  { href: "/listener", label: "Listener", icon: "📡" },
  { href: "/sender", label: "Sender", icon: "📤" },
  { href: "/deck", label: "Deck", icon: "🎛" },
  { href: "/midi", label: "MIDI", icon: "🎹" },
  { href: "/diagnostics", label: "Diagnostics", icon: "🔬" },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat: add MIDI nav item to sidebar"
```

---

## Task 7: Create `src/app/midi/page.tsx`

**Files:**
- Create: `src/app/midi/page.tsx`

- [ ] **Step 1: Write the file**

Create `src/app/midi/page.tsx`:

```typescript
"use client";

import { useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { useMidiControl, useMidiConfig, useMidiEvents } from "@/hooks/use-midi";
import { useEndpoints } from "@/hooks/use-osc";
import type { MidiEvent, MidiMappingRule } from "@/lib/types";

// crypto.randomUUID() is available as a Web Crypto API in modern browsers — no import needed

const MIDI_TYPES = ["noteon", "noteoff", "cc", "pitch", "aftertouch", "program"] as const;

function formatMidi(evt: MidiEvent["midi"]): string {
  switch (evt.type) {
    case "noteon":  return `NoteOn  ch${evt.channel} #${evt.data1} vel=${evt.data2}`;
    case "noteoff": return `NoteOff ch${evt.channel} #${evt.data1} vel=${evt.data2}`;
    case "cc":      return `CC      ch${evt.channel} #${evt.data1} → ${evt.data2}`;
    case "pitch":   return `Pitch   ch${evt.channel} → ${((evt.data2 << 7) | evt.data1)}`;
    case "aftertouch": return `AT    ch${evt.channel} #${evt.data1} p=${evt.data2}`;
    case "program": return `Prog    ch${evt.channel} → ${evt.data1}`;
  }
}

export default function MidiPage() {
  const { running, devices, start, stop, refreshDevices } = useMidiControl();
  const { rules, deviceFilters, target, saveRules, saveDeviceFilters, saveTarget } = useMidiConfig();
  const { endpoints } = useEndpoints("sender");

  const [events, setEvents] = useState<MidiEvent[]>([]);
  const [hostInput, setHostInput] = useState(target.host);
  const [portInput, setPortInput] = useState(String(target.port));
  const [error, setError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<Omit<MidiMappingRule, "id">>({
    type: "cc",
    address: "",
    argType: "f",
  });

  const pausedRef = useRef(false);

  // Sync host/port inputs when target loads from store
  const targetSynced = useRef(false);
  if (!targetSynced.current && (target.host !== "127.0.0.1" || target.port !== 8000)) {
    setHostInput(target.host);
    setPortInput(String(target.port));
    targetSynced.current = true;
  }

  useMidiEvents(
    useCallback((incoming: MidiEvent[]) => {
      if (pausedRef.current) return;
      setEvents((prev) => [...prev, ...incoming].slice(-500));
    }, [])
  );

  const handleStart = async () => {
    setError(null);
    try {
      await refreshDevices();
      await start();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleStop = async () => {
    await stop();
  };

  const handleTargetBlur = async () => {
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1 || port > 65535) return;
    await saveTarget({ host: hostInput, port });
  };

  const toggleDevice = async (name: string) => {
    const next = deviceFilters.includes(name)
      ? deviceFilters.filter((d) => d !== name)
      : [...deviceFilters, name];
    await saveDeviceFilters(next);
  };

  const addRule = async () => {
    if (!newRule.address.trim()) return;
    const rule: MidiMappingRule = { ...newRule, id: crypto.randomUUID() };
    await saveRules([...rules, rule]);
    setNewRule({ type: "cc", address: "", argType: "f" });
  };

  const removeRule = async (id: string) => {
    await saveRules(rules.filter((r) => r.id !== id));
  };

  const selectEndpoint = async (host: string, port: number) => {
    setHostInput(host);
    setPortInput(String(port));
    await saveTarget({ host, port });
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">MIDI Bridge</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {running ? "Bridge running — MIDI is converting to OSC" : "Bridge stopped"}
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={running ? handleStop : handleStart}
          className={`px-4 py-2 font-medium rounded-lg text-sm transition-colors ${
            running
              ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
              : "bg-accent text-surface hover:bg-accent-dim"
          }`}
        >
          {running ? "Stop Bridge" : "Start Bridge"}
        </motion.button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Device Filters */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">MIDI Devices</label>
        {devices.length === 0 ? (
          <p className="text-xs text-gray-600 italic">No MIDI devices detected. Connect a device and click Start Bridge.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {devices.map((name) => {
              const disabled = deviceFilters.includes(name);
              return (
                <button
                  key={name}
                  onClick={() => toggleDevice(name)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    disabled
                      ? "border-white/10 text-gray-600 bg-transparent"
                      : "border-accent/30 text-accent bg-accent/10"
                  }`}
                >
                  {disabled ? "○" : "●"} {name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* OSC Target */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">OSC Target</label>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={hostInput}
            onChange={(e) => setHostInput(e.target.value)}
            onBlur={handleTargetBlur}
            placeholder="127.0.0.1"
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:border-accent/50"
          />
          <input
            type="text"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            onBlur={handleTargetBlur}
            placeholder="8000"
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm w-20 focus:outline-none focus:border-accent/50"
          />
          {endpoints.length > 0 && (
            <select
              onChange={(e) => {
                const ep = endpoints.find((ep) => ep.id === e.target.value);
                if (ep) selectEndpoint(ep.host, ep.port);
              }}
              defaultValue=""
              className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none focus:border-accent/50"
            >
              <option value="" disabled>Saved endpoints…</option>
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>{ep.name} ({ep.host}:{ep.port})</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Mapping Rules */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">
          Mapping Rules <span className="text-gray-600">(auto-map is default when no rule matches)</span>
        </label>

        {rules.length > 0 && (
          <div className="mb-2 border border-white/5 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-gray-500">
                  <th className="text-left px-3 py-2 font-normal">Type</th>
                  <th className="text-left px-3 py-2 font-normal">Ch</th>
                  <th className="text-left px-3 py-2 font-normal">Note/CC</th>
                  <th className="text-left px-3 py-2 font-normal">OSC Address</th>
                  <th className="text-left px-3 py-2 font-normal">Arg</th>
                  <th className="text-left px-3 py-2 font-normal">Scale</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-1.5 text-gray-300">{rule.type}</td>
                    <td className="px-3 py-1.5 text-gray-400">{rule.channel ?? "any"}</td>
                    <td className="px-3 py-1.5 text-gray-400">{rule.data1 ?? "any"}</td>
                    <td className="px-3 py-1.5 text-accent font-mono">{rule.address}</td>
                    <td className="px-3 py-1.5 text-gray-400">{rule.argType}</td>
                    <td className="px-3 py-1.5 text-gray-400">
                      {rule.scale ? `${rule.scale[0]}–${rule.scale[1]}` : "0–1"}
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => removeRule(rule.id)}
                        className="text-gray-600 hover:text-red-400 transition-colors"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add Rule Form */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={newRule.type}
            onChange={(e) => setNewRule((r) => ({ ...r, type: e.target.value as MidiMappingRule["type"] }))}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50"
          >
            {MIDI_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="number"
            placeholder="ch (any)"
            min={1} max={16}
            value={newRule.channel ?? ""}
            onChange={(e) => setNewRule((r) => ({ ...r, channel: e.target.value ? parseInt(e.target.value) : undefined }))}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:border-accent/50"
          />
          <input
            type="number"
            placeholder="#note/cc (any)"
            min={0} max={127}
            value={newRule.data1 ?? ""}
            onChange={(e) => setNewRule((r) => ({ ...r, data1: e.target.value ? parseInt(e.target.value) : undefined }))}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:border-accent/50"
          />
          <input
            type="text"
            placeholder="/osc/address"
            value={newRule.address}
            onChange={(e) => setNewRule((r) => ({ ...r, address: e.target.value }))}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:border-accent/50"
          />
          <select
            value={newRule.argType}
            onChange={(e) => setNewRule((r) => ({ ...r, argType: e.target.value as "f" | "i" }))}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50"
          >
            <option value="f">float</option>
            <option value="i">int</option>
          </select>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={addRule}
            className="px-3 py-1.5 bg-surface-lighter border border-white/10 text-gray-300 hover:text-white hover:border-accent/30 rounded-lg text-sm transition-colors"
          >
            + Add Rule
          </motion.button>
        </div>
      </div>

      {/* Message Log */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-500">Message Log</label>
          <div className="flex gap-2">
            <button
              onClick={() => { pausedRef.current = !pausedRef.current; }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {pausedRef.current ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() => setEvents([])}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-surface-lighter rounded-lg border border-white/5 overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-2 border-b border-white/5 px-3 py-1.5">
            <span className="text-xs text-gray-600 font-mono">MIDI IN</span>
            <span className="text-xs text-gray-600 font-mono">OSC OUT</span>
          </div>

          {/* Events */}
          <div className="overflow-y-auto h-full">
            {events.length === 0 ? (
              <p className="text-xs text-gray-700 italic px-3 py-3">
                {running ? "Waiting for MIDI input…" : "Start the bridge to see events."}
              </p>
            ) : (
              [...events].reverse().map((evt, i) => (
                <div
                  key={i}
                  className="grid grid-cols-2 border-b border-white/5 last:border-0 px-3 py-1 hover:bg-white/5 transition-colors"
                >
                  <span className="text-xs font-mono text-green-400 truncate pr-2">
                    {formatMidi(evt.midi)}
                  </span>
                  <span className="text-xs font-mono text-indigo-400 truncate">
                    {evt.osc.address}{" "}
                    <span className="text-indigo-300/60">
                      {evt.osc.args.map((a) => String(typeof a.value === "number" ? a.value.toFixed(3) : a.value)).join(" ")}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the page imports compile**

```bash
pnpm exec tsc --noEmit
```

Expected: no new type errors.

- [ ] **Step 3: Run the app and test**

```bash
pnpm electron:dev
```

Manual verification checklist:
- MIDI tab appears in sidebar
- Clicking MIDI tab loads the page without errors
- With a MIDI device connected: click "Start Bridge", device pills appear, MIDI messages show in the log as paired MIDI IN / OSC OUT rows
- Custom mapping rules can be added and deleted
- OSC target can be changed; updated value persists after restarting the app
- Stopping the bridge halts the event log

- [ ] **Step 4: Commit**

```bash
git add src/app/midi/page.tsx
git commit -m "feat: add MIDI tab UI with device filters, mapping rules, and dual message log"
```

---

## Notes

**electron-rebuild on Apple Silicon:** If the native module fails to load, check the architecture:
```bash
file node_modules/@julusian/midi/build/Release/midi.node
```
Expected on Apple Silicon: `arm64` or `universal`. If it shows `x86_64` only, run `electron-rebuild` with the explicit arch: `pnpm exec electron-rebuild --arch arm64`.

**Pause button visual state:** The `pausedRef` doesn't trigger a re-render, so the button label won't flip. If you want the label to update, replace `pausedRef` with `useState` and use a setter inside the callback (with the ref pattern for the event listener).
