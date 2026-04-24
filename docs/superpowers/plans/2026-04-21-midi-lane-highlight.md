# MIDI Lane Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flash timeline lanes and device sections when MIDI events pass through the playhead during playback, and when live MIDI arrives while the timeline is open.

**Architecture:** The flash infrastructure already exists: `flashLane(laneKey)` is defined in `timeline-canvas.tsx` and `flashLaneKeys` is passed down to `DeviceSection` which applies `ring-1 ring-accent/60` to matching lanes. It just needs to be triggered.

Two trigger sources:
1. **Playback** — `useOscPlayback` fires OSC events on a 8ms interval. We add an `onEventFired(eventIdx)` callback there. In `page.tsx` we map `eventIdx → recording.events[eventIdx] → laneKey` and call `flashLane`.
2. **Live MIDI** — `useMidiEvents` hook already exists in `use-midi.ts`. Subscribe in `page.tsx`, map each `MidiEvent → laneKey`, call `flashLane`.

`flashLane` state is already internal to `timeline-canvas.tsx`. We expose it upward via a `useImperativeHandle` ref so `page.tsx` can call it without lifting the state.

We also need `evtToLaneKey` exported from `osc-mapping.ts` (currently private) and a `midiEventToLaneKey` helper for raw MidiEvents (note-on/off → notes lane, cc → cc lane, etc.).

**Tech Stack:** React, TypeScript, `useImperativeHandle`, `forwardRef`

---

### Task 1: Export `evtToLaneKey` and add `midiEventToLaneKey` in `osc-mapping.ts`

**Files:**
- Modify: `src/lib/osc-mapping.ts:30-43`

`evtToLaneKey` is private. Export it. Also add `midiEventToLaneKey` for raw `MidiEvent` (which handles noteon/noteoff → notes lane, not covered by `evtToLaneKey`).

- [ ] **Step 1: Export `evtToLaneKey` and add `midiEventToLaneKey`**

In `src/lib/osc-mapping.ts`, update the import at line 1 and replace lines 30–43:

```typescript
import type { LaneKey, MidiEvent, OscMapping, RecordedEvent } from "./types";
import { laneKeyString } from "./types";
```

Replace the `evtToLaneKey` function with an exported version and add `midiEventToLaneKey`:

```typescript
export function evtToLaneKey(evt: RecordedEvent): LaneKey | null {
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

/** Map a raw MidiEvent to a LaneKey for flash highlighting. Covers noteon/noteoff → notes lane. */
export function midiEventToLaneKey(evt: MidiEvent): LaneKey | null {
  switch (evt.type) {
    case "noteon":
    case "noteoff":
      return { kind: "notes", device: evt.deviceName };
    case "cc":
      return { kind: "cc", device: evt.deviceName, channel: evt.channel, cc: evt.data1 };
    case "pitch":
      return { kind: "pitch", device: evt.deviceName, channel: evt.channel };
    case "aftertouch":
      return { kind: "aftertouch", device: evt.deviceName, channel: evt.channel };
    case "program":
      return { kind: "program", device: evt.deviceName, channel: evt.channel };
    default:
      return null;
  }
}
```

- [ ] **Step 2: Fix the call site in `matchesMapping` to use the local function**

`evtToLaneKey` at line 65 is now exported — no other change needed there.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/osc-mapping.ts
git commit -m "feat(osc): export evtToLaneKey and add midiEventToLaneKey helper"
```

---

### Task 2: Add `onEventFired` callback to `useOscPlayback`

**Files:**
- Modify: `src/hooks/use-osc-playback.ts`

Add an optional `onEventFired(eventIdx: number)` callback that fires inside the existing 8ms tick loop when an OSC event is dispatched.

- [ ] **Step 1: Update `UseOscPlaybackArgs` and the tick loop**

In `src/hooks/use-osc-playback.ts`, replace the entire file:

```typescript
"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Recording, SavedEndpoint } from "@/lib/types";
import { matchesMapping, computeOscArgValue, resolveOscAddress } from "@/lib/osc-mapping";

interface UseOscPlaybackArgs {
  recording: Recording | null;
  playheadMsRef: React.RefObject<number>;
  isPlaying: boolean;
  endpoints: SavedEndpoint[];
  deviceAliases?: Record<string, string>;
  onEventFired?: (eventIdx: number) => void;
}

