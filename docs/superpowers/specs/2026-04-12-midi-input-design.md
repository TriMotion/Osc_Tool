# MIDI Input — Design Spec

**Date:** 2026-04-12
**Feature:** MIDI-to-OSC bridge

---

## Overview

Add a MIDI input system to Oscilot that listens to connected MIDI devices and converts incoming messages to OSC, sending them to a configured target. This is a bridge feature, not a full MIDI sender/receiver — MIDI comes in, OSC goes out.

---

## Architecture

```
MIDI Devices (hardware)
    │
    ▼
┌─────────────────────────────────────┐
│  midi-manager.ts (Main Process)     │
│  • @julusian/midi for device access │
│  • Enumerates & opens all inputs    │
│  • Parses raw MIDI → MidiEvent      │
│  • Applies custom mapping rules     │
│  • Falls back to auto-mapping       │
│  • Sends OSC via osc-manager        │
│  • Emits batched events to IPC      │
└──────────┬──────────────────────────┘
           │ IPC (batched 50ms)
           ▼
┌─────────────────────────────────────┐
│  Renderer — MIDI Tab                │
│  • Device list + filter toggles     │
│  • OSC target config                │
│  • Mapping rules table editor       │
│  • Dual message log (MIDI + OSC)    │
└─────────────────────────────────────┘
```

- `midi-manager.ts` follows the same EventEmitter pattern as `osc-manager.ts`
- Reuses `osc-manager.sendMessage()` for OSC output — no duplication
- Message batching at 50ms intervals, same as existing OSC pipeline
- State persisted via `midi-store.ts`, same pattern as `endpoints-store.ts`

---

## MIDI Library

**`@julusian/midi`** — N-API fork of `node-midi` (RtMidi under the hood).

- N-API bindings: more stable across Electron upgrades than legacy `node-midi`
- Ships TypeScript types
- Actively maintained
- Requires `electron-rebuild` post-install (same as any native dependency)

---

## MIDI Message Types & Auto-Mapping

Supported types. Values normalized to floats unless noted.

| MIDI Message        | OSC Address                          | OSC Args                   |
|---------------------|--------------------------------------|----------------------------|
| Note On             | `/midi/ch{1-16}/note/{0-127}/on`     | `f` velocity (0.0–1.0)     |
| Note Off            | `/midi/ch{1-16}/note/{0-127}/off`    | `f` velocity (0.0–1.0)     |
| CC                  | `/midi/ch{1-16}/cc/{0-127}`          | `f` value (0.0–1.0)        |
| Pitch Bend          | `/midi/ch{1-16}/pitch`               | `f` value (-1.0–1.0)       |
| Aftertouch (channel)| `/midi/ch{1-16}/aftertouch`          | `f` pressure (0.0–1.0)     |
| Aftertouch (poly)   | `/midi/ch{1-16}/aftertouch/{0-127}`  | `f` pressure (0.0–1.0)     |
| Program Change      | `/midi/ch{1-16}/program`             | `i` program (0–127)        |

**Normalization rules:**
- MIDI values 0–127 → float 0.0–1.0 (divide by 127)
- Pitch bend 0–16383 → float -1.0–1.0 (center at 8192)
- Note on with velocity 0 is treated as note off (standard MIDI convention)
- Program change sends raw int (0–127), not normalized
- Channel is 1-indexed in OSC address (human-friendly); MIDI protocol is 0-indexed internally

---

## Custom Mapping Rules

Rules override auto-mapping for specific MIDI events. Evaluated top-down; first match wins. Auto-mapping is the implicit fallback.

```typescript
interface MidiMappingRule {
  id: string;
  type: "noteon" | "noteoff" | "cc" | "pitch" | "aftertouch" | "program";
  channel?: number;       // 1–16, undefined = any channel
  data1?: number;         // note or CC number, undefined = any
  address: string;        // OSC address override, e.g. "/fader/master"
  argType: "f" | "i";    // float or int output
  scale?: [number, number]; // output range, default [0.0, 1.0]
}
```

