# Unified Show File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all show data into a single self-contained recording file with shared state across all tabs, add OSC-to-OSC-effect triggers, and add section linking on all trigger types.

**Architecture:** A `RecordingProvider` context (already exists at `src/contexts/recorder-context.tsx`) is expanded to include save/load IO and migration logic. The `Recording` type gains new fields for endpoints, effects, and triggers. Hooks (`useDmx`, `useOscEffects`, `useEndpoints`) become recording-aware — reading from the recording when loaded, falling back to global stores when not. The `OscDmxBridge` (main process) is removed; incoming OSC dispatch moves to a renderer hook mirroring how `useLiveMonitor` handles MIDI.

**Tech Stack:** TypeScript, React 19, Next.js 16 (app router), Electron 41, Tailwind v4

---

## File Map

### New files
| File | Purpose |
|------|---------|
| `src/hooks/use-osc-trigger-monitor.ts` | Renderer-side dispatch for incoming OSC → DMX triggers and OSC effect triggers |
| `src/components/osc-effect-trigger-panel.tsx` | UI panel for OSC → OSC Effect trigger CRUD (mirrors `osc-trigger-panel.tsx`) |

### Modified files
| File | Changes |
|------|---------|
| `src/lib/types.ts` | Add `OscEffectTrigger` type, add 6 new fields to `Recording` |
| `src/lib/dmx-types.ts` | Add `sectionId?: string` to `OscDmxTrigger` |
| `src/contexts/recorder-context.tsx` | Expand with save/load IO, migration on load, `loadedFromPath` |
| `src/hooks/use-recorder.ts` | No changes — context handles expansion |
| `src/hooks/use-dmx.ts` | Read from recording when loaded, else global store |
| `src/hooks/use-osc-effects.ts` | Same pattern |
| `src/hooks/use-osc.ts` | `useEndpoints` becomes recording-aware |
| `src/app/output/page.tsx` | Use recorder context, add trigger panel to OSC Effects tab |
| `src/app/deck/page.tsx` | Add `useOscTriggerMonitor`, remove direct endpoint fetch |
| `src/app/timeline/page.tsx` | Remove direct endpoint fetch (comes from recording now) |
| `src/components/sidebar.tsx` | Show recording name + unsaved indicator |
| `src/components/dmx/osc-trigger-panel.tsx` | Add section dropdown prop |
| `electron/ipc-handlers.ts` | Add `stores:get-seed-data` IPC, remove bridge wiring |
| `package.json` | Remove `electron/osc-dmx-bridge.ts` from esbuild entry |

### Deleted files
| File | Reason |
|------|--------|
| `electron/osc-dmx-bridge.ts` | Dispatch moves to renderer-side `useOscTriggerMonitor` |

---

### Task 1: Add Types

**Files:**
- Modify: `src/lib/types.ts:179-256`
- Modify: `src/lib/dmx-types.ts:34-45`

- [ ] **Step 1: Add `OscEffectTrigger` type to `src/lib/types.ts`**

Add after the `OscMapping` interface (after line 214):

```typescript
export interface OscEffectTrigger {
  id: string;
  name: string;
  sectionId?: string;
  oscAddress: string;
  oscEffectId: string;
  endpointId: string;
  targetAddress: string;
  argType: "f" | "i";
  velocityFromValue?: boolean;
}
```

- [ ] **Step 2: Add new fields to `Recording` interface in `src/lib/types.ts`**

Add after the existing `suppressedAnalysis` field (line 255), before the closing brace:

```typescript
  endpoints?: SavedEndpoint[];
  dmxConfig?: import("./dmx-types").SacnConfig;
  dmxEffects?: import("./dmx-types").DmxEffect[];
  dmxTriggers?: import("./dmx-types").OscDmxTrigger[];
  oscEffects?: import("./osc-effect-types").OscEffect[];
  oscEffectTriggers?: OscEffectTrigger[];
```

- [ ] **Step 3: Add `sectionId` to `OscDmxTrigger` in `src/lib/dmx-types.ts`**

Add after `outputMax` (line 44):

```typescript
  sectionId?: string;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output (no errors)

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/dmx-types.ts
git commit -m "feat: add OscEffectTrigger type, Recording show data fields, sectionId on DMX triggers"
```

---

### Task 2: Migration IPC — Seed Data Endpoint

**Files:**
- Modify: `electron/ipc-handlers.ts:25-38`

- [ ] **Step 1: Add `stores:get-seed-data` IPC handler**

Add after the `oscEffectEngine.loadEffects(...)` line (after line 36 in `ipc-handlers.ts`), before the DMX config check:

```typescript
  ipcMain.handle("stores:get-seed-data", () => ({
    endpoints: endpointsStore.getAll(),
    dmxConfig: dmxStore.getConfig(),
    dmxEffects: dmxStore.getEffects(),
    dmxTriggers: dmxStore.getTriggers(),
    oscEffects: oscEffectStore.getAll(),
  }));
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 3: Recompile electron**

Run: `pnpm electron:compile`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add electron/ipc-handlers.ts
git commit -m "feat: add stores:get-seed-data IPC for recording migration"
```

---

### Task 3: Expand RecorderContext with Save/Load and Migration

**Files:**
- Modify: `src/contexts/recorder-context.tsx`

The existing `RecorderProvider` wraps `useRecorder` and provides it via context. We need to expand it to include:
- Save/load IO (currently separate in `useRecordingIO`)
- `loadedFromPath` tracking
- Migration logic when loading legacy recordings

- [ ] **Step 1: Expand the RecorderContext type and provider**

Replace the entire contents of `src/contexts/recorder-context.tsx` with:

