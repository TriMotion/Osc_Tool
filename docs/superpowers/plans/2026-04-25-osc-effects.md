# OSC Effects System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add curve/loop-based OSC message generation to Oscilot, mirroring the existing DMX effects architecture. Enables animated OSC output (fades, pulses, multi-step sequences) triggered by MIDI mappings, targeting Resolume and other OSC receivers.

**Architecture:** Mirror the DMX effects pattern: types → store → engine → IPC → hook → UI. The engine runs in Electron main, reuses `interpolateCurve()` and `CurveDefinition` from the DMX system, and sends via `OscManager.sendMessage()`. Each running effect instance is independently tracked, targets a specific endpoint + address, and supports one-shot and sustained modes.

**Tech Stack:** TypeScript, Electron IPC, Node.js timers, existing OscManager/interpolateCurve infrastructure, React hooks, Tailwind CSS.

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `src/lib/osc-effect-types.ts` | `OscEffect`, `OscEffectSegment` types |
| `electron/osc-effect-store.ts` | CRUD persistence to `userData/osc-effects.json` |
| `electron/osc-effect-engine.ts` | Tick-based effect runner, sends OSC via OscManager |
| `src/hooks/use-osc-effects.ts` | Frontend hook: fetch, save, delete, trigger, release, stop |

### Modified files
| File | Change |
|---|---|
| `src/lib/types.ts` | Add `oscEffectId?: string` to `OscMapping` |
| `electron/ipc-handlers.ts` | Register OSC effect IPC channels, instantiate store + engine |
| `src/hooks/use-live-monitor.ts` | Route mappings with `oscEffectId` through effect engine |
| `src/app/output/page.tsx` | OSC Effects list + editor UI section |
| `src/components/live/mapping-config-panel.tsx` | Effect dropdown in OSC mapping row |
| `src/components/timeline/osc-mapping-editor.tsx` | Effect dropdown in timeline mapping editor |

---

### Task 1: OSC Effect Types

**Files:**
- Create: `src/lib/osc-effect-types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/lib/osc-effect-types.ts
import type { CurveDefinition } from "./dmx-types";

export interface OscEffectSegment {
  startValue: number;
  endValue: number;
  durationMs: number;
  curve: CurveDefinition;
  holdMs: number;
}

export interface OscEffect {
  id: string;
  name: string;
  segments: OscEffectSegment[];
  loop: boolean;
  velocitySensitive: boolean;
  mode: "one-shot" | "sustained";
  releaseSegment?: OscEffectSegment;
  tickRateHz: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `osc-effect-types.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/osc-effect-types.ts
git commit -m "feat: add OscEffect and OscEffectSegment type definitions"
```

---

### Task 2: OSC Effect Store

**Files:**
- Create: `electron/osc-effect-store.ts`

Mirrors `electron/dmx-store.ts` (lines 1–92). Simpler — only stores effects, no config or triggers.

- [ ] **Step 1: Create the store file**

```typescript
// electron/osc-effect-store.ts
import { app } from "electron";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { OscEffect } from "../src/lib/osc-effect-types";