**Examples:**
- CC 7 on ch1 → `/fader/master` as float 0.0–1.0
- Note 60 on any channel → `/kick/trigger` as float (velocity)
- CC 1 on ch1 → `/vibrato` scaled to 0.0–2.0

---

## Device Handling

- **Default:** listen to all connected MIDI inputs simultaneously
- **Filtering:** user can toggle individual devices off via the UI
- **Hot-plug:** enumerate devices on start; re-enumerate when the bridge is restarted (no hot-plug detection in v1)
- Device filter state persisted in `midi-store.ts`

---

## OSC Output Target

- Configurable host:port on the MIDI tab (dedicated target)
- Dropdown to pick from saved endpoints (reuses existing `SavedEndpoint` type)
- The active target (host:port) is persisted in `midi-store.ts` alongside device filters and mapping rules

---

## IPC Channels

Added to `electron/ipc-handlers.ts`:

```
midi:get-devices          → string[]           list available MIDI input device names
midi:start                → void               open all inputs, start bridge
midi:stop                 → void               close all inputs, stop bridge
midi:get-status           → boolean            is bridge running?
midi:get-mapping-rules    → MidiMappingRule[]  load from store
midi:set-mapping-rules    → void               save to store
midi:get-device-filters   → string[]           disabled device names
midi:set-device-filters   → void               save to store
midi:events               → MidiEvent[]        batched push (50ms), MIDI+OSC pairs
```

---

## TypeScript Types

Added to `src/lib/types.ts`:

```typescript
interface MidiEvent {
  midi: {
    type: "noteon" | "noteoff" | "cc" | "pitch" | "aftertouch" | "program";
    channel: number;     // 1–16
    data1: number;       // note or CC number
    data2: number;       // velocity, value, pressure
    timestamp: number;   // Date.now()
    deviceName: string;
  };
  osc: OscMessage;       // the converted OSC output (uses existing type)
}

interface MidiMappingRule {
  id: string;
  type: "noteon" | "noteoff" | "cc" | "pitch" | "aftertouch" | "program";
  channel?: number;
  data1?: number;
  address: string;
  argType: "f" | "i";
  scale?: [number, number];
}
```

---

## New Files

| File | Purpose |
|------|---------|
| `electron/midi-manager.ts` | `@julusian/midi` wrapper, EventEmitter, parsing, mapping, OSC output |
| `electron/midi-store.ts` | Persists `{ deviceFilters, mappingRules }` to `midi.json` |
| `src/hooks/use-midi.ts` | React hook wrapping all MIDI IPC channels |
| `src/app/midi/page.tsx` | MIDI tab page |

**Modified files:**
| File | Change |
|------|--------|
| `electron/ipc-handlers.ts` | Register all `midi:*` handlers |
| `electron/main.ts` | Instantiate `MidiManager`, wire events to renderer |
| `src/lib/types.ts` | Add `MidiEvent`, `MidiMappingRule` |
| `src/components/sidebar.tsx` | Add MIDI nav item |

---

## UI Layout

Stacked layout (consistent with existing Listener tab):

1. **Device row** — pill toggles for connected devices; "All devices" selected by default
2. **OSC target row** — host:port input + saved endpoints dropdown
3. **Mapping rules section** — table with columns: Type, Channel, Note/CC, OSC Address, Scale, Delete. "+ Add rule" button at bottom.
4. **Message log** — two columns: MIDI IN (left) and OSC OUT (right), interleaved by timestamp. Uses existing `message-log` styling.

---

## Out of Scope (v1)

- MIDI output / sending MIDI messages
- SysEx support
- Hot-plug device detection (restart bridge to pick up new devices)
- MIDI clock / timecode
- Deck integration (MIDI → deck item control)
- Web server MIDI forwarding