```typescript
"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useRecorder } from "@/hooks/use-recorder";
import { useMidiConfig } from "@/hooks/use-midi";
import type { MidiMappingRule, Recording } from "@/lib/types";

type RecorderBase = ReturnType<typeof useRecorder>;

interface RecorderContextValue extends RecorderBase {
  loadedFromPath: string | null;
  save: (suggestedPath?: string) => Promise<string | null>;
  saveAs: (suggestedPath?: string) => Promise<string | null>;
  loadFile: () => Promise<boolean>;
  loadFromPath: (filePath: string) => Promise<boolean>;
  loadProject: () => Promise<boolean>;
  saveProject: () => Promise<string | null>;
}

const RecorderContext = createContext<RecorderContextValue | null>(null);

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

async function migrateRecording(rec: Recording): Promise<Recording> {
  if (rec.endpoints && rec.dmxEffects && rec.dmxTriggers && rec.oscEffects) {
    return rec;
  }
  const api = getAPI();
  if (!api) return rec;
  const seed = (await api.invoke("stores:get-seed-data")) as {
    endpoints: any[];
    dmxConfig: any;
    dmxEffects: any[];
    dmxTriggers: any[];
    oscEffects: any[];
  };
  return {
    ...rec,
    endpoints: rec.endpoints ?? seed.endpoints,
    dmxConfig: rec.dmxConfig ?? seed.dmxConfig,
    dmxEffects: rec.dmxEffects ?? seed.dmxEffects,
    dmxTriggers: rec.dmxTriggers ?? seed.dmxTriggers,
    oscEffects: rec.oscEffects ?? seed.oscEffects,
    oscEffectTriggers: rec.oscEffectTriggers ?? [],
  };
}

export function RecorderProvider({ children }: { children: React.ReactNode }) {
  const { rules } = useMidiConfig();
  const rulesRef = useRef<MidiMappingRule[]>(rules);
  rulesRef.current = rules;

  const recorder = useRecorder({
    getMappingRulesSnapshot: () => rulesRef.current,
  });

  const [loadedFromPath, setLoadedFromPath] = useState<string | null>(null);

  const setLoadedWithMigration = useCallback(async (rec: Recording, path?: string) => {
    const migrated = await migrateRecording(rec);
    recorder.setLoaded(migrated);
    setLoadedFromPath(path ?? null);
  }, [recorder]);

  const save = useCallback(async (suggestedPath?: string) => {
    const api = getAPI();
    if (!api || !recorder.recording) return null;
    const pathToUse = suggestedPath ?? loadedFromPath ?? undefined;
    const res = (await api.invoke("recording:save", recorder.recording, pathToUse)) as
      | { path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res || "cancelled" in res) return null;
    recorder.markSaved();
    setLoadedFromPath(res.path);
    return res.path;
  }, [recorder, loadedFromPath]);

  const saveAs = useCallback(async (suggestedPath?: string) => {
    const api = getAPI();
    if (!api || !recorder.recording) return null;
    const res = (await api.invoke("recording:save-as", recorder.recording, suggestedPath)) as
      | { path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res || "cancelled" in res) return null;
    recorder.markSaved();
    setLoadedFromPath(res.path);
    return res.path;
  }, [recorder]);

  const loadFile = useCallback(async () => {
    const api = getAPI();
    if (!api) return false;
    const res = (await api.invoke("recording:load")) as
      | { recording: Recording; path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res || "cancelled" in res) return false;
    await setLoadedWithMigration(res.recording, res.path);
    return true;
  }, [setLoadedWithMigration]);

  const loadFromPath = useCallback(async (filePath: string) => {
    const api = getAPI();
    if (!api) return false;
    const res = (await api.invoke("recording:load-path", filePath)) as
      | { recording: Recording; path: string }
      | { error: string };
    if ("error" in res) return false;
    await setLoadedWithMigration(res.recording, res.path);
    return true;
  }, [setLoadedWithMigration]);

  const loadProject = useCallback(async () => {
    const api = getAPI();
    if (!api) return false;
    const res = (await api.invoke("recording:load-project")) as
      | { recording: Recording; path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res || "cancelled" in res) return false;
    await setLoadedWithMigration(res.recording, res.path);
    return true;
  }, [setLoadedWithMigration]);

  const saveProject = useCallback(async () => {
    const api = getAPI();
    if (!api || !recorder.recording) return null;
    const res = (await api.invoke("recording:save-project", recorder.recording)) as
      | { path: string }
      | { error: string };
    if ("error" in res) return null;
    recorder.markSaved();
    setLoadedFromPath(res.path);
    return res.path;
  }, [recorder]);

  const value: RecorderContextValue = {
    ...recorder,
    loadedFromPath,
    save,
    saveAs,
    loadFile,
    loadFromPath,
    loadProject,
    saveProject,
  };

  return (
    <RecorderContext.Provider value={value}>
      {children}
    </RecorderContext.Provider>
  );
}

export function useRecorderContext(): RecorderContextValue {
  const ctx = useContext(RecorderContext);
  if (!ctx) throw new Error("useRecorderContext must be used within RecorderProvider");
  return ctx;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output. The `setLoadedWithMigration` replaces the existing `setLoaded` calls but the original is still exposed via the spread `...recorder`.

- [ ] **Step 3: Commit**

```bash
git add src/contexts/recorder-context.tsx
git commit -m "feat: expand RecorderContext with save/load IO and migration"
```

---

### Task 4: Recording-Aware `useDmx`

**Files:**
- Modify: `src/hooks/use-dmx.ts`

The hook currently reads everything from the global store via IPC. Make it recording-aware: when a recording is loaded, read effects/triggers/config from the recording and write mutations via `patchRecording`. Fall back to global store when no recording.

- [ ] **Step 1: Rewrite `useDmx` to be recording-aware**

Replace the entire contents of `src/hooks/use-dmx.ts`:

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRecorderContext } from "@/contexts/recorder-context";
import type { DmxEffect, SacnConfig, OscDmxTrigger } from "@/lib/dmx-types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useDmx() {
  const { recording, patchRecording } = useRecorderContext();

  const [globalConfig, setGlobalConfig] = useState<SacnConfig>({ universe: 7, enabled: false });
  const [globalEffects, setGlobalEffects] = useState<DmxEffect[]>([]);
  const [globalTriggers, setGlobalTriggers] = useState<OscDmxTrigger[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const [c, e, t] = await Promise.all([
      api.invoke("dmx:get-config") as Promise<SacnConfig>,
      api.invoke("dmx:get-effects") as Promise<DmxEffect[]>,
      api.invoke("dmx:get-triggers") as Promise<OscDmxTrigger[]>,
    ]);
    setGlobalConfig(c);
    setGlobalEffects(e);
    setGlobalTriggers(t);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const config = recording?.dmxConfig ?? globalConfig;
  const effects = recording?.dmxEffects ?? globalEffects;
  const triggers = recording?.dmxTriggers ?? globalTriggers;

  const setConfig = useCallback(async (c: SacnConfig) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:set-config", c);
    if (recording) {
      patchRecording({ dmxConfig: c });
    } else {
      setGlobalConfig(c);
    }
  }, [recording, patchRecording]);

  const saveEffect = useCallback(async (effect: DmxEffect) => {
    if (recording) {
      const existing = recording.dmxEffects ?? [];
      const toSave = effect.id ? effect : { ...effect, id: crypto.randomUUID() };
      const idx = existing.findIndex((e) => e.id === toSave.id);
      const updated = idx >= 0
        ? existing.map((e, i) => (i === idx ? toSave : e))
        : [...existing, toSave];
      patchRecording({ dmxEffects: updated });
      // Also sync to engine so runtime triggering works
      const api = getAPI();
      if (api) await api.invoke("dmx:save-effect", toSave);
      return toSave;
    }
    const api = getAPI();
    if (!api) return effect;
    const saved = (await api.invoke("dmx:save-effect", effect)) as DmxEffect;
    setGlobalEffects((prev) => {
      const idx = prev.findIndex((e) => e.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved];
    });
    return saved;
  }, [recording, patchRecording]);

  const deleteEffect = useCallback(async (id: string) => {
    if (recording) {
      patchRecording({ dmxEffects: (recording.dmxEffects ?? []).filter((e) => e.id !== id) });
      const api = getAPI();
      if (api) await api.invoke("dmx:delete-effect", id);
      return;
    }
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:delete-effect", id);
    setGlobalEffects((prev) => prev.filter((e) => e.id !== id));
  }, [recording, patchRecording]);

  const triggerEffect = useCallback(async (effectId: string, velocityScale?: number) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:trigger-effect", effectId, velocityScale);
  }, []);

  const stopEffect = useCallback(async (effectId: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:stop-effect", effectId);
  }, []);

  const setChannel = useCallback(async (channel: number, value: number) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:set-channel", channel, value);
  }, []);

  const releaseChannel = useCallback(async (channel: number) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:release-channel", channel);
  }, []);

  const saveTrigger = useCallback(async (trigger: OscDmxTrigger) => {
    if (recording) {
      const existing = recording.dmxTriggers ?? [];
      const toSave = trigger.id ? trigger : { ...trigger, id: crypto.randomUUID() };
      const idx = existing.findIndex((t) => t.id === toSave.id);
      const updated = idx >= 0
        ? existing.map((t, i) => (i === idx ? toSave : t))
        : [...existing, toSave];
      patchRecording({ dmxTriggers: updated });
      return;
    }
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:save-trigger", trigger);
    await refresh();
  }, [recording, patchRecording, refresh]);

  const deleteTrigger = useCallback(async (id: string) => {
    if (recording) {
      patchRecording({ dmxTriggers: (recording.dmxTriggers ?? []).filter((t) => t.id !== id) });
      return;
    }
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:delete-trigger", id);
    setGlobalTriggers((prev) => prev.filter((t) => t.id !== id));
  }, [recording, patchRecording]);

  const getBuffer = useCallback(async () => {
    const api = getAPI();
    if (!api) return new Uint8Array(512);
    return (await api.invoke("dmx:get-buffer")) as Uint8Array;
  }, []);

  return {
    config, effects, triggers,
    setConfig, saveEffect, deleteEffect,
    triggerEffect, stopEffect,
    setChannel, releaseChannel, getBuffer,
    saveTrigger, deleteTrigger,
    refresh,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-dmx.ts
git commit -m "feat: make useDmx recording-aware with global store fallback"
```

