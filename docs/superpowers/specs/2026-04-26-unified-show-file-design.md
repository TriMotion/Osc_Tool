# Unified Show File & OSC Effect Triggers — Design Spec

## Goal

Consolidate all show data into a single self-contained recording file. Share recording state across all tabs so every page sees and can edit the same show. Add an OSC-to-OSC-effects trigger system mirroring the existing OSC-to-DMX triggers. Add section linking to both trigger types so they only fire during a specific timeline section.

## Architecture

The recording file becomes the single source of truth for a show. Everything needed to reproduce output — endpoints, effects, triggers, mappings, sections — lives inside the `Recording` object. A shared recording context at the layout level ensures all pages work with the same recording, surviving Next.js app router page navigation. Global stores remain as seed data for new recordings and for standalone editing when no recording is loaded.

Incoming OSC message dispatch moves from the Electron main process (`OscDmxBridge`) to the renderer, matching how MIDI dispatch already works via `use-live-monitor`. Main process forwards incoming OSC messages to the renderer via IPC; the renderer filters by active section and dispatches to engines via IPC.

---

## 1. Shared Recording Context

### Problem

Currently each page manages its own `useRecorder` instance. The timeline, deck, and output pages have independent recording state. When everything lives in the recording, all tabs need to see and edit the same recording, and save must be available from any tab.

### Solution

A `RecordingProvider` context at the root layout level wraps all pages:

```typescript
interface RecordingContextValue {
  recording: Recording | null;
  hasUnsaved: boolean;
  loadedFromPath: string | null;

  setLoaded: (rec: Recording, path?: string) => void;
  patchRecording: (patch: Partial<Recording>) => void;
  clear: () => void;

  // Recording flow
  start: () => void;
  stop: () => void;
  state: "idle" | "recording" | "stopped";

  // Save/load
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  load: () => Promise<void>;

  // Buffer access for timeline playback
  bufferRef: React.MutableRefObject<RecordedEvent[]>;
  bufferVersion: number;
}
```

The existing `useRecorder` hook logic moves into this provider. Pages consume it via `useSharedRecording()` instead of each creating their own `useRecorder`.

### What changes per page

- **Timeline page** — replaces its `useRecorder()` call with `useSharedRecording()`. All playback, editing, section management works the same but on the shared state.
- **Deck/Live page** — replaces its `useRecorder()` call with `useSharedRecording()`. Loading a recording on the deck page makes it available on all other pages.
- **Output page** — gains recording awareness. When a recording is loaded, effects/triggers/endpoints are read from and written to the recording. When no recording is loaded, falls back to global stores for standalone editing.
- **Sidebar** — can show the recording name and unsaved indicator since it has access to the shared context. Save can be triggered from the sidebar.

### Navigation behavior

Because the provider lives at the layout level, navigating between pages preserves the recording state. Loading a recording on the timeline page, then navigating to the deck page, shows the same recording. This replaces the current behavior where each page loads independently.

---

## 2. Unified Recording Type

### New fields on `Recording`

```typescript
export interface Recording {
  // ... existing fields (events, sections, oscMappings, deviceAliases, etc.) ...

  endpoints?: SavedEndpoint[];
  dmxConfig?: SacnConfig;
  dmxEffects?: DmxEffect[];
  dmxTriggers?: OscDmxTrigger[];
  oscEffects?: OscEffect[];
  oscEffectTriggers?: OscEffectTrigger[];
}
```

All new fields are optional for backward compatibility with existing `.oscrec` files.

### Section linking on `OscDmxTrigger`

```typescript
export interface OscDmxTrigger {
  id: string;
  name: string;
  oscAddress: string;
  mode: "match-only" | "passthrough";
  dmxEffectId?: string;
  dmxChannels?: number[];
  inputMin?: number;
  inputMax?: number;
  outputMin?: number;
  outputMax?: number;
  sectionId?: string;  // NEW — only active during this section
}
```

