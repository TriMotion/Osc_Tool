# Live Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new top-level Live tab that monitors incoming MIDI in real time, fires matched OSC signals, shows a live activity feed, and provides a collapsible panel for editing and batch-reassigning OSC mappings.

**Architecture:** A `useLiveMonitor` hook subscribes to `midi:events` IPC, matches each event against the loaded recording's `oscMappings` (reusing existing `matchesMapping`/`resolveOscAddress`/`computeOscArgValue`), fires `osc:send` for matches, and emits `ActivityEntry` objects. The Live page composes three zones: a device strip with per-device MIDI/OSC flash indicators, a scrollable activity feed with an unmapped-toggle, and a collapsible mapping config panel with inline editing and batch endpoint reassignment.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind CSS, Framer Motion, Electron IPC (`midi:events`, `osc:send`, `endpoints:get-all`)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/types.ts` | Add `ActivityEntry` interface |
| Modify | `src/components/sidebar.tsx` | Add Live nav item |
| Create | `src/hooks/use-flash.ts` | Reusable flash indicator hook |
| Create | `src/hooks/use-live-monitor.ts` | Core hook: MIDI subscribe → match → OSC send → emit entries |
| Create | `src/components/live/device-strip.tsx` | DeviceStrip + DeviceCard with MIDI/OSC flash dots |
| Create | `src/components/live/activity-feed.tsx` | ActivityFeed + ActivityRow scrolling event log |
| Create | `src/components/live/mapping-config-panel.tsx` | Collapsible panel: filter + inline edit + batch reassign |
| Create | `src/app/live/page.tsx` | LivePage: assembles all three zones |

---

## Task 1: Add `ActivityEntry` type and Live sidebar nav item

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Add `ActivityEntry` to `src/lib/types.ts`**

Add after the `OscMapping` interface (after line 194):

```typescript
export interface ActivityEntry {
  id: string;
  wallMs: number;
  device: string;
  eventType: MidiEvent["midi"]["type"];
  data1: number;
  data2: number;
  mapping: OscMapping | null;
  address: string | null;
  endpointId: string | null;
  value: number | null;
  argType: "f" | "i" | null;
}
```

- [ ] **Step 2: Add Live to `src/components/sidebar.tsx` navItems**

In `src/components/sidebar.tsx`, change the `navItems` array from:

```typescript
const navItems = [
  { href: "/listener", label: "Listener", icon: "📡" },
  { href: "/sender", label: "Sender", icon: "📤" },
  { href: "/deck", label: "Deck", icon: "🎛" },
  { href: "/midi", label: "MIDI", icon: "🎹" },
  { href: "/timeline", label: "Timeline", icon: "📼" },
  { href: "/diagnostics", label: "Diagnostics", icon: "🔬" },
];
```

to:

```typescript
const navItems = [
  { href: "/listener", label: "Listener", icon: "📡" },
  { href: "/sender", label: "Sender", icon: "📤" },
  { href: "/deck", label: "Deck", icon: "🎛" },
  { href: "/midi", label: "MIDI", icon: "🎹" },
  { href: "/timeline", label: "Timeline", icon: "📼" },
  { href: "/live", label: "Live", icon: "🎙" },
  { href: "/diagnostics", label: "Diagnostics", icon: "🔬" },
];
```

- [ ] **Step 3: Verify types compile**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/components/sidebar.tsx
git commit -m "feat(live): add ActivityEntry type and Live sidebar nav item"
```

---

## Task 2: Build `useFlash` hook

**Files:**
- Create: `src/hooks/use-flash.ts`

- [ ] **Step 1: Create `src/hooks/use-flash.ts`**

```typescript
"use client";

import { useEffect, useRef, useState } from "react";