---

### Task 5: Recording-Aware `useOscEffects`

**Files:**
- Modify: `src/hooks/use-osc-effects.ts`

Same pattern as Task 4: read from recording when loaded, fallback to global store.

- [ ] **Step 1: Rewrite `useOscEffects` to be recording-aware**

Replace the entire contents of `src/hooks/use-osc-effects.ts`:

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRecorderContext } from "@/contexts/recorder-context";
import type { OscEffect } from "@/lib/osc-effect-types";
import type { OscEffectTrigger } from "@/lib/types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useOscEffects() {
  const { recording, patchRecording } = useRecorderContext();

  const [globalEffects, setGlobalEffects] = useState<OscEffect[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const list = (await api.invoke("osc-effect:get-all")) as OscEffect[];
    setGlobalEffects(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const effects = recording?.oscEffects ?? globalEffects;
  const triggers = recording?.oscEffectTriggers ?? [];

  const saveEffect = useCallback(async (effect: OscEffect) => {
    if (recording) {
      const existing = recording.oscEffects ?? [];
      const toSave = effect.id ? effect : { ...effect, id: crypto.randomUUID() };
      const idx = existing.findIndex((e) => e.id === toSave.id);
      const updated = idx >= 0
        ? existing.map((e, i) => (i === idx ? toSave : e))
        : [...existing, toSave];
      patchRecording({ oscEffects: updated });
      // Sync to engine for runtime triggering
      const api = getAPI();
      if (api) await api.invoke("osc-effect:save", toSave);
      return toSave;
    }
    const api = getAPI();
    if (!api) return effect;
    const saved = (await api.invoke("osc-effect:save", effect)) as OscEffect;
    setGlobalEffects((prev) => {
      const idx = prev.findIndex((e) => e.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved];
    });
    return saved;
  }, [recording, patchRecording]);

  const deleteEffect = useCallback(async (id: string) => {
    if (recording) {
      patchRecording({ oscEffects: (recording.oscEffects ?? []).filter((e) => e.id !== id) });
      const api = getAPI();
      if (api) await api.invoke("osc-effect:delete", id);
      return;
    }
    const api = getAPI();
    if (!api) return;
    await api.invoke("osc-effect:delete", id);
    setGlobalEffects((prev) => prev.filter((e) => e.id !== id));
  }, [recording, patchRecording]);

  const saveTrigger = useCallback(async (trigger: OscEffectTrigger) => {
    if (!recording) return;
    const existing = recording.oscEffectTriggers ?? [];
    const toSave = trigger.id ? trigger : { ...trigger, id: crypto.randomUUID() };
    const idx = existing.findIndex((t) => t.id === toSave.id);
    const updated = idx >= 0
      ? existing.map((t, i) => (i === idx ? toSave : t))
      : [...existing, toSave];
    patchRecording({ oscEffectTriggers: updated });
  }, [recording, patchRecording]);

  const deleteTrigger = useCallback(async (id: string) => {
    if (!recording) return;
    patchRecording({ oscEffectTriggers: (recording.oscEffectTriggers ?? []).filter((t) => t.id !== id) });
  }, [recording, patchRecording]);

  const triggerEffect = useCallback(async (
    effectId: string,
    target: { host: string; port: number; address: string; argType: "f" | "i" },
    velocityScale?: number,
  ) => {
    const api = getAPI();
    if (!api) return null;
    return (await api.invoke("osc-effect:trigger", effectId, target, velocityScale)) as string;
  }, []);

  const releaseEffect = useCallback(async (instanceId: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("osc-effect:release", instanceId);
  }, []);

  const stopEffect = useCallback(async (instanceId: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("osc-effect:stop", instanceId);
  }, []);

  return {
    effects, triggers,
    saveEffect, deleteEffect,
    saveTrigger, deleteTrigger,
    triggerEffect, releaseEffect, stopEffect,
    refresh,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-osc-effects.ts
git commit -m "feat: make useOscEffects recording-aware with trigger CRUD"
```

---

### Task 6: Recording-Aware `useEndpoints`

**Files:**
- Modify: `src/hooks/use-osc.ts:133-179`

Only the `useEndpoints` function changes. The other exports (`useOscListener`, `useOscThroughput`, `useOscSender`, `useWebServer`) stay as-is.

- [ ] **Step 1: Rewrite the `useEndpoints` function in `src/hooks/use-osc.ts`**

Replace the `useEndpoints` function (starts at line 133) through the end of its return (line 179):

```typescript
export function useEndpoints(type: "listener" | "sender") {
  const { recording, patchRecording } = useRecorderContext();

  const [globalEndpoints, setGlobalEndpoints] = useState<SavedEndpoint[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const all = (await api.invoke("endpoints:get-all", type)) as SavedEndpoint[];
    setGlobalEndpoints(all);
  }, [type]);

  useEffect(() => { refresh(); }, [refresh]);

  const allRecEndpoints = recording?.endpoints ?? null;
  const endpoints = allRecEndpoints
    ? allRecEndpoints.filter((ep) => ep.type === type)
    : globalEndpoints;

  const add = useCallback(async (endpoint: Omit<SavedEndpoint, "id">) => {
    const full: SavedEndpoint = { ...endpoint, id: crypto.randomUUID() };
    if (recording) {
      patchRecording({ endpoints: [...(recording.endpoints ?? []), full] });
      // Also register with main process so listeners/senders are actually created
      const api = getAPI();
      if (api) await api.invoke("endpoints:add", endpoint);
      return;
    }
    const api = getAPI();
    if (!api) {
      setGlobalEndpoints((prev) => [...prev, full]);
      return;
    }
    await api.invoke("endpoints:add", endpoint);
    await refresh();
  }, [recording, patchRecording, refresh]);

  const update = useCallback(async (id: string, updates: Partial<Omit<SavedEndpoint, "id">>) => {
    if (recording) {
      patchRecording({
        endpoints: (recording.endpoints ?? []).map((ep) =>
          ep.id === id ? { ...ep, ...updates } : ep
        ),
      });
      const api = getAPI();
      if (api) await api.invoke("endpoints:update", id, updates);
      return;
    }
    const api = getAPI();
    if (!api) {
      setGlobalEndpoints((prev) => prev.map((ep) => ep.id === id ? { ...ep, ...updates } : ep));
      return;
    }
    await api.invoke("endpoints:update", id, updates);
    await refresh();
  }, [recording, patchRecording, refresh]);

  const remove = useCallback(async (id: string) => {
    if (recording) {
      patchRecording({ endpoints: (recording.endpoints ?? []).filter((ep) => ep.id !== id) });
      const api = getAPI();
      if (api) await api.invoke("endpoints:remove", id);
      return;
    }
    const api = getAPI();
    if (!api) {
      setGlobalEndpoints((prev) => prev.filter((ep) => ep.id !== id));
      return;
    }
    await api.invoke("endpoints:remove", id);
    await refresh();
  }, [recording, patchRecording, refresh]);

  return { endpoints, add, update, remove, refresh };
}
```

- [ ] **Step 2: Add the missing import**

At the top of `src/hooks/use-osc.ts`, add to the existing imports:

```typescript
import { useRecorderContext } from "@/contexts/recorder-context";
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-osc.ts
git commit -m "feat: make useEndpoints recording-aware with global store fallback"
```

---

### Task 7: Update Pages to Use Shared Context for IO

**Files:**
- Modify: `src/app/timeline/page.tsx`
- Modify: `src/app/deck/page.tsx`

Both pages currently fetch endpoints independently via `window.electronAPI?.invoke("endpoints:get-all", "sender")`. Now that `useEndpoints` reads from the recording, these manual fetches should be replaced. Both pages also use `useRecordingIO` for save/load — this now comes from the recorder context.

- [ ] **Step 1: Update timeline page — remove manual endpoint fetch**

In `src/app/timeline/page.tsx`, find the endpoint state and useEffect (around lines 48-51):

```typescript
  const [endpoints, setEndpoints] = useState<SavedEndpoint[]>([]);

  useEffect(() => {
    window.electronAPI?.invoke("endpoints:get-all", "sender").then((res) => {
      setEndpoints((res as SavedEndpoint[]) ?? []);
    });
  }, []);
```

Replace with:

```typescript
  const { endpoints: senderEndpoints } = useEndpoints("sender");
```

Add the import at the top:

```typescript
import { useEndpoints } from "@/hooks/use-osc";
```

Then replace all references to `endpoints` (the old state variable) with `senderEndpoints` throughout the file — specifically in the `useOscPlayback` call and anywhere else `endpoints` is passed as a prop.

- [ ] **Step 2: Update timeline page — use context IO for save/load**

The timeline page currently uses `useRecordingIO()` (line 38). Replace all uses of `io.save(...)`, `io.saveAs(...)`, `io.load()`, `io.loadPath(...)`, `io.loadProject()`, `io.saveProject(...)`, `io.pickAudio()`, `io.readAudioBytes(...)` with the equivalent from the recorder context where applicable.

The save/load/loadProject/saveProject methods are now on the recorder context. Keep `pickAudio` and `readAudioBytes` from `useRecordingIO` since those are not recording-state operations.

Change the `io` destructure to only pull what's still needed:

```typescript
  const { pickAudio, readAudioBytes, importMidi, recent, refreshRecent, getProjectDir, pickProjectDir } = useRecordingIO();
```

And use `recorder.save()`, `recorder.saveAs()`, `recorder.loadFile()`, `recorder.loadFromPath()`, `recorder.loadProject()`, `recorder.saveProject()` in place of the old `io` methods.

Where the old code does:
```typescript
const res = await io.load();
if (res) { recorder.setLoaded(res.recording); setSaveSuggestedPath(res.path); }
```

Replace with:
```typescript
await recorder.loadFile();
```

The migration and path tracking are handled internally by the context now.

- [ ] **Step 3: Update deck page — remove manual endpoint fetch**

In `src/app/deck/page.tsx`, find the manual endpoint fetch (around lines 71-74):

```typescript
  useEffect(() => {
    window.electronAPI?.invoke("endpoints:get-all", "sender").then((res: any) => {
      setLiveEndpoints((res as SavedEndpoint[]) ?? []);
    });
  }, []);
```

And the state declaration (line 69):

```typescript
  const [liveEndpoints, setLiveEndpoints] = useState<SavedEndpoint[]>([]);
```

Replace both with:

```typescript
  const { endpoints: liveEndpoints } = useEndpoints("sender");
```

Add the import (it's already imported from `use-osc` on line 5 but destructures differently — adjust):

The deck page already has `import { useEndpoints } from "@/hooks/use-osc"` on line 5. Update the `liveEndpoints` usage to use the hook directly and remove the manual fetch + state.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 5: Commit**

```bash
git add src/app/timeline/page.tsx src/app/deck/page.tsx
git commit -m "refactor: use shared context for save/load and recording-aware endpoints"
```

---

### Task 8: Remove OscDmxBridge

**Files:**
- Delete: `electron/osc-dmx-bridge.ts`
- Modify: `electron/ipc-handlers.ts`
- Modify: `package.json`

- [ ] **Step 1: Remove bridge instantiation from `ipc-handlers.ts`**

Remove the import (line 12):
```typescript
import { OscDmxBridge } from "./osc-dmx-bridge";
```

Remove the instantiation (line 29):
```typescript
const oscDmxBridge = new OscDmxBridge(oscManager, dmxEngine);
```

Remove the trigger loading (line 32):
```typescript
oscDmxBridge.loadTriggers(dmxStore.getTriggers());
```

Search for any other references to `oscDmxBridge` in the file — specifically in the `dmx:save-trigger` and `dmx:delete-trigger` handlers where the bridge gets reloaded. Remove those reload calls:

```typescript
oscDmxBridge.loadTriggers(dmxStore.getTriggers());
```

Keep the `dmx:save-trigger` and `dmx:delete-trigger` IPC handlers themselves (they still write to the global store for the no-recording fallback).

- [ ] **Step 2: Delete `electron/osc-dmx-bridge.ts`**

```bash
rm electron/osc-dmx-bridge.ts
```

- [ ] **Step 3: Remove from esbuild entry in `package.json`**

In `package.json`, find the `electron:compile` script and remove `electron/osc-dmx-bridge.ts` from the esbuild entry list.

- [ ] **Step 4: Recompile and verify**

Run: `pnpm electron:compile`
Expected: Clean build

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 5: Commit**

```bash
git add electron/ipc-handlers.ts package.json
git rm electron/osc-dmx-bridge.ts
git commit -m "refactor: remove OscDmxBridge, dispatch moves to renderer"
```

---

### Task 9: `useOscTriggerMonitor` Hook

**Files:**
- Create: `src/hooks/use-osc-trigger-monitor.ts`

This hook subscribes to incoming OSC messages (via the existing `osc:messages` channel) and dispatches to DMX engine and OSC effect engine based on the recording's triggers, filtered by active section.

- [ ] **Step 1: Create `src/hooks/use-osc-trigger-monitor.ts`**

```typescript
"use client";

import { useEffect, useRef } from "react";
import { useOscListener } from "@/hooks/use-osc";
import type { OscMessage, Recording, SavedEndpoint, OscEffectTrigger } from "@/lib/types";
import type { OscDmxTrigger } from "@/lib/dmx-types";

interface UseOscTriggerMonitorArgs {
  recording: Recording | null;
  activeSectionId?: string | null;
}

function extractNumericArg(msg: OscMessage): number | null {
  if (!msg.args || msg.args.length === 0) return null;
  const arg = msg.args[0];
  if (typeof arg.value === "number") return arg.value;
  return null;
}

export function useOscTriggerMonitor({ recording, activeSectionId }: UseOscTriggerMonitorArgs) {
  const recordingRef = useRef(recording);
  const activeSectionIdRef = useRef(activeSectionId);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => { activeSectionIdRef.current = activeSectionId; }, [activeSectionId]);

  useOscListener((msgs: OscMessage[]) => {
    const rec = recordingRef.current;
    if (!rec) return;
    const sectionId = activeSectionIdRef.current;
    const dmxTriggers = rec.dmxTriggers ?? [];
    const oscTriggers = rec.oscEffectTriggers ?? [];
    const endpoints = rec.endpoints ?? [];

    for (const msg of msgs) {
      // --- DMX triggers ---
      for (const trigger of dmxTriggers) {
        if (msg.address !== trigger.oscAddress) continue;
        if (trigger.sectionId && trigger.sectionId !== sectionId) continue;

        if (trigger.mode === "match-only" && trigger.dmxEffectId) {
          const value = extractNumericArg(msg);
          const velocityScale = value != null ? Math.max(0, Math.min(1, value)) : 1;
          window.electronAPI?.invoke("dmx:trigger-effect", trigger.dmxEffectId, velocityScale);
        } else if (trigger.mode === "passthrough") {
          const rawValue = extractNumericArg(msg);
          if (rawValue === null) continue;
          const inMin = trigger.inputMin ?? 0;
          const inMax = trigger.inputMax ?? 1;
          const outMin = trigger.outputMin ?? 0;
          const outMax = trigger.outputMax ?? 255;
          const ratio = inMax !== inMin ? (rawValue - inMin) / (inMax - inMin) : 0;
          const dmxValue = outMin + ratio * (outMax - outMin);
          const channels = trigger.dmxChannels ?? [];
          for (const ch of channels) {
            window.electronAPI?.invoke("dmx:set-channel", ch, dmxValue);
          }
        }
      }

      // --- OSC effect triggers ---
      for (const trigger of oscTriggers) {
        if (msg.address !== trigger.oscAddress) continue;
        if (trigger.sectionId && trigger.sectionId !== sectionId) continue;

        const endpoint = endpoints.find((ep) => ep.id === trigger.endpointId);
        if (!endpoint) continue;

        const value = extractNumericArg(msg);
        const velocityScale = trigger.velocityFromValue && value != null
          ? Math.max(0, Math.min(1, value))
          : 1;

        window.electronAPI?.invoke("osc-effect:trigger", trigger.oscEffectId, {
          host: endpoint.host,
          port: endpoint.port,
          address: trigger.targetAddress,
          argType: trigger.argType,
        }, velocityScale);
      }
    }
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-osc-trigger-monitor.ts
git commit -m "feat: add useOscTriggerMonitor for renderer-side OSC trigger dispatch"
```

---

### Task 10: Wire `useOscTriggerMonitor` in Deck Page

**Files:**
- Modify: `src/app/deck/page.tsx`

- [ ] **Step 1: Add the hook to the deck page**

Add the import at the top of `src/app/deck/page.tsx`:

```typescript
import { useOscTriggerMonitor } from "@/hooks/use-osc-trigger-monitor";
```

Add the hook call inside `DeckPage()`, after the `useLiveMonitor` call (around line 77):

```typescript
  useOscTriggerMonitor({
    recording: recorder.recording,
    activeSectionId,
  });
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 3: Commit**

```bash
git add src/app/deck/page.tsx
git commit -m "feat: wire useOscTriggerMonitor in deck page for live OSC trigger dispatch"
```

---

### Task 11: OSC Effect Trigger Panel UI

**Files:**
- Create: `src/components/osc-effect-trigger-panel.tsx`
- Modify: `src/app/output/page.tsx`

- [ ] **Step 1: Create the trigger panel component**

Create `src/components/osc-effect-trigger-panel.tsx`:

```typescript
"use client";

import { useState } from "react";
import type { OscEffectTrigger, SavedEndpoint, TimelineSection } from "@/lib/types";
import type { OscEffect } from "@/lib/osc-effect-types";

interface OscEffectTriggerPanelProps {
  triggers: OscEffectTrigger[];
  effects: OscEffect[];
  endpoints: SavedEndpoint[];
  sections: TimelineSection[];
  onSave: (trigger: OscEffectTrigger) => void;
  onDelete: (id: string) => void;
}

function emptyTrigger(): OscEffectTrigger {
  return { id: "", name: "", oscAddress: "", oscEffectId: "", endpointId: "", targetAddress: "", argType: "f" };
}

export function OscEffectTriggerPanel({ triggers, effects, endpoints, sections, onSave, onDelete }: OscEffectTriggerPanelProps) {
  const [editing, setEditing] = useState<OscEffectTrigger | null>(null);
  const senderEndpoints = endpoints.filter((ep) => ep.type === "sender");

  const startEdit = (t?: OscEffectTrigger) => setEditing(t ? { ...t } : emptyTrigger());

  const handleSave = () => {
    if (!editing) return;
    onSave(editing);
    setEditing(null);
  };

  if (editing) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white">{editing.id ? "Edit" : "Add"} OSC → Effect Trigger</h3>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Name</label>
          <input
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">OSC Address (incoming)</label>
          <input
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white font-mono"
            placeholder="/cue/go"
            value={editing.oscAddress}
            onChange={(e) => setEditing({ ...editing, oscAddress: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">OSC Effect</label>
          <select
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={editing.oscEffectId}
            onChange={(e) => setEditing({ ...editing, oscEffectId: e.target.value })}
          >
            <option value="">None</option>
            {effects.map((eff) => (
              <option key={eff.id} value={eff.id}>{eff.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Target Endpoint</label>
          <select
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={editing.endpointId}
            onChange={(e) => setEditing({ ...editing, endpointId: e.target.value })}
          >
            <option value="">Select endpoint</option>
            {senderEndpoints.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.name} ({ep.host}:{ep.port})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Target Address (output)</label>
          <input
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white font-mono"
            placeholder="/composition/opacity"
            value={editing.targetAddress}
            onChange={(e) => setEditing({ ...editing, targetAddress: e.target.value })}
          />
        </div>

        <div className="flex gap-3">
          <div>
            <label className="block text-[10px] uppercase text-gray-500 mb-1">Arg Type</label>
            <div className="flex gap-1">
              {(["f", "i"] as const).map((t) => (
                <button
                  key={t}
                  className="px-3 py-1 text-xs rounded border"
                  style={{
                    background: editing.argType === t ? "rgba(59,130,246,0.15)" : "#1a1a2e",
                    borderColor: editing.argType === t ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.08)",
                    color: editing.argType === t ? "#93c5fd" : "#9ca3af",
                  }}
                  onClick={() => setEditing({ ...editing, argType: t })}
                >
                  {t === "f" ? "Float" : "Int"}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer self-end pb-1">
            <input
              type="checkbox"
              checked={editing.velocityFromValue ?? false}
              onChange={(e) => setEditing({ ...editing, velocityFromValue: e.target.checked })}
              className="accent-blue-500"
            />
            <span className="text-xs text-gray-300">Velocity from Value</span>
          </label>
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Section</label>
          <select
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={editing.sectionId ?? ""}
            onChange={(e) => setEditing({ ...editing, sectionId: e.target.value || undefined })}
          >
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button className="px-3 py-1 rounded bg-blue-500 hover:bg-blue-400 text-black text-xs font-medium" onClick={handleSave}>Save</button>
          <button className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">OSC → Effect Triggers</h3>
        <button className="text-xs text-blue-400 hover:text-blue-300" onClick={() => startEdit()}>+ Add</button>
      </div>
      {triggers.length === 0 && <p className="text-xs text-gray-600">No triggers configured</p>}
      {triggers.map((t) => {
        const effectName = effects.find((e) => e.id === t.oscEffectId)?.name ?? "—";
        const sectionName = sections.find((s) => s.id === t.sectionId)?.name;
        return (
          <div key={t.id} className="flex items-center justify-between bg-[#1a1a2e] rounded px-3 py-2 border border-white/5">
            <div>
              <div className="text-xs text-white">{t.name || t.oscAddress}</div>
              <div className="text-[9px] text-gray-500">
                {t.oscAddress} → {effectName}
                {sectionName && <span> · <span className="text-blue-400/60">{sectionName}</span></span>}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="text-[10px] text-gray-400 hover:text-white" onClick={() => startEdit(t)}>Edit</button>
              <button className="text-[10px] text-red-400/60 hover:text-red-400" onClick={() => onDelete(t.id)}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add the trigger panel to the OscEffectsPanel in `output/page.tsx`**

In `src/app/output/page.tsx`, modify the `OscEffectsPanel` function.

Add the import at the top of the file:
```typescript
import { OscEffectTriggerPanel } from "@/components/osc-effect-trigger-panel";
import { useRecorderContext } from "@/contexts/recorder-context";
```

Modify the `OscEffectsPanel` function to use the trigger CRUD from `useOscEffects`:

At the start of `OscEffectsPanel` (around line 697), update the hook destructure:

```typescript
function OscEffectsPanel() {
  const { effects: oscEffects, saveEffect: saveOscEffect, deleteEffect: deleteOscEffect, triggers: oscTriggers, saveTrigger: saveOscTrigger, deleteTrigger: deleteOscTrigger } = useOscEffects();
  const recorder = useRecorderContext();
  const senderEndpoints = (recorder.recording?.endpoints ?? []).filter((ep) => ep.type === "sender");
  const sections = recorder.recording?.sections ?? [];
```

Then, after the effect editor closing `)}` and before the closing `</div></div>` of `OscEffectsPanel` (around line 1049-1051), add the trigger panel section:

```typescript
        {/* OSC Effect Triggers */}
        {!editingEffect && (
          <section className="bg-elevated rounded-lg border border-white/5 p-4">
            <OscEffectTriggerPanel
              triggers={oscTriggers}
              effects={oscEffects}
              endpoints={recorder.recording?.endpoints ?? []}
              sections={sections}
              onSave={saveOscTrigger}
              onDelete={deleteOscTrigger}
            />
          </section>
        )}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 4: Commit**

```bash
git add src/components/osc-effect-trigger-panel.tsx src/app/output/page.tsx
git commit -m "feat: add OSC effect trigger panel to Output page OSC Effects tab"
```

---

### Task 12: Section Dropdown on DMX Trigger Panel

**Files:**
- Modify: `src/components/dmx/osc-trigger-panel.tsx`
- Modify: `src/app/output/page.tsx` (DmxPanel section)

- [ ] **Step 1: Add `sections` prop to `OscTriggerPanel`**

In `src/components/dmx/osc-trigger-panel.tsx`, update the props interface (line 6-11):

```typescript
interface OscTriggerPanelProps {
  triggers: OscDmxTrigger[];
  effects: DmxEffect[];
  sections: import("@/lib/types").TimelineSection[];
  onSave: (trigger: OscDmxTrigger) => void;
  onDelete: (id: string) => void;
}
```

Update the destructure (line 17):

```typescript
export function OscTriggerPanel({ triggers, effects, sections, onSave, onDelete }: OscTriggerPanelProps) {
```

- [ ] **Step 2: Add `sectionId` to `emptyTrigger`**

Update `emptyTrigger()` (line 13-14):

```typescript
function emptyTrigger(): OscDmxTrigger {
  return { id: "", name: "", oscAddress: "", mode: "match-only", dmxEffectId: "", dmxChannels: [], inputMin: 0, inputMax: 1, outputMin: 0, outputMax: 255, sectionId: undefined };
}
```

- [ ] **Step 3: Add section dropdown to the editor**

In the editor section of `OscTriggerPanel`, add after the passthrough mode fields block (after the closing `</>` of the passthrough section, around line 134), before the Save/Cancel buttons:

```typescript
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Section</label>
          <select
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={editing.sectionId ?? ""}
            onChange={(e) => setEditing({ ...editing, sectionId: e.target.value || undefined })}
          >
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
```

- [ ] **Step 4: Show section name in trigger list**

In the trigger list row (around line 155), update the subtitle to show the section name:

```typescript
            <div className="text-[9px] text-gray-500">
              {t.oscAddress} · {t.mode}
              {t.sectionId && sections.find((s) => s.id === t.sectionId) && (
                <span> · <span className="text-output/60">{sections.find((s) => s.id === t.sectionId)!.name}</span></span>
              )}
            </div>
```

- [ ] **Step 5: Pass `sections` from DmxPanel in `output/page.tsx`**

In `src/app/output/page.tsx`, in the `DmxPanel` function, add recorder context access and pass sections to the trigger panel.

At the top of `DmxPanel` (around line 324), add:

```typescript
  const recorder = useRecorderContext();
  const sections = recorder.recording?.sections ?? [];
```

Update the `OscTriggerPanel` render (around line 682):

```typescript
            <OscTriggerPanel
              triggers={triggers}
              effects={effects}
              sections={sections}
              onSave={saveTrigger}
              onDelete={deleteTrigger}
            />
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 7: Commit**

```bash
git add src/components/dmx/osc-trigger-panel.tsx src/app/output/page.tsx
git commit -m "feat: add section dropdown to DMX trigger panel"
```

---

### Task 13: Sidebar Recording Info

**Files:**
- Modify: `src/components/sidebar.tsx`

Add recording name and unsaved indicator below the nav items. The sidebar is a simple nav component — we add the recorder context and a small info section.

- [ ] **Step 1: Add recording info to sidebar**

In `src/components/sidebar.tsx`, add the import:

```typescript
import { useRecorderContext } from "@/contexts/recorder-context";
```

Inside the `Sidebar` function, after `const pathname = usePathname();` (line 61), add:

```typescript
  const recorder = useRecorderContext();
  const recName = recorder.recording?.name;
```

After the nav items map closing `})}` (line 95), before the closing `</nav>` (line 97), add a spacer and recording info:

```typescript
      <div className="flex-1" />
      {recName && (
        <div className="px-3 py-2 border-t border-white/[0.04]">
          <div className="flex items-center gap-1.5 min-w-0">
            {recorder.hasUnsaved && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            )}
            <span className="text-[11px] text-gray-500 truncate" title={recName}>{recName}</span>
          </div>
        </div>
      )}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean output

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat: show recording name and unsaved indicator in sidebar"
```

---

### Task 14: Cleanup and Compile Verification

**Files:**
- Modify: `package.json`
- Verify all files

- [ ] **Step 1: Remove `osc-dmx-bridge.ts` from esbuild entry in `package.json`**

If not already done in Task 8, remove `electron/osc-dmx-bridge.ts` from the `electron:compile` script entry list in `package.json`.

- [ ] **Step 2: Full TypeScript compile check**

Run: `npx tsc --noEmit`
Expected: Clean output (zero errors)

- [ ] **Step 3: Electron recompile**

Run: `pnpm electron:compile`
Expected: Clean build

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: cleanup and compile verification"
```