### New `OscEffectTrigger` type

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
  velocityFromValue?: boolean;  // map incoming OSC value (0-1) as velocity scale
}
```

No passthrough mode — OSC effects are always triggered. `velocityFromValue` provides dynamic control by using the incoming OSC message value as the velocity scale for the effect.

---

## 3. OSC Message Forwarding to Renderer

### Remove `OscDmxBridge`

The `electron/osc-dmx-bridge.ts` class is removed. Its dispatch logic moves to the renderer.

### Main process forwarding

In `ipc-handlers.ts`, the OSC manager forwards all incoming messages to the renderer window:

```typescript
oscManager.on("message", (msg: OscMessage) => {
  mainWindow?.webContents.send("osc:incoming", msg);
});
```

### Renderer hooks

**`useOscEvents(callback)`** — new hook mirroring `useMidiEvents`. Subscribes to `"osc:incoming"` from the main process and calls the callback for each message.

**`useOscTriggerMonitor({ recording, activeSectionId })`** — new hook that:
1. Consumes `useOscEvents`
2. For each incoming OSC message, iterates through `recording.dmxTriggers` and `recording.oscEffectTriggers`
3. Filters by `activeSectionId` — triggers with no `sectionId` always fire; triggers with a `sectionId` only fire when that section is active
4. DMX triggers: calls `dmx:trigger-effect` (match-only) or `dmx:set-channel` (passthrough) via IPC
5. OSC effect triggers: calls `osc-effect:trigger` via IPC with the target endpoint, address, argType, and velocity scale

This matches how `use-live-monitor` handles MIDI → OSC/DMX dispatch in the renderer.

---

## 4. Save/Load & Migration

### Saving

No change to the serialization mechanism. `recording-store.ts` already serializes the full `Recording` object as JSON (with streaming for large event arrays). The new fields are included automatically.

### Loading — backward compatibility

When loading an existing `.oscrec` file that lacks the new fields, populate them from the global stores as a one-time migration:

- Missing `endpoints` → copy from `endpoints-store`
- Missing `dmxConfig` → copy from `dmx-store`
- Missing `dmxEffects` → copy from `dmx-store`
- Missing `dmxTriggers` → copy from `dmx-store`
- Missing `oscEffects` → copy from `osc-effect-store`
- Missing `oscEffectTriggers` → empty array (new feature, no legacy data)

This happens in the renderer after `setLoaded(rec)` — the hook checks for missing fields and fills them in. No format version bump needed since all fields are optional.

### Global stores as seed data

When starting a new recording or creating a blank project, copy the current global endpoints/effects/triggers into the recording as defaults. The global stores (`endpoints-store.ts`, `dmx-store.ts`, `osc-effect-store.ts`) continue to serve this purpose and also serve as the editing target when no recording is loaded (e.g., the output page in standalone mode).

---

## 5. Frontend Hook Changes

### Recording-aware hooks

`useDmx`, `useOscEffects`, and `useEndpoints` consume the shared recording context internally:

```typescript
function useDmx()       // reads from shared recording if loaded, else global store
function useOscEffects() // same pattern
function useEndpoints()  // same pattern
```

Each hook calls `useSharedRecording()` internally. When a recording is loaded, reads and mutations target the recording (via `patchRecording()`). When no recording is loaded, they fall back to the global store via IPC.

This means:
- **Any page with a loaded recording** → edits go to the recording
- **Any page without a recording** → edits go to the global store (standalone effect/trigger design)

### New `useOscTriggerMonitor` hook

Used on the deck/live page alongside `useLiveMonitor`. Consumes the shared recording context and `activeSectionId`. Handles both DMX trigger and OSC effect trigger dispatch from incoming OSC messages.

---

## 6. UI Changes

### OSC Effects tab — trigger panel

The OSC Effects tab on the output page gains an "OSC Triggers" section below the effects list. Pattern mirrors the existing `OscTriggerPanel` in the DMX tab.

**Trigger list row:** Name, OSC Address, Effect name, Section name (if linked).

**Trigger editor fields:**
- Name (text)
- OSC Address (text — incoming address to match)
- OSC Effect (dropdown — from recording's `oscEffects`)
- Target Endpoint (dropdown — recording's sender endpoints)
- Target Address (text — address the effect writes to)
- Arg Type (`f` / `i` toggle)
- Velocity from Value (checkbox)
- Section (dropdown — recording's `sections` plus "All sections")

### DMX tab — section linking

The existing `OscTriggerPanel` gains a **Section** dropdown in each trigger's editor. Same dropdown pattern as the OSC effect trigger editor.

### Deck/Live page

No new UI. `useOscTriggerMonitor` runs alongside `useLiveMonitor`, sharing `activeSectionId` from the existing section selector.

---

## 7. Deletion of Legacy Code

- **`electron/osc-dmx-bridge.ts`** — removed entirely
- **`ipc-handlers.ts`** — remove `OscDmxBridge` instantiation and trigger-reload calls
- **Global store IPC channels for triggers** (`dmx:get-triggers`, `dmx:save-trigger`, `dmx:delete-trigger`) — kept for the no-recording fallback on the output page
- **Global store IPC channels for effects and endpoints** — kept for the same reason
