# Timeline OSC Output Mapping — Design Spec

**Date:** 2026-04-19  
**Branch:** feat/trigger-discovery  
**Status:** Approved

---

## Overview

Add the ability to attach OSC output mappings to note groups and lanes in the Timeline view. During recording playback, matched MIDI events fire configured OSC messages to a selected saved endpoint.

This is scoped to **playback only**. Live MIDI passthrough will be handled separately in the future Live Tab.

---

## 1. Data Model

### New `OscMapping` type (`src/lib/types.ts`)

```typescript
export type OscPreset = "custom" | "unreal" | "resolume";
export type OscTrigger = "on" | "off" | "both";

export interface OscMapping {
  id: string;
  targetType: "noteGroup" | "lane";
  targetId: string;      // note group key (e.g. "60-100") or serialized LaneKey (e.g. "cc:1:7", "pitch:1", "program:1")
  deviceId: string;
  endpointId: string;    // references SavedEndpoint.id
  preset: OscPreset;
  trigger: OscTrigger;   // noteGroup only; lanes always fire on value change
  argType: "f" | "i";
  // custom preset
  address?: string;
  // unreal preset
  unrealType?: "parameter" | "trigger";
  unrealName?: string;
  // resolume preset
  resolumeMode?: "column" | "clip";
  resolumeColumn?: number;
  resolumeLayer?: number;
  resolumeClip?: number;
}
```

### `Recording` type update

Add to the existing `Recording` interface:

```typescript
oscMappings?: OscMapping[];
```

Optional for backwards compatibility with existing recordings.

### Address resolution helper (`src/lib/osc-mapping.ts`)

Pure helper, no side effects:

```typescript
export function resolveOscAddress(mapping: OscMapping): string {
  switch (mapping.preset) {
    case "custom":
      return mapping.address ?? "/";
    case "unreal":
      return mapping.unrealType === "parameter"
        ? `/unreal/parameter/${mapping.unrealName ?? "param"}`
        : `/unreal/trigger/${mapping.unrealName ?? "trigger"}`;
    case "resolume":
      return mapping.resolumeMode === "column"
        ? `/composition/columns/${mapping.resolumeColumn ?? 1}/connect`
        : `/composition/layers/${mapping.resolumeLayer ?? 1}/clips/${mapping.resolumeClip ?? 1}/connect`;
  }
}
```

---

## 2. Playback Integration

### IPC handler (`electron/ipc-handlers.ts`)

Add a generic `osc:send` handler (analogous to `deck:send-osc`):

```typescript
ipcMain.handle("osc:send", async (_e, host: string, port: number, address: string, args: OscArg[]) => {
  await oscManager.sendMessage({ host, port }, address, args);
});
```

### Preload bridge (`electron/preload.ts`)

Expose `oscSend(host, port, address, args)` via the existing bridge pattern.

### Playback hook (`src/hooks/use-osc-playback.ts`)

```typescript
useOscPlayback(recording: Recording, playbackPositionMs: number, endpoints: SavedEndpoint[])
```

Responsibilities:
1. On mount / when `recording.oscMappings` changes, build a sorted event queue from `recording.events`, annotated with matching `OscMapping` entries.
2. On each `playbackPositionMs` tick, fire any queued events whose timestamp has passed and haven't fired yet this playback session.
3. For note groups:
   - `trigger: "on"` → fires on `noteon` events matching the note group's pitch/velocity
   - `trigger: "off"` → fires on `noteoff` events
   - `trigger: "both"` → fires on both; OSC arg value is 1.0 for on, 0.0 for off
4. For CC/continuous lanes: fires on every matching CC event, passing the normalised value (0–1 float or raw 0–127 int) as the OSC arg.
5. Looks up `SavedEndpoint` by `endpointId` to resolve host/port, then calls `window.bridge.oscSend(...)`.
6. Resets the fired-event set when playback restarts from the beginning.

The hook is consumed in `src/app/timeline/page.tsx` alongside the existing `useAudioSync`.

---

## 3. Persistence

OSC mappings are stored as part of the recording file via the existing `RecordingStore`. The `oscMappings` field is written on every save operation (add / delete mapping). No new store or IPC handlers needed beyond the `osc:send` one.

Add IPC handlers for CRUD:
- `recording:add-osc-mapping(recordingId, mapping)` → appends to `oscMappings`, saves
- `recording:delete-osc-mapping(recordingId, mappingId)` → removes by id, saves

---

## 4. UI

### Where it appears

- **Note group panel** — the existing popover/panel for note group editing (same as tag editor). New "OSC" collapsible section added below tags.
- **Lane panel** — continuous/CC/pitch/program lane panels. Same OSC section, minus the trigger selector.

### OSC section layout (per note group or lane)

```
[ Endpoint ▾ ]  (SavedEndpoint dropdown — defaults to last used in this recording)

[ Preset ▾ ]    Custom | Unreal Engine | Resolume

--- Custom ---
  OSC Address: [ /my/address        ]

--- Unreal Engine ---
  Type: ● Parameter  ○ Trigger
  Name: [ param_name ]
  Preview: /unreal/parameter/param_name

--- Resolume ---
  Mode: ● Column  ○ Clip
  Column: [ 1 ]          (column mode)
  Layer:  [ 1 ]  Clip: [ 1 ]   (clip mode)
  Preview: /composition/columns/1/connect

[ Trigger ] On | Off | Both    (note groups only)
[ Arg type ] Float | Int

[ + Add Mapping ]

--- Existing mappings ---
  /unreal/trigger/kick  [on]  via "Resolume local"  [×]
```

### Endpoint default logic

When the mapping form opens:
1. If the recording already has any `oscMappings`, pre-select the `endpointId` of the last one.
2. Otherwise, pre-select the first available `SavedEndpoint`.

This default is held in component state — no persistence needed.

---

## 5. Out of Scope (this iteration)

- Live MIDI passthrough (future Live Tab)
- Per-mapping OSC arg value overrides beyond on/off
- Multiple OSC messages per note group event
- Editing existing mappings (delete + re-add for now)

---

## File Checklist

| File | Change |
|------|--------|
| `src/lib/types.ts` | Add `OscMapping`, `OscPreset`, `OscTrigger`; extend `Recording` |
| `src/lib/osc-mapping.ts` | New — `resolveOscAddress()` helper |
| `src/hooks/use-osc-playback.ts` | New — playback event firing hook |
| `src/app/timeline/page.tsx` | Consume `useOscPlayback` |
| `electron/ipc-handlers.ts` | Add `osc:send` handler |
| `electron/preload.ts` | Expose `oscSend` on bridge |
| `electron/ipc-handlers.ts` | Add `recording:add-osc-mapping`, `recording:delete-osc-mapping` |
| `src/components/timeline/note-tag-editor.tsx` | Add OSC mapping section below tag editor |
| `src/components/timeline/continuous-lane.tsx` | Add OSC section to lane gutter/panel |
| `src/components/timeline/program-lane.tsx` | Add OSC section to lane gutter/panel |
| `src/components/timeline/notes-lane.tsx` | Wire OSC mappings prop through to note-tag-editor |