export function useFlash(trigger: number, durationMs = 300): boolean {
  const [flashing, setFlashing] = useState(false);
  const prevRef = useRef(trigger);

  useEffect(() => {
    if (trigger === prevRef.current) return;
    prevRef.current = trigger;
    setFlashing(true);
    const id = setTimeout(() => setFlashing(false), durationMs);
    return () => clearTimeout(id);
  }, [trigger, durationMs]);

  return flashing;
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-flash.ts
git commit -m "feat(live): add useFlash hook for indicator animations"
```

---

## Task 3: Build `useLiveMonitor` hook

**Files:**
- Create: `src/hooks/use-live-monitor.ts`

This hook subscribes to live MIDI events, matches them against the loaded recording's OSC mappings, fires `osc:send` for matches, and emits `ActivityEntry` objects for the UI. It maintains a 500-entry ring buffer and per-device activity timestamps for flash indicators.

- [ ] **Step 1: Create `src/hooks/use-live-monitor.ts`**

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMidiEvents } from "@/hooks/use-midi";
import { matchesMapping, resolveOscAddress, computeOscArgValue } from "@/lib/osc-mapping";
import type { ActivityEntry, MidiEvent, Recording, RecordedEvent, SavedEndpoint } from "@/lib/types";

const RING_SIZE = 500;

interface UseLiveMonitorArgs {
  recording: Recording | null;
  endpoints: SavedEndpoint[];
}

export interface DeviceActivity {
  lastMidiAt: number;
  lastOscAt: number;
}

interface UseLiveMonitorReturn {
  entries: ActivityEntry[];
  deviceActivity: Record<string, DeviceActivity>;
}

export function useLiveMonitor({ recording, endpoints }: UseLiveMonitorArgs): UseLiveMonitorReturn {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [deviceActivity, setDeviceActivity] = useState<Record<string, DeviceActivity>>({});

  const recordingRef = useRef(recording);
  const endpointsRef = useRef(endpoints);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => { endpointsRef.current = endpoints; }, [endpoints]);

  useMidiEvents(useCallback((incoming: MidiEvent[]) => {
    const rec = recordingRef.current;
    const eps = endpointsRef.current;
    const now = Date.now();

    const newEntries: ActivityEntry[] = [];
    const activityUpdates: Record<string, { lastMidiAt?: number; lastOscAt?: number }> = {};

    for (const event of incoming) {
      const device = event.midi.deviceName;
      if (!activityUpdates[device]) activityUpdates[device] = {};
      activityUpdates[device].lastMidiAt = now;

      // Wrap as RecordedEvent so matchesMapping / computeOscArgValue can consume it
      const fakeEvt: RecordedEvent = { tRel: 0, midi: event.midi, osc: event.osc };

      let fired = false;

      if (rec?.oscMappings?.length) {
        for (const mapping of rec.oscMappings) {
          if (!matchesMapping(fakeEvt, mapping)) continue;

          const address = resolveOscAddress(
            mapping,
            rec.deviceAliases,
            event.midi.type === "noteon" ? event.midi.data2 : undefined,
          );
          const value = computeOscArgValue(fakeEvt, mapping);
          const endpoint = eps.find((e) => e.id === mapping.endpointId);

          if (endpoint) {
            window.electronAPI?.invoke("osc:send", { host: endpoint.host, port: endpoint.port }, address, [
              { type: mapping.argType, value },
            ]);
          }

          activityUpdates[device].lastOscAt = now;

          newEntries.push({
            id: crypto.randomUUID(),
            wallMs: now,
            device,
            eventType: event.midi.type,
            data1: event.midi.data1,
            data2: event.midi.data2,
            mapping,
            address,
            endpointId: mapping.endpointId,
            value,
            argType: mapping.argType,
          });

          fired = true;
        }
      }

      if (!fired) {
        newEntries.push({
          id: crypto.randomUUID(),
          wallMs: now,
          device,
          eventType: event.midi.type,
          data1: event.midi.data1,
          data2: event.midi.data2,
          mapping: null,
          address: null,
          endpointId: null,
          value: null,
          argType: null,
        });
      }
    }

    if (newEntries.length > 0) {
      setEntries((prev) => [...newEntries.reverse(), ...prev].slice(0, RING_SIZE));
    }

    if (Object.keys(activityUpdates).length > 0) {
      setDeviceActivity((prev) => {
        const next = { ...prev };
        for (const [dev, update] of Object.entries(activityUpdates)) {
          next[dev] = {
            lastMidiAt: update.lastMidiAt ?? next[dev]?.lastMidiAt ?? 0,
            lastOscAt: update.lastOscAt ?? next[dev]?.lastOscAt ?? 0,
          };
        }
        return next;
      });
    }
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  return { entries, deviceActivity };
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-live-monitor.ts
git commit -m "feat(live): add useLiveMonitor hook for real-time MIDI→OSC monitoring"
```

---

## Task 4: Build `DeviceStrip` component

**Files:**
- Create: `src/components/live/device-strip.tsx`

Each `DeviceCard` shows the device name and two coloured flash dots: blue for any MIDI input, amber for an OSC-triggering input. Flash state comes from `useFlash` driven by the timestamps in `deviceActivity`.

- [ ] **Step 1: Create `src/components/live/device-strip.tsx`**

```tsx
"use client";

import { useFlash } from "@/hooks/use-flash";
import type { DeviceActivity } from "@/hooks/use-live-monitor";

interface DeviceCardProps {
  name: string;
  activity: DeviceActivity | undefined;
  aliases?: Record<string, string>;
}

function DeviceCard({ name, activity, aliases }: DeviceCardProps) {
  const displayName = aliases?.[name] ?? name;
  const midiFlashing = useFlash(activity?.lastMidiAt ?? 0);
  const oscFlashing = useFlash(activity?.lastOscAt ?? 0);

  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-lg bg-surface-light border border-white/5 min-w-[120px]">
      <span className="text-xs font-medium text-gray-300 truncate max-w-[100px]">{displayName}</span>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <div
            className={`w-2 h-2 rounded-full transition-colors duration-150 ${
              midiFlashing ? "bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.8)]" : "bg-white/10"
            }`}
          />
          <span className="text-[10px] text-gray-500">MIDI</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className={`w-2 h-2 rounded-full transition-colors duration-150 ${
              oscFlashing ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" : "bg-white/10"
            }`}
          />
          <span className="text-[10px] text-gray-500">OSC</span>
        </div>
      </div>
    </div>
  );
}

interface DeviceStripProps {
  devices: string[];
  deviceActivity: Record<string, DeviceActivity>;
  aliases?: Record<string, string>;
}

export function DeviceStrip({ devices, deviceActivity, aliases }: DeviceStripProps) {
  if (devices.length === 0) {
    return (
      <div className="flex items-center px-4 py-3 text-sm text-gray-500 border-b border-white/5">
        No devices in recording
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 overflow-x-auto shrink-0">
      {devices.map((device) => (
        <DeviceCard
          key={device}
          name={device}
          activity={deviceActivity[device]}
          aliases={aliases}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/live/device-strip.tsx
git commit -m "feat(live): add DeviceStrip with per-device MIDI/OSC flash indicators"
```

---

## Task 5: Build `ActivityFeed` component

**Files:**
- Create: `src/components/live/activity-feed.tsx`

Reverse-chronological event log. Each row shows device, event type (with human-readable note name for note events), and — for matched events — the resolved OSC address, endpoint host:port, and value sent. A toggle above the feed controls whether unmatched events are shown.

- [ ] **Step 1: Create `src/components/live/activity-feed.tsx`**

```tsx
"use client";

import type { ActivityEntry, MidiEvent, SavedEndpoint } from "@/lib/types";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiNoteToName(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function formatEvent(eventType: MidiEvent["midi"]["type"], data1: number, data2: number): string {
  switch (eventType) {
    case "noteon":    return `Note On  ${midiNoteToName(data1)}  vel ${data2}`;
    case "noteoff":   return `Note Off ${midiNoteToName(data1)}`;
    case "cc":        return `CC ${data1}  val ${data2}`;
    case "pitch":     return `Pitch  ${data2}`;
    case "aftertouch": return `AT  ${data2}`;
    case "program":   return `Prog ${data1}`;
    default:          return `${eventType} ${data1}`;
  }
}

interface ActivityRowProps {
  entry: ActivityEntry;
  endpoints: SavedEndpoint[];
  aliases?: Record<string, string>;
}

function ActivityRow({ entry, endpoints, aliases }: ActivityRowProps) {
  const isMapped = entry.mapping !== null;
  const endpoint = isMapped ? endpoints.find((e) => e.id === entry.endpointId) : null;
  const displayDevice = aliases?.[entry.device] ?? entry.device;
  const time = new Date(entry.wallMs).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      className={`flex items-center gap-3 px-4 py-1.5 text-xs border-b border-white/5 font-mono ${
        isMapped ? "text-gray-200" : "text-gray-600"
      }`}
    >
      <span className="shrink-0 w-16 text-gray-600">{time}</span>
      <span className="shrink-0 w-32 truncate text-gray-400">{displayDevice}</span>
      <span className="shrink-0 w-40">{formatEvent(entry.eventType, entry.data1, entry.data2)}</span>
      {isMapped && entry.address && (
        <>
          <span className="text-white/20 shrink-0">→</span>
          <span className="text-accent shrink-0 truncate max-w-[200px]">{entry.address}</span>
          {endpoint && (
            <span className="text-gray-500 shrink-0">
              {endpoint.host}:{endpoint.port}
            </span>
          )}
          {entry.value !== null && (
            <span className="text-gray-500 shrink-0">
              {entry.argType === "f" ? entry.value.toFixed(3) : entry.value}
            </span>
          )}
        </>
      )}
    </div>
  );
}

interface ActivityFeedProps {
  entries: ActivityEntry[];
  showUnmapped: boolean;
  onToggleUnmapped: (v: boolean) => void;
  endpoints: SavedEndpoint[];
  aliases?: Record<string, string>;
}

export function ActivityFeed({
  entries,
  showUnmapped,
  onToggleUnmapped,
  endpoints,
  aliases,
}: ActivityFeedProps) {
  const visible = showUnmapped ? entries : entries.filter((e) => e.mapping !== null);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0">
        <span className="text-xs font-medium text-gray-400">Activity</span>
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showUnmapped}
            onChange={(e) => onToggleUnmapped(e.target.checked)}
            className="accent-accent"
          />
          Show unmapped events
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-600">
            {entries.length === 0 ? "Waiting for MIDI input…" : "No mapped events yet"}
          </div>
        ) : (
          visible.map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              endpoints={endpoints}
              aliases={aliases}
            />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/live/activity-feed.tsx
git commit -m "feat(live): add ActivityFeed with unmapped toggle and formatted MIDI rows"
```

---

## Task 6: Build `MappingConfigPanel` component

**Files:**
- Create: `src/components/live/mapping-config-panel.tsx`

Collapsible panel (collapsed by default). Contains a filter bar (by preset type + by endpoint), a scrollable mapping table with inline editing per row, and a sticky batch-action bar that appears when rows are selected. Each mapping row has a flash dot (amber) that lights up when that mapping fires live.

Editable fields per row:
- **All presets:** endpoint dropdown
- **Custom:** address text input
- **Unreal:** section name, parameter name, type (parameter/trigger)
- **Resolume:** mode (column/clip), column index OR layer+clip indices

Trigger note/CC is displayed but not editable here.

- [ ] **Step 1: Create `src/components/live/mapping-config-panel.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useFlash } from "@/hooks/use-flash";
import { resolveOscAddress } from "@/lib/osc-mapping";
import type { OscMapping, OscPreset, SavedEndpoint } from "@/lib/types";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiNoteToName(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function formatTrigger(mapping: OscMapping): string {
  if (mapping.targetType === "noteGroup") {
    const [pitchStr, velocityStr] = mapping.targetId.split("|");
    return `${midiNoteToName(parseInt(pitchStr, 10))} v${velocityStr}`;
  }
  return mapping.targetId;
}

// ─── MappingRow ────────────────────────────────────────────────────────────────

interface MappingRowProps {
  mapping: OscMapping;
  endpoints: SavedEndpoint[];
  aliases?: Record<string, string>;
  isSelected: boolean;
  isEditing: boolean;
  flashTrigger: number;
  onToggleSelect: () => void;
  onToggleEdit: () => void;
  onUpdate: (mapping: OscMapping) => void;
}

function MappingRow({
  mapping,
  endpoints,
  aliases,
  isSelected,
  isEditing,
  flashTrigger,
  onToggleSelect,
  onToggleEdit,
  onUpdate,
}: MappingRowProps) {
  const isFlashing = useFlash(flashTrigger);
  const displayDevice = aliases?.[mapping.deviceId] ?? mapping.deviceId;
  const endpoint = endpoints.find((e) => e.id === mapping.endpointId);
  const address = resolveOscAddress(mapping, aliases);

  return (
    <div className={`border-b border-white/5 transition-colors ${isFlashing ? "bg-accent/5" : ""}`}>
      {/* Summary row */}
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="accent-accent shrink-0"
        />
        <div
          className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-150 ${
            isFlashing ? "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.8)]" : "bg-white/10"
          }`}
        />
        <span className="text-gray-400 w-28 truncate shrink-0">{displayDevice}</span>
        <span className="text-gray-500 w-24 truncate shrink-0 font-mono">{formatTrigger(mapping)}</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
            mapping.preset === "resolume"
              ? "bg-orange-500/20 text-orange-400"
              : mapping.preset === "unreal"
              ? "bg-blue-500/20 text-blue-400"
              : "bg-gray-500/20 text-gray-400"
          }`}
        >
          {mapping.preset}
        </span>
        <span className="text-accent font-mono flex-1 truncate">{address}</span>
        <span className="text-gray-500 shrink-0 truncate max-w-[120px]">
          {endpoint ? endpoint.name : <span className="text-red-400/80">missing</span>}
        </span>
        <button
          onClick={onToggleEdit}
          className="text-gray-600 hover:text-gray-300 shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-white/5 hover:border-white/10 transition-colors"
        >
          {isEditing ? "close" : "edit"}
        </button>
      </div>

      {/* Inline edit section */}
      {isEditing && (
        <div className="px-4 pb-3 pt-1 bg-surface-light border-t border-white/5 flex flex-col gap-2">
          {/* Endpoint — always shown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-24 shrink-0">Endpoint</span>
            <select
              value={mapping.endpointId}
              onChange={(e) => onUpdate({ ...mapping, endpointId: e.target.value })}
              className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300 flex-1"
            >
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.name} — {ep.host}:{ep.port}
                </option>
              ))}
            </select>
          </div>

          {/* Custom preset */}
          {mapping.preset === "custom" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 shrink-0">Address</span>
              <input
                type="text"
                value={mapping.address ?? ""}
                onChange={(e) => onUpdate({ ...mapping, address: e.target.value })}
                className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300 flex-1 font-mono"
                placeholder="/osc/address"
              />
            </div>
          )}

          {/* Unreal preset */}
          {mapping.preset === "unreal" && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">Section</span>
                <input
                  type="text"
                  value={mapping.sectionName ?? ""}
                  onChange={(e) => onUpdate({ ...mapping, sectionName: e.target.value })}
                  className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300 flex-1 font-mono"
                  placeholder="default"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">Param name</span>
                <input
                  type="text"
                  value={mapping.unrealName ?? ""}
                  onChange={(e) => onUpdate({ ...mapping, unrealName: e.target.value })}
                  className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300 flex-1 font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">Type</span>
                <select
                  value={mapping.unrealType ?? "parameter"}
                  onChange={(e) =>
                    onUpdate({ ...mapping, unrealType: e.target.value as "parameter" | "trigger" })
                  }
                  className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300"
                >
                  <option value="parameter">Parameter</option>
                  <option value="trigger">Trigger</option>
                </select>
              </div>
            </>
          )}

          {/* Resolume preset */}
          {mapping.preset === "resolume" && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">Mode</span>
                <select
                  value={mapping.resolumeMode ?? "column"}
                  onChange={(e) =>
                    onUpdate({ ...mapping, resolumeMode: e.target.value as "column" | "clip" })
                  }
                  className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300"
                >
                  <option value="column">Column</option>
                  <option value="clip">Clip</option>
                </select>
              </div>
              {(mapping.resolumeMode ?? "column") === "column" ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-24 shrink-0">Column</span>
                  <input
                    type="number"
                    min={1}
                    value={mapping.resolumeColumn ?? 1}
                    onChange={(e) =>
                      onUpdate({ ...mapping, resolumeColumn: parseInt(e.target.value) || 1 })
                    }
                    className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300 w-16"
                  />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-24 shrink-0">Layer</span>
                    <input
                      type="number"
                      min={1}
                      value={mapping.resolumeLayer ?? 1}
                      onChange={(e) =>
                        onUpdate({ ...mapping, resolumeLayer: parseInt(e.target.value) || 1 })
                      }
                      className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300 w-16"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-24 shrink-0">Clip</span>
                    <input
                      type="number"
                      min={1}
                      value={mapping.resolumeClip ?? 1}
                      onChange={(e) =>
                        onUpdate({ ...mapping, resolumeClip: parseInt(e.target.value) || 1 })
                      }
                      className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300 w-16"
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MappingConfigPanel ────────────────────────────────────────────────────────

interface MappingConfigPanelProps {
  mappings: OscMapping[];
  endpoints: SavedEndpoint[];
  aliases?: Record<string, string>;
  flashTriggers: Record<string, number>;
  onUpdateMappings: (mappings: OscMapping[]) => void;
}

export function MappingConfigPanel({
  mappings,
  endpoints,
  aliases,
  flashTriggers,
  onUpdateMappings,
}: MappingConfigPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterPreset, setFilterPreset] = useState<OscPreset | "all">("all");
  const [filterEndpointId, setFilterEndpointId] = useState<"all" | string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [localMappings, setLocalMappings] = useState<OscMapping[]>(mappings);
  const [batchEndpointId, setBatchEndpointId] = useState<string>("");

  // Sync local state when the prop changes (e.g. different recording loaded)
  useEffect(() => {
    setLocalMappings(mappings);
    setSelectedIds(new Set());
    setEditingId(null);
  }, [mappings]);

  const filtered = localMappings.filter((m) => {
    if (filterPreset !== "all" && m.preset !== filterPreset) return false;
    if (filterEndpointId !== "all" && m.endpointId !== filterEndpointId) return false;
    return true;
  });

  const updateMapping = (updated: OscMapping) => {
    const next = localMappings.map((m) => (m.id === updated.id ? updated : m));
    setLocalMappings(next);
    onUpdateMappings(next);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const applyBatchEndpoint = () => {
    if (!batchEndpointId) return;
    const next = localMappings.map((m) =>
      selectedIds.has(m.id) ? { ...m, endpointId: batchEndpointId } : m,
    );
    setLocalMappings(next);
    onUpdateMappings(next);
    setSelectedIds(new Set());
    setBatchEndpointId("");
  };

  return (
    <div className="border-t border-white/5 shrink-0">
      {/* Collapsible header */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span>
          OSC Mapping Config
          <span className="ml-2 text-gray-600">({localMappings.length})</span>
        </span>
        <span className="text-gray-600 text-[10px]">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="flex flex-col" style={{ maxHeight: "40vh" }}>
          {/* Filter bar */}
          <div className="flex items-center gap-3 px-4 py-2 border-t border-white/5 bg-surface-light shrink-0">
            <span className="text-xs text-gray-500">Filter:</span>
            <select
              value={filterPreset}
              onChange={(e) => setFilterPreset(e.target.value as OscPreset | "all")}
              className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300"
            >
              <option value="all">All types</option>
              <option value="custom">Custom</option>
              <option value="unreal">Unreal</option>
              <option value="resolume">Resolume</option>
            </select>
            <select
              value={filterEndpointId}
              onChange={(e) => setFilterEndpointId(e.target.value)}
              className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300"
            >
              <option value="all">All endpoints</option>
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.name} ({ep.host}:{ep.port})
                </option>
              ))}
            </select>
          </div>

          {/* Mapping rows */}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="text-center text-sm text-gray-600 py-6">
                No mappings match the filter
              </div>
            ) : (
              filtered.map((mapping) => (
                <MappingRow
                  key={mapping.id}
                  mapping={mapping}
                  endpoints={endpoints}
                  aliases={aliases}
                  isSelected={selectedIds.has(mapping.id)}
                  isEditing={editingId === mapping.id}
                  flashTrigger={flashTriggers[mapping.id] ?? 0}
                  onToggleSelect={() => toggleSelect(mapping.id)}
                  onToggleEdit={() =>
                    setEditingId((prev) => (prev === mapping.id ? null : mapping.id))
                  }
                  onUpdate={updateMapping}
                />
              ))
            )}
          </div>

          {/* Batch action bar — visible when ≥1 row selected */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 border-t border-white/5 bg-surface-light shrink-0">
              <span className="text-xs text-gray-400">{selectedIds.size} selected</span>
              <span className="text-xs text-gray-600">Reassign endpoint:</span>
              <select
                value={batchEndpointId}
                onChange={(e) => setBatchEndpointId(e.target.value)}
                className="text-xs bg-surface border border-white/10 rounded px-2 py-1 text-gray-300 flex-1 max-w-[220px]"
              >
                <option value="">Choose endpoint…</option>
                {endpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name} — {ep.host}:{ep.port}
                  </option>
                ))}
              </select>
              <button
                onClick={applyBatchEndpoint}
                disabled={!batchEndpointId}
                className="text-xs px-3 py-1 rounded bg-accent/80 hover:bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Apply
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs px-2 py-1 text-gray-500 hover:text-gray-300 transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/live/mapping-config-panel.tsx
git commit -m "feat(live): add MappingConfigPanel with inline edit and batch endpoint reassign"
```