export class OscEffectStore {
  private filePath: string;
  private effects: OscEffect[] = [];

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "osc-effects.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.effects = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      }
    } catch {
      this.effects = [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.effects, null, 2));
  }

  getAll(): OscEffect[] {
    return this.effects;
  }

  saveEffect(effect: OscEffect): OscEffect {
    if (!effect.id) effect.id = randomUUID();
    const idx = this.effects.findIndex((e) => e.id === effect.id);
    if (idx >= 0) this.effects[idx] = effect;
    else this.effects.push(effect);
    this.save();
    return effect;
  }

  deleteEffect(id: string): void {
    this.effects = this.effects.filter((e) => e.id !== id);
    this.save();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `osc-effect-store.ts`

- [ ] **Step 3: Commit**

```bash
git add electron/osc-effect-store.ts
git commit -m "feat: add OscEffectStore for CRUD persistence"
```

---

### Task 3: OSC Effect Engine

**Files:**
- Create: `electron/osc-effect-engine.ts`

Mirrors `electron/dmx-engine.ts` (lines 1–187) but adapted for OSC output. Key differences from DMX: float values instead of 0–255, target is endpoint+address per instance (not channels), supports sustained mode with release segments, configurable tick rate per effect.

- [ ] **Step 1: Create the engine file**

```typescript
// electron/osc-effect-engine.ts
import type { OscEffect } from "../src/lib/osc-effect-types";
import type { OscManager } from "./osc-manager";
import type { SenderConfig, OscArg } from "../src/lib/types";
import { interpolateCurve } from "../src/lib/dmx-curves";

interface OscEffectTarget {
  host: string;
  port: number;
  address: string;
  argType: "f" | "i";
}

interface RunningOscEffect {
  instanceId: string;
  effect: OscEffect;
  target: OscEffectTarget;
  segmentIndex: number;
  segmentStartTime: number;
  velocityScale: number;
  releasing: boolean;
}

export class OscEffectEngine {
  private effects = new Map<string, OscEffect>();
  private activeEffects: RunningOscEffect[] = [];
  private intervalId: NodeJS.Timeout | null = null;
  private oscManager: OscManager;
  private instanceCounter = 0;

  constructor(oscManager: OscManager) {
    this.oscManager = oscManager;
  }

  loadEffects(effects: OscEffect[]): void {
    this.effects.clear();
    for (const e of effects) this.effects.set(e.id, e);
  }

  triggerEffect(
    effectId: string,
    target: OscEffectTarget,
    velocityScale = 1,
  ): string | null {
    const effect = this.effects.get(effectId);
    if (!effect || effect.segments.length === 0) return null;

    const instanceId = `osc-fx-${++this.instanceCounter}`;
    const now = Date.now();

    this.activeEffects.push({
      instanceId,
      effect,
      target,
      segmentIndex: 0,
      segmentStartTime: now,
      velocityScale: effect.velocitySensitive ? velocityScale : 1,
      releasing: false,
    });

    this.ensureLoop();
    return instanceId;
  }

  releaseEffect(instanceId: string): void {
    const running = this.activeEffects.find((r) => r.instanceId === instanceId);
    if (!running) return;

    if (running.effect.mode === "sustained" && running.effect.releaseSegment) {
      running.releasing = true;
      running.segmentIndex = 0;
      running.segmentStartTime = Date.now();
    } else {
      this.activeEffects = this.activeEffects.filter((r) => r.instanceId !== instanceId);
      this.maybeStopLoop();
    }
  }

  stopEffect(instanceId: string): void {
    this.activeEffects = this.activeEffects.filter((r) => r.instanceId !== instanceId);
    this.maybeStopLoop();
  }

  private ensureLoop(): void {
    if (this.intervalId) return;
    const minInterval = this.getMinTickInterval();
    this.intervalId = setInterval(() => this.tick(), minInterval);
  }

  private maybeStopLoop(): void {
    if (this.activeEffects.length === 0 && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private getMinTickInterval(): number {
    let maxHz = 40;
    for (const r of this.activeEffects) {
      if (r.effect.tickRateHz > maxHz) maxHz = r.effect.tickRateHz;
    }
    return Math.round(1000 / maxHz);
  }

  private tick(): void {
    const now = Date.now();
    const completed: string[] = [];

    for (const running of this.activeEffects) {
      const segments = running.releasing && running.effect.releaseSegment
        ? [running.effect.releaseSegment]
        : running.effect.segments;

      const seg = segments[running.segmentIndex];
      if (!seg) {
        completed.push(running.instanceId);
        continue;
      }

      const segElapsed = now - running.segmentStartTime;
      const totalSegDuration = seg.durationMs + seg.holdMs;

      if (totalSegDuration > 0 && segElapsed >= totalSegDuration) {
        running.segmentIndex++;
        running.segmentStartTime = now;

        if (running.segmentIndex >= segments.length) {
          if (running.releasing) {
            completed.push(running.instanceId);
            continue;
          }
          if (running.effect.loop) {
            running.segmentIndex = 0;
          } else if (running.effect.mode === "sustained") {
            running.segmentIndex = segments.length - 1;
            running.segmentStartTime = now;
          } else {
            completed.push(running.instanceId);
            continue;
          }
        }
        continue;
      }

      let value: number;
      if (seg.durationMs <= 0) {
        value = seg.endValue;
      } else if (segElapsed >= seg.durationMs) {
        value = seg.endValue;
      } else {
        const t = segElapsed / seg.durationMs;
        value = interpolateCurve(seg.curve, t, seg.startValue, seg.endValue, segElapsed);
      }

      value *= running.velocityScale;

      const config: SenderConfig = {
        host: running.target.host,
        port: running.target.port,
      };
      const args: OscArg[] = [
        {
          type: running.target.argType,
          value: running.target.argType === "i" ? Math.round(value) : value,
        },
      ];

      this.oscManager.sendMessage(config, running.target.address, args).catch(() => {});
    }

    for (const id of completed) {
      this.activeEffects = this.activeEffects.filter((r) => r.instanceId !== id);
    }

    this.maybeStopLoop();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `osc-effect-engine.ts`

- [ ] **Step 3: Commit**

```bash
git add electron/osc-effect-engine.ts
git commit -m "feat: add OscEffectEngine with tick-based interpolation and sustained mode"
```

---

### Task 4: IPC Handlers + Wiring

**Files:**
- Modify: `electron/ipc-handlers.ts:1-30` (imports + instantiation)
- Modify: `electron/ipc-handlers.ts:329` (after DMX handlers, before OSC forward section)

- [ ] **Step 1: Add imports and instantiation**

In `electron/ipc-handlers.ts`, add to imports (after line 12):

```typescript
import { OscEffectStore } from "./osc-effect-store";
import { OscEffectEngine } from "./osc-effect-engine";
```

In `registerIpcHandlers()`, after the `oscDmxBridge.loadTriggers(...)` line (line 30), add:

```typescript
  const oscEffectStore = new OscEffectStore();
  const oscEffectEngine = new OscEffectEngine(oscManager);
  oscEffectEngine.loadEffects(oscEffectStore.getAll());
```

- [ ] **Step 2: Add IPC handlers**

After the DMX handlers block (after line 329, before the `// --- Forward OSC messages ---` comment), add:

```typescript
  // --- OSC Effects ---
  ipcMain.handle("osc-effect:get-all", () => oscEffectStore.getAll());
  ipcMain.handle("osc-effect:save", (_e, effect) => {
    const saved = oscEffectStore.saveEffect(effect);
    oscEffectEngine.loadEffects(oscEffectStore.getAll());
    return saved;
  });
  ipcMain.handle("osc-effect:delete", (_e, id: string) => {
    oscEffectStore.deleteEffect(id);
    oscEffectEngine.loadEffects(oscEffectStore.getAll());
  });
  ipcMain.handle("osc-effect:trigger", (_e, effectId: string, target, velocityScale?: number) => {
    return oscEffectEngine.triggerEffect(effectId, target, velocityScale);
  });
  ipcMain.handle("osc-effect:release", (_e, instanceId: string) => {
    oscEffectEngine.releaseEffect(instanceId);
  });
  ipcMain.handle("osc-effect:stop", (_e, instanceId: string) => {
    oscEffectEngine.stopEffect(instanceId);
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add electron/ipc-handlers.ts
git commit -m "feat: register OSC effect IPC handlers and wire store + engine"
```

---

### Task 5: Frontend Hook

**Files:**
- Create: `src/hooks/use-osc-effects.ts`

Mirrors `src/hooks/use-dmx.ts` (lines 1–113) but simpler — no config, no triggers, no channels.

- [ ] **Step 1: Create the hook file**

```typescript
// src/hooks/use-osc-effects.ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { OscEffect } from "@/lib/osc-effect-types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useOscEffects() {
  const [effects, setEffects] = useState<OscEffect[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const list = (await api.invoke("osc-effect:get-all")) as OscEffect[];
    setEffects(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveEffect = useCallback(async (effect: OscEffect) => {
    const api = getAPI();
    if (!api) return;
    const saved = (await api.invoke("osc-effect:save", effect)) as OscEffect;
    setEffects((prev) => {
      const idx = prev.findIndex((e) => e.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved];
    });
    return saved;
  }, []);

  const deleteEffect = useCallback(async (id: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("osc-effect:delete", id);
    setEffects((prev) => prev.filter((e) => e.id !== id));
  }, []);

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
    effects,
    saveEffect,
    deleteEffect,
    triggerEffect,
    releaseEffect,
    stopEffect,
    refresh,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-osc-effects.ts
git commit -m "feat: add useOscEffects frontend hook"
```

---

### Task 6: Add oscEffectId to OscMapping

**Files:**
- Modify: `src/lib/types.ts:211-213`

- [ ] **Step 1: Add the field**

In `src/lib/types.ts`, after the `dmxEffectId?: string;` field (line 212), add:

```typescript
  oscEffectId?: string;
```

The `OscMapping` interface should now have both `dmxEffectId` and `oscEffectId` as optional fields.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add oscEffectId field to OscMapping type"
```

---

### Task 7: Live Monitor Integration

**Files:**
- Modify: `src/hooks/use-live-monitor.ts:70-113`

When a mapping has `oscEffectId`, trigger the OSC effect engine instead of sending a single value. Track instance IDs by MIDI note so sustained effects can be released on note-off.

- [ ] **Step 1: Update the live monitor**

In `src/hooks/use-live-monitor.ts`, the mapping dispatch loop currently at lines 70–113 sends `osc:send` for every matched mapping. We need to add branching: if the mapping has `oscEffectId`, call `osc-effect:trigger` instead.

Add a ref to track running effect instances at the top of the `useLiveMonitor` function (after line 32):

```typescript
  const oscEffectInstances = useRef<Map<string, string>>(new Map());
```

The key is `"${mapping.id}|${event.midi.data1}"` (mapping + MIDI note), value is the instance ID returned by `osc-effect:trigger`.

Replace the inner dispatch block (lines 84–111) with logic that checks for `oscEffectId`:

```typescript
          for (const epId of allEndpointIds) {
            const endpoint = eps.find((e) => e.id === epId);
            if (!endpoint) continue;

            if (mapping.oscEffectId && event.midi.type === "noteon") {
              const instanceKey = `${mapping.id}|${event.midi.data1}`;
              const velocityScale = event.midi.data2 / 127;
              window.electronAPI?.invoke("osc-effect:trigger", mapping.oscEffectId, {
                host: endpoint.host,
                port: endpoint.port,
                address,
                argType: mapping.argType,
              }, velocityScale).then((instanceId: string) => {
                if (instanceId) oscEffectInstances.current.set(instanceKey, instanceId);
              });
            } else if (mapping.oscEffectId && event.midi.type === "noteoff") {
              const instanceKey = `${mapping.id}|${event.midi.data1}`;
              const instanceId = oscEffectInstances.current.get(instanceKey);
              if (instanceId) {
                window.electronAPI?.invoke("osc-effect:release", instanceId);
                oscEffectInstances.current.delete(instanceKey);
              }
            } else if (!mapping.oscEffectId) {
              window.electronAPI?.invoke("osc:send", { host: endpoint.host, port: endpoint.port }, address, [
                { type: mapping.argType, value },
              ]);
            }

            activityUpdates[device].lastOscAt = now;
            if (liveDevice !== device) {
              activityUpdates[liveDevice].lastOscAt = now;
            }

            newEntries.push({
              id: crypto.randomUUID(),
              wallMs: now,
              device,
              eventType: event.midi.type,
              data1: event.midi.data1,
              data2: event.midi.data2,
              mapping,
              address,
              endpointId: epId,
              value,
              argType: mapping.argType,
            });

            fired = true;
          }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-live-monitor.ts
git commit -m "feat: route oscEffectId mappings through effect engine in live monitor"
```

---

### Task 8: Output Page — OSC Effects UI

**Files:**
- Modify: `src/app/output/page.tsx`

Add an OSC Effects section that mirrors the existing DMX Effects section (lines 386–510). Uses the same list/editor pattern with `useOscEffects` hook.

- [ ] **Step 1: Add imports and hook**

At the top of `src/app/output/page.tsx`, add import:

```typescript
import { useOscEffects } from "@/hooks/use-osc-effects";
import type { OscEffect, OscEffectSegment } from "@/lib/osc-effect-types";
```

- [ ] **Step 2: Add empty segment/effect helpers**

Add helper functions (near the existing `emptySegment`/`emptyEffect` helpers around line 56):

```typescript
function emptyOscSegment(): OscEffectSegment {
  return { startValue: 0, endValue: 1, durationMs: 500, curve: { type: "linear" }, holdMs: 0 };
}

function emptyOscEffect(): OscEffect {
  return {
    id: "",
    name: "New OSC Effect",
    segments: [emptyOscSegment()],
    loop: false,
    velocitySensitive: false,
    mode: "one-shot",
    tickRateHz: 40,
  };
}
```

- [ ] **Step 3: Add OSC effects state inside DmxPanel**

Inside the `DmxPanel` component, after the existing DMX effects state (around line 314), add:

```typescript
  const { effects: oscEffects, saveEffect: saveOscEffect, deleteEffect: deleteOscEffect } = useOscEffects();
  const [editingOscEffect, setEditingOscEffect] = useState<OscEffect | null>(null);
  const [selectedOscSegIdx, setSelectedOscSegIdx] = useState(0);
```

Add segment manipulation helpers (same pattern as DMX):

```typescript
  const startEditOscEffect = (effect?: OscEffect) => {
    setEditingOscEffect(effect ? structuredClone(effect) : emptyOscEffect());
    setSelectedOscSegIdx(0);
  };

  const updateOscSegment = (idx: number, patch: Partial<OscEffectSegment>) => {
    setEditingOscEffect((prev) => {
      if (!prev) return prev;
      const segs = [...prev.segments];
      segs[idx] = { ...segs[idx], ...patch };
      return { ...prev, segments: segs };
    });
  };

  const addOscSegment = () => {
    setEditingOscEffect((prev) => {
      if (!prev) return prev;
      return { ...prev, segments: [...prev.segments, emptyOscSegment()] };
    });
  };

  const deleteOscSegment = (idx: number) => {
    setEditingOscEffect((prev) => {
      if (!prev || prev.segments.length <= 1) return prev;
      const segs = prev.segments.filter((_, i) => i !== idx);
      return { ...prev, segments: segs };
    });
  };

  const handleSaveOscEffect = async () => {
    if (!editingOscEffect) return;
    await saveOscEffect(editingOscEffect);
    setEditingOscEffect(null);
  };

  const selectedOscSeg = editingOscEffect?.segments[selectedOscSegIdx] ?? null;
```

- [ ] **Step 4: Add OSC Effects list and editor UI**

After the DMX effects section (after the closing `</div>` of the left column), add a new section. Place this inside the same `flex-1 flex flex-col` container, after the DMX editor block. The section should render when `!editingOscEffect` (list view) or when `editingOscEffect` (editor view), but should hide when a DMX effect is being edited (and vice versa).

**OSC Effect list (when not editing either type):**

```tsx
{!editingEffect && !editingOscEffect && (
  <section className="mt-6">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-white">OSC Effects</h3>
      <button className="text-xs text-blue-400 hover:text-blue-300" onClick={() => startEditOscEffect()}>
        + New OSC Effect
      </button>
    </div>
    {oscEffects.length === 0 && (
      <p className="text-xs text-gray-600">No OSC effects yet. Create one to get started.</p>
    )}
    <div className="flex flex-col gap-1.5">
      {oscEffects.map((eff) => (
        <div key={eff.id} className="flex items-center justify-between bg-elevated rounded-lg px-4 py-2.5 border border-white/5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-white font-medium truncate" title={eff.name}>{eff.name}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400/80">{eff.mode}</span>
              {eff.loop && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400/80">loop</span>}
              {eff.velocitySensitive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400/80">velocity</span>}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              {eff.segments.map((seg, i) => (
                <span key={i} className="text-[10px] text-gray-500 font-mono">
                  {seg.startValue}→{seg.endValue}
                  {" "}{seg.durationMs}ms
                  {seg.holdMs > 0 && <span> +{seg.holdMs}ms</span>}
                  {" "}<span className="text-gray-600">{seg.curve.type}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="text-[10px] text-gray-400 hover:text-white" onClick={() => startEditOscEffect(eff)}>Edit</button>
            <button
              className="text-[10px] text-gray-400 hover:text-white"
              onClick={() => {
                const clone: OscEffect = {
                  ...structuredClone(eff),
                  id: crypto.randomUUID(),
                  name: `${eff.name} (copy)`,
                };
                saveOscEffect(clone);
              }}
            >
              Duplicate
            </button>
            <button className="text-[10px] text-red-400/60 hover:text-red-400" onClick={() => deleteOscEffect(eff.id)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  </section>
)}
```

**OSC Effect editor (when editing):**

```tsx
{editingOscEffect && (
  <section className="flex flex-col gap-4">
    <div className="flex items-center gap-3">
      <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setEditingOscEffect(null)}>← Back</button>
      <h3 className="text-sm font-semibold text-white">{editingOscEffect.id ? "Edit OSC Effect" : "New OSC Effect"}</h3>
    </div>
    <div>
      <label className="block text-[10px] uppercase text-gray-500 mb-1">Name</label>
      <input
        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/40"
        value={editingOscEffect.name}
        onChange={(e) => setEditingOscEffect({ ...editingOscEffect, name: e.target.value })}
      />
    </div>
    <div className="flex gap-4 flex-wrap">
      <div>
        <label className="block text-[10px] uppercase text-gray-500 mb-1">Mode</label>
        <select
          className="bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none"
          value={editingOscEffect.mode}
          onChange={(e) => setEditingOscEffect({ ...editingOscEffect, mode: e.target.value as "one-shot" | "sustained" })}
        >
          <option value="one-shot">One-shot</option>
          <option value="sustained">Sustained</option>
        </select>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={editingOscEffect.loop}
          onChange={(e) => setEditingOscEffect({ ...editingOscEffect, loop: e.target.checked })}
          className="accent-blue-500"
        />
        <span className="text-xs text-gray-300">Loop</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={editingOscEffect.velocitySensitive}
          onChange={(e) => setEditingOscEffect({ ...editingOscEffect, velocitySensitive: e.target.checked })}
          className="accent-blue-500"
        />
        <span className="text-xs text-gray-300">Velocity Sensitive</span>
      </label>
      <div>
        <label className="block text-[10px] uppercase text-gray-500 mb-1">Tick Rate (Hz)</label>
        <input
          type="number"
          className="w-20 bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none"
          value={editingOscEffect.tickRateHz}
          min={1}
          max={120}
          onChange={(e) => setEditingOscEffect({ ...editingOscEffect, tickRateHz: Math.max(1, Math.min(120, parseInt(e.target.value) || 40)) })}
        />
      </div>
    </div>
    <SegmentStrip
      segments={editingOscEffect.segments}
      selectedIndex={selectedOscSegIdx}
      onSelect={setSelectedOscSegIdx}
      onAdd={addOscSegment}
      onDelete={deleteOscSegment}
    />
    {selectedOscSeg && (
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Start Value</label>
          <input
            type="number"
            step="0.01"
            className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none"
            value={selectedOscSeg.startValue}
            onChange={(e) => updateOscSegment(selectedOscSegIdx, { startValue: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">End Value</label>
          <input
            type="number"
            step="0.01"
            className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none"
            value={selectedOscSeg.endValue}
            onChange={(e) => updateOscSegment(selectedOscSegIdx, { endValue: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Duration (ms)</label>
          <input
            type="number"
            className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none"
            value={selectedOscSeg.durationMs}
            onChange={(e) => updateOscSegment(selectedOscSegIdx, { durationMs: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Hold (ms)</label>
          <input
            type="number"
            className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none"
            value={selectedOscSeg.holdMs}
            onChange={(e) => updateOscSegment(selectedOscSegIdx, { holdMs: parseInt(e.target.value) || 0 })}
          />
        </div>
      </div>
    )}
    {selectedOscSeg && (
      <CurveEditor
        curve={selectedOscSeg.curve}
        onChange={(curve) => updateOscSegment(selectedOscSegIdx, { curve })}
      />
    )}
    {editingOscEffect.mode === "sustained" && (
      <div className="border-t border-white/5 pt-4 mt-2">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-400">Release Segment</h4>
          {!editingOscEffect.releaseSegment ? (
            <button
              className="text-[10px] text-blue-400 hover:text-blue-300"
              onClick={() => setEditingOscEffect({ ...editingOscEffect, releaseSegment: emptyOscSegment() })}
            >
              + Add Release
            </button>
          ) : (
            <button
              className="text-[10px] text-red-400/60 hover:text-red-400"
              onClick={() => setEditingOscEffect({ ...editingOscEffect, releaseSegment: undefined })}
            >
              Remove
            </button>
          )}
        </div>
        {editingOscEffect.releaseSegment && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className="block text-[10px] uppercase text-gray-500 mb-1">Start Value</label>
              <input
                type="number"
                step="0.01"
                className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none"
                value={editingOscEffect.releaseSegment.startValue}
                onChange={(e) => setEditingOscEffect({ ...editingOscEffect, releaseSegment: { ...editingOscEffect.releaseSegment!, startValue: parseFloat(e.target.value) || 0 } })}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-gray-500 mb-1">End Value</label>
              <input
                type="number"
                step="0.01"
                className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none"
                value={editingOscEffect.releaseSegment.endValue}
                onChange={(e) => setEditingOscEffect({ ...editingOscEffect, releaseSegment: { ...editingOscEffect.releaseSegment!, endValue: parseFloat(e.target.value) || 0 } })}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-gray-500 mb-1">Duration (ms)</label>
              <input
                type="number"
                className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none"
                value={editingOscEffect.releaseSegment.durationMs}
                onChange={(e) => setEditingOscEffect({ ...editingOscEffect, releaseSegment: { ...editingOscEffect.releaseSegment!, durationMs: parseInt(e.target.value) || 0 } })}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-gray-500 mb-1">Hold (ms)</label>
              <input
                type="number"
                className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none"
                value={editingOscEffect.releaseSegment.holdMs}
                onChange={(e) => setEditingOscEffect({ ...editingOscEffect, releaseSegment: { ...editingOscEffect.releaseSegment!, holdMs: parseInt(e.target.value) || 0 } })}
              />
            </div>
          </div>
        )}
      </div>
    )}
    <div className="flex gap-2 pt-2">
      <button
        className="px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg"
        onClick={handleSaveOscEffect}
      >
        Save
      </button>
      <button
        className="px-4 py-2 text-sm bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg"
        onClick={() => setEditingOscEffect(null)}
      >
        Cancel
      </button>
    </div>
  </section>
)}
```

Note: The `SegmentStrip` component is already imported and works with any array of objects that have visual segment properties — it uses the segments array generically. The `CurveEditor` component works with `CurveDefinition` which both DMX and OSC segments share.

**Important:** The `SegmentStrip` component expects segments with a `channels` property (from `DmxSegment`). Check if it accesses `channels` — if so, it may need adjustment. If `SegmentStrip` only renders visual bars based on segment count and selection, it will work as-is. If it requires `channels`, create a thin adapter or skip `SegmentStrip` and use a simpler segment selector.

- [ ] **Step 5: Verify TypeScript compiles and app runs**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`

If there are type errors from `SegmentStrip` expecting `DmxSegment[]`, the segments prop type needs adjustment — either make `SegmentStrip` generic or cast the segments.

- [ ] **Step 6: Commit**

```bash
git add src/app/output/page.tsx
git commit -m "feat: add OSC Effects list and editor UI to output page"
```

---

### Task 9: Mapping Editor — Effect Dropdown (Live Tab)

**Files:**
- Modify: `src/components/live/mapping-config-panel.tsx`

Add an "OSC Effect" dropdown to OSC mapping rows. When an effect is selected, it sets `oscEffectId` on the mapping. When cleared, the mapping sends single values as before.

- [ ] **Step 1: Add useOscEffects hook to component**

In `mapping-config-panel.tsx`, add import:

```typescript
import { useOscEffects } from "@/hooks/use-osc-effects";
```

Inside the component, add:

```typescript
const { effects: oscEffects } = useOscEffects();
```

- [ ] **Step 2: Add effect dropdown to OSC mapping row**

In the mapping row UI (the section that renders endpoint, address, argType fields), add a dropdown after the existing fields:

```tsx
<div>
  <label className="block text-[10px] uppercase text-gray-500 mb-1">OSC Effect</label>
  <select
    className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none"
    value={mapping.oscEffectId ?? ""}
    onChange={(e) => onUpdateMapping({ ...mapping, oscEffectId: e.target.value || undefined })}
  >
    <option value="">None (single value)</option>
    {oscEffects.map((eff) => (
      <option key={eff.id} value={eff.id}>{eff.name}</option>
    ))}
  </select>
</div>
```

This dropdown should only appear when `mapping.outputType !== "dmx"` (i.e., for OSC mappings only).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/live/mapping-config-panel.tsx
git commit -m "feat: add OSC effect dropdown to live tab mapping config"
```

---

### Task 10: Mapping Editor — Effect Dropdown (Timeline)

**Files:**
- Modify: `src/components/timeline/osc-mapping-editor.tsx`

Same pattern as Task 9 but in the timeline mapping editor.

- [ ] **Step 1: Add useOscEffects hook to component**

In `osc-mapping-editor.tsx`, add import:

```typescript
import { useOscEffects } from "@/hooks/use-osc-effects";
```

Inside the component, add:

```typescript
const { effects: oscEffects } = useOscEffects();
```

- [ ] **Step 2: Add effect dropdown**

Add an "OSC Effect" dropdown in the OSC output section of the editor, similar to Task 9 step 2. This should only appear when the mapping's `outputType` is `"osc"` (not `"dmx"`).

```tsx
<div>
  <label className="block text-[10px] uppercase text-gray-500 mb-1">OSC Effect</label>
  <select
    className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none"
    value={mapping.oscEffectId ?? ""}
    onChange={(e) => onUpdate({ ...mapping, oscEffectId: e.target.value || undefined })}
  >
    <option value="">None (single value)</option>
    {oscEffects.map((eff) => (
      <option key={eff.id} value={eff.id}>{eff.name}</option>
    ))}
  </select>
</div>
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/osc-mapping-editor.tsx
git commit -m "feat: add OSC effect dropdown to timeline mapping editor"
```

---

### Task 11: Timeline Chip Labels for OSC Effects

**Files:**
- Modify: `src/components/timeline/device-section.tsx`

Update `oscLabelFor()` to show effect name when a mapping has `oscEffectId`. Needs access to `oscEffects` list.

- [ ] **Step 1: Pass oscEffects to DeviceSection**

Add `oscEffects` to `DeviceSectionProps` and pass it from `TimelineCanvas`. Import `OscEffect` type.

In `device-section.tsx`:
```typescript
import type { OscEffect } from "@/lib/osc-effect-types";

interface DeviceSectionProps {
  // ...existing props...
  oscEffects?: OscEffect[];
}
```

In `timeline-canvas.tsx`, add `oscEffects` to `TimelineCanvasProps` and pass it to `DeviceSection`.

- [ ] **Step 2: Update oscLabelFor**

In `device-section.tsx`, update the `oscLabelFor` function to check for `oscEffectId`:

```typescript
function oscEffectLabel(mapping: OscMapping, oscEffects: OscEffect[]): string | null {
  if (!mapping.oscEffectId) return null;
  const eff = oscEffects.find((e) => e.id === mapping.oscEffectId);
  return eff ? eff.name : mapping.oscEffectId.slice(0, 8);
}
```

In the label rendering, when `mapping.oscEffectId` is set, show `"FX: effectName"` with a distinct color (e.g., cyan/teal to distinguish from plain OSC blue and DMX purple).

- [ ] **Step 3: Wire oscEffects from timeline page through TimelineCanvas to DeviceSection**

In `src/app/timeline/page.tsx`, use the `useOscEffects` hook and pass `oscEffects` to `TimelineCanvas`:

```typescript
import { useOscEffects } from "@/hooks/use-osc-effects";

// Inside the component:
const { effects: oscEffects } = useOscEffects();

// In JSX:
<TimelineCanvas oscEffects={oscEffects} /* ...other props */ />
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/device-section.tsx src/components/timeline/timeline-canvas.tsx src/app/timeline/page.tsx
git commit -m "feat: show OSC effect names in timeline mapping chips"
```

---

### Task 12: End-to-End Verification

- [ ] **Step 1: Start the dev server**

Run: `cd /Users/rense/Projects/osc_tool && pnpm dev`

- [ ] **Step 2: Create an OSC effect**

Navigate to Output tab → OSC Effects section → "+ New OSC Effect". Create a simple fade: name "Test Fade", one segment 0→1 over 1000ms, linear curve. Save.

- [ ] **Step 3: Verify effect appears in mapping editors**

Go to Timeline tab, open a mapping editor for an OSC mapping. Confirm the "OSC Effect" dropdown lists "Test Fade". Do the same in the Live tab mapping config.

- [ ] **Step 4: Test effect triggering via mapping**

Assign the effect to a mapping in the Live tab. Send a MIDI note. Verify that the target endpoint receives multiple OSC messages over 1 second (the fade), rather than a single value.

- [ ] **Step 5: Test sustained mode**

Create a sustained effect (mode: "sustained", loop: true, with a release segment). Assign to a mapping. Hold a MIDI note — effect should loop. Release — should play release segment and stop.

- [ ] **Step 6: Commit final state**

If any fixes were needed during testing, commit them:

```bash
git add -A
git commit -m "fix: end-to-end adjustments for OSC effects system"
```
