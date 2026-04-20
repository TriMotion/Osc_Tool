# Device Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rename MIDI recording devices with a display alias that shows in the timeline UI and in generated OSC addresses.

**Architecture:** A `deviceAliases?: Record<string, string>` map (original MIDI name → display name) is stored on `Recording`. Original names remain as stable internal identifiers. A `resolveDeviceName` helper resolves the alias at render/playback time. The inline rename UI lives in the `DeviceSection` header (double-click to edit). The alias flows to three consumers: the DeviceSection header, the HoverCard, and `resolveOscAddress` (for the Unreal Engine preset's device path segment).

**Tech Stack:** TypeScript, React, Next.js, Tailwind CSS. No test framework — verify with `pnpm exec tsc --noEmit`.

---

## File Map

| File | Change |
|------|--------|
| `src/lib/types.ts` | Add `deviceAliases?: Record<string, string>` to `Recording` |
| `src/lib/osc-mapping.ts` | Export `resolveDeviceName`; add optional `aliases` param to `resolveOscAddress` |
| `src/components/timeline/osc-mapping-editor.tsx` | Add `deviceAliases?` prop; pass to `resolveOscAddress` |
| `src/components/timeline/device-section.tsx` | Add `displayName?` + `onRenameDevice?` props; inline-edit UI in header |
| `src/components/timeline/hover-card.tsx` | Add `aliases?` prop; use `resolveDeviceName` for device rows |
| `src/components/timeline/timeline-canvas.tsx` | Add `deviceAliases?` + `onRenameDevice?` props; thread to DeviceSection and HoverCard |
| `src/hooks/use-osc-playback.ts` | Add `deviceAliases?` to args; pass to `resolveOscAddress` |
| `src/app/timeline/page.tsx` | Add `saveDeviceAlias` callback; wire `deviceAliases` and `onRenameDevice` |

---

### Task 1: Add `deviceAliases` to the `Recording` type

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add the field**

In `src/lib/types.ts`, find the `Recording` interface (around line 196). Add one line after `oscMappings?`:

```typescript
export interface Recording {
  version: 1;
  id: string;
  name: string;
  startedAt: number;
  durationMs: number;
  events: RecordedEvent[];
  devices: string[];
  mappingRulesSnapshot: MidiMappingRule[];
  audio?: AudioRef;
  audioTracks?: AudioTrack[];
  badges?: LaneBadge[];
  moments?: Moment[];
  sections?: TimelineSection[];
  noteTags?: NoteGroupTag[];
  hiddenLanes?: string[];
  hiddenNoteGroups?: string[];
  oscMappings?: OscMapping[];
  deviceAliases?: Record<string, string>;   // original device name → display name
  suppressedAnalysis?: string[];
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors (field is optional, no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(device-rename): add deviceAliases field to Recording type"
```

---

### Task 2: Add `resolveDeviceName` helper and update `resolveOscAddress`

**Files:**
- Modify: `src/lib/osc-mapping.ts`

- [ ] **Step 1: Add `resolveDeviceName` and update `resolveOscAddress`**

Replace the full contents of `src/lib/osc-mapping.ts` with:

```typescript
import type { LaneKey, OscMapping, RecordedEvent } from "./types";
import { laneKeyString } from "./types";

export function resolveDeviceName(name: string, aliases?: Record<string, string>): string {
  return aliases?.[name] ?? name;
}

export function resolveOscAddress(mapping: OscMapping, aliases?: Record<string, string>): string {
  switch (mapping.preset) {
    case "custom":
      return mapping.address ?? "/";
    case "unreal": {
      const [pitch, velocity] = mapping.targetId.split("|");
      const section = mapping.sectionName ?? "default";
      const deviceName = resolveDeviceName(mapping.deviceId, aliases);
      return `/unreal/${section}/${deviceName}/${pitch}/${velocity}`;
    }
    case "resolume":
      return mapping.resolumeMode === "column"
        ? `/composition/columns/${mapping.resolumeColumn ?? 1}/connect`
        : `/composition/layers/${mapping.resolumeLayer ?? 1}/clips/${mapping.resolumeClip ?? 1}/connect`;
  }
}

export function noteGroupTargetId(pitch: number, velocity: number): string {
  return `${pitch}|${velocity}`;
}

function evtToLaneKey(evt: RecordedEvent): LaneKey | null {
  switch (evt.midi.type) {
    case "cc":
      return { kind: "cc", device: evt.midi.deviceName, channel: evt.midi.channel, cc: evt.midi.data1 };
    case "pitch":
      return { kind: "pitch", device: evt.midi.deviceName, channel: evt.midi.channel };
    case "aftertouch":
      return { kind: "aftertouch", device: evt.midi.deviceName, channel: evt.midi.channel };
    case "program":
      return { kind: "program", device: evt.midi.deviceName, channel: evt.midi.channel };
    default:
      return null;
  }
}

export function matchesMapping(evt: RecordedEvent, mapping: OscMapping): boolean {
  if (evt.midi.deviceName !== mapping.deviceId) return false;

  if (mapping.targetType === "noteGroup") {
    const [pitchStr, velocityStr] = mapping.targetId.split("|");
    const pitch = parseInt(pitchStr, 10);
    const velocity = parseInt(velocityStr, 10);

    if ((mapping.trigger === "on" || mapping.trigger === "both") && evt.midi.type === "noteon") {
      return evt.midi.data1 === pitch && evt.midi.data2 === velocity;
    }
    if ((mapping.trigger === "off" || mapping.trigger === "both") && evt.midi.type === "noteoff") {
      // Note-off events don't carry the originating note-on velocity, so we match
      // on pitch only — all velocity variants of this pitch will fire on note-off.
      return evt.midi.data1 === pitch;
    }
    return false;
  }

  if (mapping.targetType === "lane") {
    const laneKey = evtToLaneKey(evt);
    return laneKey !== null && laneKeyString(laneKey) === mapping.targetId;
  }

  return false;
}

export function computeOscArgValue(evt: RecordedEvent, mapping: OscMapping): number {
  if (mapping.targetType === "noteGroup") {
    const isOn = evt.midi.type === "noteon";
    return mapping.argType === "f" ? (isOn ? 1.0 : 0.0) : (isOn ? 1 : 0);
  }
  return mapping.argType === "f" ? evt.midi.data2 / 127 : evt.midi.data2;
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors (existing callers pass no `aliases` arg — that's fine, it's optional).

- [ ] **Step 3: Commit**

```bash
git add src/lib/osc-mapping.ts
git commit -m "feat(device-rename): add resolveDeviceName helper, aliases param to resolveOscAddress"
```

---

### Task 3: Pass `deviceAliases` to `OscMappingEditor` for address preview

**Files:**
- Modify: `src/components/timeline/osc-mapping-editor.tsx`

- [ ] **Step 1: Add `deviceAliases?` prop and use it in the preview**

Update the props interface and destructuring, and update both `resolveOscAddress` calls:

```typescript
// Add to imports at top
import { resolveDeviceName } from "@/lib/osc-mapping";

// Updated interface
interface OscMappingEditorProps {
  targetType: "noteGroup" | "lane";
  targetId: string;
  deviceId: string;
  mappings: OscMapping[];
  endpoints: SavedEndpoint[];
  defaultEndpointId: string | undefined;
  sections: TimelineSection[];
  deviceAliases?: Record<string, string>;
  anchorRect: DOMRect;
  onAdd: (mapping: OscMapping) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

// Updated function signature
export function OscMappingEditor({
  targetType, targetId, deviceId, mappings, endpoints, defaultEndpointId,
  sections, deviceAliases, anchorRect, onAdd, onDelete, onClose,
}: OscMappingEditorProps) {
```

Then update the two `resolveOscAddress` calls to pass `deviceAliases`:

```typescript
// Line ~49 — preview address
const preview = resolveOscAddress(previewMapping, deviceAliases);

// Line ~84 — existing mappings list
<span className="font-mono text-accent flex-1 truncate">{resolveOscAddress(m, deviceAliases)}</span>
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/osc-mapping-editor.tsx
git commit -m "feat(device-rename): pass deviceAliases to OscMappingEditor address preview"
```

---

### Task 4: Inline rename UI in DeviceSection header

**Files:**
- Modify: `src/components/timeline/device-section.tsx`

- [ ] **Step 1: Add props**

Add to `DeviceSectionProps` interface (after `onDeleteDevice`):

```typescript
displayName?: string;
onRenameDevice?: (newName: string) => void;
deviceAliases?: Record<string, string>;
```

Add to the destructuring in `DeviceSection` (after `onDeleteDevice`):

```typescript
onDeleteDevice, displayName, onRenameDevice, deviceAliases,
```

- [ ] **Step 2: Add inline-edit state**

Add after the existing `useState` calls (after `oscEditor` state, around line 138):

```typescript
const [isEditingName, setIsEditingName] = useState(false);
const [editValue, setEditValue] = useState("");
```

- [ ] **Step 3: Add edit handlers**

Add after the state declarations:

```typescript
const startNameEdit = (e: React.MouseEvent) => {
  e.stopPropagation();
  setEditValue(displayName ?? device);
  setIsEditingName(true);
};

const commitNameEdit = () => {
  const trimmed = editValue.trim();
  if (trimmed && trimmed !== device) onRenameDevice?.(trimmed);
  setIsEditingName(false);
};

const cancelNameEdit = () => setIsEditingName(false);
```

- [ ] **Step 4: Replace device name span in header**

Find the header line (around line 228):
```tsx
<span>{device}</span>
```

Replace it with:
```tsx
{isEditingName ? (
  <input
    autoFocus
    value={editValue}
    onChange={(e) => setEditValue(e.target.value)}
    onBlur={commitNameEdit}
    onKeyDown={(e) => {
      if (e.key === "Enter") { e.preventDefault(); commitNameEdit(); }
      if (e.key === "Escape") cancelNameEdit();
      e.stopPropagation();
    }}
    onClick={(e) => e.stopPropagation()}
    className="bg-surface-lighter border border-accent/40 rounded px-1 text-xs text-accent font-semibold focus:outline-none min-w-[60px]"
    style={{ width: Math.max(60, editValue.length * 7) }}
  />
) : (
  <span
    className="group/devname flex items-center gap-1 cursor-default"
    onDoubleClick={onRenameDevice ? startNameEdit : undefined}
    title={onRenameDevice ? "Double-click to rename" : undefined}
  >
    {displayName ?? device}
    {onRenameDevice && (
      <span
        className="opacity-0 group-hover/devname:opacity-50 text-[9px] text-gray-500 hover:text-gray-300 cursor-pointer leading-none"
        onClick={startNameEdit}
      >
        ✎
      </span>
    )}
  </span>
)}
```

- [ ] **Step 5: Pass `deviceAliases` to `OscMappingEditor`**

In the `OscMappingEditor` render call (around line 478), add the prop:

```tsx
<OscMappingEditor
  ...
  deviceAliases={deviceAliases}
  ...
/>
```

- [ ] **Step 6: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/timeline/device-section.tsx
git commit -m "feat(device-rename): inline rename UI in DeviceSection header"
```

---

### Task 5: Show alias in HoverCard

**Files:**
- Modify: `src/components/timeline/hover-card.tsx`

- [ ] **Step 1: Add `aliases` prop and use `resolveDeviceName`**

Replace the full contents of `src/components/timeline/hover-card.tsx` with:

```typescript
"use client";

import type { NoteSpan, RecordedEvent } from "@/lib/types";
import { formatTime } from "@/lib/timeline-util";
import { resolveDeviceName } from "@/lib/osc-mapping";

interface HoverCardProps {
  payload:
    | { kind: "event"; event: RecordedEvent }
    | { kind: "span"; span: NoteSpan }
    | null;
  clientX: number;
  clientY: number;
  aliases?: Record<string, string>;
}

export function HoverCard({ payload, clientX, clientY, aliases }: HoverCardProps) {
  if (!payload) return null;
  const left = Math.min(clientX + 12, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240);
  const top = clientY + 12;

  return (
    <div
      className="fixed z-50 text-[10px] font-mono border border-accent/30 rounded px-2 py-1.5 pointer-events-none"
      style={{ left, top, minWidth: 200, background: "#0f0f1e", boxShadow: "0 8px 24px rgba(0,0,0,0.85)" }}
    >
      {payload.kind === "event" && <EventBody evt={payload.event} aliases={aliases} />}
      {payload.kind === "span" && <SpanBody span={payload.span} aliases={aliases} />}
    </div>
  );
}

function EventBody({ evt, aliases }: { evt: RecordedEvent; aliases?: Record<string, string> }) {
  const { midi, osc, tRel } = evt;
  const oscArgs = osc.args.map((a) => (typeof a.value === "number" ? a.value.toFixed(3) : String(a.value))).join(" ");
  return (
    <>
      <Row label="time"   value={formatTime(tRel)} />
      <Row label="device" value={resolveDeviceName(midi.deviceName, aliases)} />
      <Row label="midi"   value={formatMidiLine(evt)} />
      <Row label="osc"    value={`${osc.address} ${oscArgs}`} color="#ffaed7" />
    </>
  );
}

function SpanBody({ span, aliases }: { span: NoteSpan; aliases?: Record<string, string> }) {
  return (
    <>
      <Row label="time"   value={`${formatTime(span.tStart)} – ${formatTime(span.tEnd)}`} />
      <Row label="device" value={resolveDeviceName(span.device, aliases)} />
      <Row label="note"   value={`ch${span.channel} #${span.pitch} vel=${span.velocity}`} />
    </>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex">
      <span className="text-gray-600 w-14 shrink-0">{label}</span>
      <span className="truncate" style={{ color: color ?? "#c7f168" }}>{value}</span>
    </div>
  );
}

function formatMidiLine(evt: RecordedEvent): string {
  const m = evt.midi;
  switch (m.type) {
    case "noteon":     return `NoteOn ch${m.channel} #${m.data1} vel=${m.data2}`;
    case "noteoff":    return `NoteOff ch${m.channel} #${m.data1} vel=${m.data2}`;
    case "cc":         return `CC ch${m.channel} #${m.data1} → ${m.data2}`;
    case "pitch":      return `Pitch ch${m.channel} → ${(m.data2 << 7) | m.data1}`;
    case "aftertouch": return `AT ch${m.channel} ${m.data1}/${m.data2}`;
    case "program":    return `Prog ch${m.channel} → ${m.data1}`;
  }
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors (the `aliases` prop is optional — existing call sites without it still work).

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/hover-card.tsx
git commit -m "feat(device-rename): show device alias in HoverCard"
```

---

### Task 6: Thread `deviceAliases` and `onRenameDevice` through TimelineCanvas

**Files:**
- Modify: `src/components/timeline/timeline-canvas.tsx`

- [ ] **Step 1: Add props to `TimelineCanvasProps`**

In the `TimelineCanvasProps` interface (around line 96, after `onDeleteDevice`), add:

```typescript
deviceAliases?: Record<string, string>;
onRenameDevice?: (originalName: string, newName: string) => void;
```

- [ ] **Step 2: Destructure the new props**

In the destructuring block (around line 126), add:

```typescript
onDeleteDevice, deviceAliases, onRenameDevice,
```

- [ ] **Step 3: Pass aliases and rename handler to each DeviceSection**

In the `<DeviceSection ...>` render call (around line 558), add these props:

```tsx
displayName={deviceAliases?.[device] ?? undefined}
onRenameDevice={(newName) => onRenameDevice?.(device, newName)}
deviceAliases={deviceAliases}
```

- [ ] **Step 4: Pass aliases to HoverCard**

Find the HoverCard render call (around line 669):

```tsx
<HoverCard payload={hover.payload} clientX={hover.x} clientY={hover.y} />
```

Replace with:

```tsx
<HoverCard payload={hover.payload} clientX={hover.x} clientY={hover.y} aliases={deviceAliases} />
```

- [ ] **Step 5: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/timeline/timeline-canvas.tsx
git commit -m "feat(device-rename): thread deviceAliases and onRenameDevice through TimelineCanvas"
```

---

### Task 7: Pass `deviceAliases` to `useOscPlayback`

**Files:**
- Modify: `src/hooks/use-osc-playback.ts`

- [ ] **Step 1: Add `deviceAliases` to the hook args and pass to `resolveOscAddress`**

Replace the full contents of `src/hooks/use-osc-playback.ts` with:

```typescript
"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Recording, SavedEndpoint } from "@/lib/types";
import { matchesMapping, computeOscArgValue, resolveOscAddress } from "@/lib/osc-mapping";

interface UseOscPlaybackArgs {
  recording: Recording | null;
  playheadMs: number;
  isPlaying: boolean;
  endpoints: SavedEndpoint[];
  deviceAliases?: Record<string, string>;
}

export function useOscPlayback({ recording, playheadMs, isPlaying, endpoints, deviceAliases }: UseOscPlaybackArgs) {
  const firedRef = useRef<Set<string>>(new Set());
  const lastPlayheadRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(false);

  // Pre-compute annotated event queue — rebuilt when recording, mappings, or aliases change.
  const queue = useMemo(() => {
    if (!recording?.oscMappings?.length) return [];
    const result: Array<{ tRel: number; eventIdx: number; mappingId: string; address: string; value: number; argType: "f" | "i"; endpointId: string }> = [];

    recording.events.forEach((evt, idx) => {
      for (const mapping of recording.oscMappings!) {
        if (!matchesMapping(evt, mapping)) continue;
        result.push({
          tRel: evt.tRel,
          eventIdx: idx,
          mappingId: mapping.id,
          address: resolveOscAddress(mapping, deviceAliases),
          value: computeOscArgValue(evt, mapping),
          argType: mapping.argType,
          endpointId: mapping.endpointId,
        });
      }
    });

    return result; // already sorted because recording.events is sorted by tRel
  }, [recording?.id, recording?.oscMappings, deviceAliases]);

  useEffect(() => {
    // Detect backward seek and reset fired set.
    if (playheadMs < lastPlayheadRef.current - 100) {
      firedRef.current.clear();
    }
    lastPlayheadRef.current = playheadMs;

    // On transition from paused → playing, seed firedRef with all events already behind
    // the playhead so they don't burst-fire on the first tick after resume/seek.
    if (isPlaying && !wasPlayingRef.current) {
      for (const item of queue) {
        if (item.tRel > playheadMs) break;
        firedRef.current.add(`${item.eventIdx}-${item.mappingId}`);
      }
    }
    wasPlayingRef.current = isPlaying;

    if (!isPlaying || queue.length === 0) return;

    for (const item of queue) {
      if (item.tRel > playheadMs) break;
      const key = `${item.eventIdx}-${item.mappingId}`;
      if (firedRef.current.has(key)) continue;
      firedRef.current.add(key);

      const endpoint = endpoints.find((e) => e.id === item.endpointId);
      if (!endpoint) continue;

      window.electronAPI?.invoke("osc:send", { host: endpoint.host, port: endpoint.port }, item.address, [
        { type: item.argType, value: item.value },
      ]);
    }
  }, [playheadMs, isPlaying, queue, endpoints]);
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-osc-playback.ts
git commit -m "feat(device-rename): pass deviceAliases to useOscPlayback for OSC address resolution"
```

---

### Task 8: Wire everything in `page.tsx`

**Files:**
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: Add `saveDeviceAlias` callback**

After the `deleteOscMapping` callback (around line 358), add:

```typescript
const saveDeviceAlias = useCallback((originalName: string, newName: string) => {
  const rec = recorder.recording;
  if (!rec) return;
  const trimmed = newName.trim();
  const aliases = { ...(rec.deviceAliases ?? {}) };
  if (trimmed && trimmed !== originalName) {
    aliases[originalName] = trimmed;
  } else {
    delete aliases[originalName];
  }
  recorder.patchRecording({ deviceAliases: aliases });
}, [recorder]);
```

- [ ] **Step 2: Pass `deviceAliases` to `useOscPlayback`**

Find the `useOscPlayback` call (around line 9 usage area). Update it to:

```typescript
useOscPlayback({
  recording: recorder.recording,
  playheadMs: audio.playheadMsRef.current,
  isPlaying: audio.isPlaying,
  endpoints,
  deviceAliases: recorder.recording?.deviceAliases,
});
```

- [ ] **Step 3: Pass `deviceAliases` and `onRenameDevice` to `<TimelineCanvas>`**

In the `<TimelineCanvas ...>` JSX (around line 487), add:

```tsx
deviceAliases={recorder.recording?.deviceAliases}
onRenameDevice={saveDeviceAlias}
```

- [ ] **Step 4: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "feat(device-rename): wire saveDeviceAlias, deviceAliases in page"
```

---

### Task 9: Manual verification

- [ ] **Step 1: Start the app**

```bash
pnpm dev
```

Open the app. Load a recording with at least one device.

- [ ] **Step 2: Rename a device**

Hover over the device name in the timeline header. A faint ✎ pencil icon should appear. Double-click the device name. An inline input should replace the text. Type a new name and press Enter. The header should show the new name immediately.

- [ ] **Step 3: Verify OSC address preview**

Open the OSC mapping editor on a note group for the renamed device. Select the Unreal Engine preset. The address preview should show the alias name, not the original MIDI device name (e.g. `/unreal/section/MyAlias/60/100` instead of `/unreal/section/Arturia KeyStep 37/60/100`).

- [ ] **Step 4: Verify hover card**

Hover over an event in the renamed device's lane. The HoverCard's "device" row should show the alias.

- [ ] **Step 5: Verify rename persists**

Save the recording and reload it. The alias should still be applied.

- [ ] **Step 6: Verify cancel**

Double-click the device name, type something, then press Escape. The name should revert to the previous display name.

- [ ] **Step 7: Commit if any fixes were needed**

```bash
git add -p
git commit -m "fix(device-rename): <describe any fixes>"
```