---

## Task 7: Wire up `LivePage`

**Files:**
- Create: `src/app/live/page.tsx`

The page loads endpoints (same IPC call as the Timeline page), passes the loaded recording + endpoints to `useLiveMonitor`, computes per-mapping flash triggers from the entry list, and assembles the three zones. When no recording is loaded it shows a prompt.

Mapping changes call `recorder.patchRecording({ oscMappings })`, which marks the recording unsaved in the shared context — the user saves from the Timeline tab.

- [ ] **Step 1: Create `src/app/live/page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRecorderContext } from "@/contexts/recorder-context";
import { useLiveMonitor } from "@/hooks/use-live-monitor";
import { DeviceStrip } from "@/components/live/device-strip";
import { ActivityFeed } from "@/components/live/activity-feed";
import { MappingConfigPanel } from "@/components/live/mapping-config-panel";
import type { OscMapping, SavedEndpoint } from "@/lib/types";

export default function LivePage() {
  const recorder = useRecorderContext();
  const recording = recorder.recording;

  const [endpoints, setEndpoints] = useState<SavedEndpoint[]>([]);
  const [showUnmapped, setShowUnmapped] = useState(true);

  useEffect(() => {
    window.electronAPI?.invoke("endpoints:get-all", "sender").then((res) => {
      setEndpoints((res as SavedEndpoint[]) ?? []);
    });
  }, []);

  const { entries, deviceActivity } = useLiveMonitor({ recording, endpoints });

  // Build a map of mappingId → most recent wallMs for flash triggers in the mapping table
  const mappingFlashTriggers = useMemo(() => {
    const result: Record<string, number> = {};
    for (const entry of entries) {
      if (!entry.mapping) continue;
      const id = entry.mapping.id;
      if (!result[id] || entry.wallMs > result[id]) {
        result[id] = entry.wallMs;
      }
    }
    return result;
  }, [entries]);

  const handleUpdateMappings = useCallback(
    (mappings: OscMapping[]) => {
      recorder.patchRecording({ oscMappings: mappings });
    },
    [recorder],
  );

  if (!recording) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Load a recording in the Timeline tab to start live monitoring.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden -mx-6 -mb-6">
      {/* Zone 1 — Device strip */}
      <DeviceStrip
        devices={recording.devices}
        deviceActivity={deviceActivity}
        aliases={recording.deviceAliases}
      />

      {/* Zone 2 — Activity feed */}
      <ActivityFeed
        entries={entries}
        showUnmapped={showUnmapped}
        onToggleUnmapped={setShowUnmapped}
        endpoints={endpoints}
        aliases={recording.deviceAliases}
      />

      {/* Zone 3 — Mapping config (collapsible) */}
      <MappingConfigPanel
        mappings={recording.oscMappings ?? []}
        endpoints={endpoints}
        aliases={recording.deviceAliases}
        flashTriggers={mappingFlashTriggers}
        onUpdateMappings={handleUpdateMappings}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start the app and manually test the Live tab**

```bash
cd /Users/rense/Projects/osc_tool && pnpm electron:dev
```

Verify:
- "Live" nav item appears in sidebar between Timeline and Diagnostics
- Without a recording loaded: empty state prompt is shown
- With a recording loaded: device strip appears with device cards
- Sending MIDI: blue MIDI dot flashes on the relevant device card
- If the MIDI matches a mapping: amber OSC dot flashes; activity feed row appears with address + endpoint info
- Unmapped events appear greyed-out when "Show unmapped events" is checked, hidden when unchecked
- Clicking "▼" in the mapping config header expands the panel
- Filter by type and endpoint work correctly
- Clicking "edit" on a row expands inline fields; changes are reflected immediately in the address column
- Selecting rows and reassigning endpoint updates all selected mappings

- [ ] **Step 4: Commit**

```bash
git add src/app/live/page.tsx
git commit -m "feat(live): add LivePage assembling device strip, activity feed, and mapping config"
```