export function useOscPlayback({ recording, playheadMsRef, isPlaying, endpoints, deviceAliases, onEventFired }: UseOscPlaybackArgs) {
  const firedRef = useRef<Set<string>>(new Set());
  const lastPlayheadRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(false);

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const endpointsRef = useRef(endpoints);
  useEffect(() => { endpointsRef.current = endpoints; }, [endpoints]);

  const onEventFiredRef = useRef(onEventFired);
  useEffect(() => { onEventFiredRef.current = onEventFired; }, [onEventFired]);

  const queue = useMemo(() => {
    if (!recording?.oscMappings?.length) return [];
    const result: Array<{ tRel: number; eventIdx: number; mappingId: string; address: string; value: number; argType: "f" | "i"; endpointId: string }> = [];

    recording.events.forEach((evt, idx) => {
      for (const mapping of recording.oscMappings!) {
        if (!matchesMapping(evt, mapping)) continue;
        const address = resolveOscAddress(mapping, deviceAliases, evt.midi.type === "noteon" ? evt.midi.data2 : undefined);
        const value = computeOscArgValue(evt, mapping);
        const endpointIds = [mapping.endpointId, ...(mapping.extraEndpointIds ?? [])];
        for (const epId of endpointIds) {
          result.push({ tRel: evt.tRel, eventIdx: idx, mappingId: mapping.id, address, value, argType: mapping.argType, endpointId: epId });
        }
      }
    });

    return result;
  }, [recording?.id, recording?.oscMappings, deviceAliases]);

  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    const tick = () => {
      const playheadMs = playheadMsRef.current ?? 0;
      const playing = isPlayingRef.current;
      const q = queueRef.current;

      if (playheadMs < lastPlayheadRef.current - 100) {
        firedRef.current.clear();
      }
      lastPlayheadRef.current = playheadMs;

      if (playing && !wasPlayingRef.current) {
        for (const item of q) {
          if (item.tRel > playheadMs) break;
          firedRef.current.add(`${item.eventIdx}-${item.mappingId}-${item.endpointId}`);
        }
      }
      wasPlayingRef.current = playing;

      if (!playing || q.length === 0) return;

      for (const item of q) {
        if (item.tRel > playheadMs) break;
        const key = `${item.eventIdx}-${item.mappingId}-${item.endpointId}`;
        if (firedRef.current.has(key)) continue;
        firedRef.current.add(key);

        const endpoint = endpointsRef.current.find((e) => e.id === item.endpointId);
        if (endpoint) {
          window.electronAPI?.invoke("osc:send", { host: endpoint.host, port: endpoint.port }, item.address, [
            { type: item.argType, value: item.value },
          ]);
        }

        onEventFiredRef.current?.(item.eventIdx);
      }
    };

    const id = setInterval(tick, 8);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-osc-playback.ts
git commit -m "feat(osc-playback): add onEventFired callback for flash highlighting"
```

---

### Task 3: Wire playback + live MIDI flash in `page.tsx`

**Files:**
- Modify: `src/app/timeline/page.tsx`

Add flash state management in `page.tsx` and pass it as a prop to `TimelineCanvas`. Wire `onEventFired` from `useOscPlayback` and subscribe to live MIDI events via `useMidiEvents`.

- [ ] **Step 1: Add `useMidiEvents` import**

In `src/app/timeline/page.tsx`, `useMidiEvents` is already exported from `@/hooks/use-midi` (confirmed at line 6). If not imported, add it:

```typescript
import { useMidiConfig, useMidiControl, useMidiEvents } from "@/hooks/use-midi";
```

- [ ] **Step 2: Add imports for flash helpers**

```typescript
import { evtToLaneKey, midiEventToLaneKey } from "@/lib/osc-mapping";
import { laneKeyString } from "@/lib/types";
```

- [ ] **Step 3: Add flash state after existing state declarations**

Find the block of `useState` declarations in the `TimelinePage` component and add:

```typescript
const [flashLaneKeys, setFlashLaneKeys] = useState<Set<string>>(new Set());
const flashTimerRef = useRef<number | null>(null);

const flashLane = useCallback((laneKey: string) => {
  setFlashLaneKeys((prev) => {
    const next = new Set(prev);
    next.add(laneKey);
    return next;
  });
  if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
  flashTimerRef.current = window.setTimeout(() => setFlashLaneKeys(new Set()), 300);
}, []);
```

Note: 300ms flash duration for responsiveness (the existing timeline-canvas value was 900ms — shorter feels snappier for active playing).

- [ ] **Step 4: Add `onEventFired` callback for playback**

Add this callback near the `useOscPlayback` call:

```typescript
const handlePlaybackEventFired = useCallback((eventIdx: number) => {
  const evt = recorder.recording?.events[eventIdx];
  if (!evt) return;
  // notes lane
  if (evt.midi.type === "noteon" || evt.midi.type === "noteoff") {
    flashLane(laneKeyString({ kind: "notes", device: evt.midi.deviceName }));
    return;
  }
  const lk = evtToLaneKey(evt);
  if (lk) flashLane(laneKeyString(lk));
}, [recorder.recording, flashLane]);
```

- [ ] **Step 5: Pass `onEventFired` to `useOscPlayback`**

Find the `useOscPlayback({...})` call (around line 66) and add:

```typescript
useOscPlayback({
  recording: recorder.recording,
  playheadMsRef,
  isPlaying: audio.isPlaying,
  endpoints,
  deviceAliases,
  onEventFired: handlePlaybackEventFired,
});
```

- [ ] **Step 6: Subscribe to live MIDI events**

After the `useOscPlayback` call, add:

```typescript
useMidiEvents((events) => {
  for (const evt of events) {
    const lk = midiEventToLaneKey(evt);
    if (lk) flashLane(laneKeyString(lk));
  }
});
```

- [ ] **Step 7: Pass `flashLaneKeys` to `TimelineCanvas`**

`TimelineCanvas` already accepts `flashLaneKeys` internally — see Task 4 for making it a prop. For now just add cleanup:

```typescript
useEffect(() => () => {
  if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
}, []);
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: might have errors about `flashLaneKeys` not being a prop of `TimelineCanvas` yet — fix in Task 4.

- [ ] **Step 9: Commit partial work**

```bash
git add src/app/timeline/page.tsx
git commit -m "feat(timeline): wire playback + live MIDI flash events in page"
```

---

### Task 4: Accept `flashLaneKeys` as a prop in `TimelineCanvas`

**Files:**
- Modify: `src/components/timeline/timeline-canvas.tsx`

`flashLaneKeys` is currently internal state (line 154). Move it to a prop so `page.tsx` controls it. Remove the internal state and the `flashLane` function (now owned by page.tsx).

- [ ] **Step 1: Add `flashLaneKeys` to `TimelineCanvasProps`**

In `src/components/timeline/timeline-canvas.tsx`, add to the `TimelineCanvasProps` interface (around line 121, after `onOpenLaneMapping`):

```typescript
flashLaneKeys?: Set<string>;
```

- [ ] **Step 2: Remove internal flash state**

Remove these lines (around line 154–202):

```typescript
const [flashLaneKeys, setFlashLaneKeys] = useState<Set<string>>(new Set());
const flashTimerRef = useRef<number | null>(null);

const flashLane = useCallback((laneKey: string) => {
  setFlashLaneKeys((prev) => {
    const next = new Set(prev);
    next.add(laneKey);
    return next;
  });
  if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
  flashTimerRef.current = window.setTimeout(() => setFlashLaneKeys(new Set()), 900);
}, []);

useEffect(() => {
  return () => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
  };
```

- [ ] **Step 3: Use `props.flashLaneKeys` where `flashLaneKeys` is passed to DeviceSection**

Find the line that passes `flashLaneKeys={flashLaneKeys}` to `DeviceSection` (around line 711) and update:

```tsx
flashLaneKeys={props.flashLaneKeys}
```

- [ ] **Step 4: Pass `flashLaneKeys` from page.tsx to TimelineCanvas**

In `src/app/timeline/page.tsx`, find the `<TimelineCanvas ... />` JSX and add:

```tsx
flashLaneKeys={flashLaneKeys}
```

- [ ] **Step 5: Verify TypeScript compiles with no errors**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/timeline/timeline-canvas.tsx src/app/timeline/page.tsx
git commit -m "feat(timeline): lift flashLaneKeys to page.tsx, wire MIDI lane highlight"
```
