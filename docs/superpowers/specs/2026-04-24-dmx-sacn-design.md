# DMX over sACN — Design Spec

## Overview

Add DMX output via sACN (E1.31) to Oscilot. DMX channels are triggered by incoming MIDI events, incoming OSC messages, or manual deck tile interaction. Effects support curve-based sequences with presets and custom cubic bezier curves. Velocity-sensitive scaling from MIDI input.

## Decisions

| Question | Decision |
|----------|----------|
| Mapping integration | Unified — DMX is another output type in the existing mapping system |
| OSC as trigger source | Yes — new capability: incoming OSC triggers DMX effects |
| OSC trigger modes | Passthrough (value → DMX) and match-only (any message fires effect) |
| Universe count | Single universe, configurable number (default 7) |
| sACN config scope | Global app settings |
| Curve editor | Presets + cubic bezier editor |
| Deck tile feedback | Live value bar showing current DMX output |
| Velocity sensitivity | Scales peak value (velocity/127 × endValue) |

## Architecture

Three trigger sources feed into a central DmxEngine in the Electron main process:

- **MIDI → DMX**: The `useOscPlayback` tick (8ms) dispatches DMX triggers alongside OSC sends. For DMX mappings, the tick calls `dmx:trigger-effect` via IPC (single call per tick, batched like OSC). The existing `matchesMapping()` determines whether the output is OSC or DMX based on the mapping's `outputType` field.
- **OSC → DMX**: An `OscDmxBridge` class in the main process subscribes to `OscManager` message events, matches against trigger rules, and calls `DmxEngine` methods directly — no IPC hop.
- **Deck → DMX**: Deck tiles call IPC handlers (`dmx:trigger`, `dmx:set-channel`, `dmx:release-channel`) which go straight to the engine.

### Performance isolation

The MIDI tick (8ms) and DMX send loop (44Hz / ~23ms) run on separate `setInterval` timers. Trigger sources only push to the active effects list — one array push, no I/O, no blocking. All curve interpolation, HTP merging, and sACN UDP sending happens in the DMX loop's own interval.

## Data Model

### DmxEffect

```typescript
interface DmxEffect {
  id: string;
  name: string;
  segments: DmxSegment[];
  loop: boolean;
  velocitySensitive: boolean;
}

interface DmxSegment {
  channels: number[];       // DMX channels 1-512
  startValue: number;       // 0-255
  endValue: number;         // 0-255
  durationMs: number;       // 0 = instant snap
  curve: CurveDefinition;
  holdMs: number;           // dwell at endValue before next segment
}

type CurveDefinition =
  | { type: "snap" }
  | { type: "linear" }
  | { type: "ease-in" }
  | { type: "ease-out" }
  | { type: "ease-in-out" }
  | { type: "sine"; hz: number }
  | { type: "strobe"; hz: number }
  | { type: "bezier"; x1: number; y1: number; x2: number; y2: number };
```

### SacnConfig (global)

```typescript
interface SacnConfig {
  universe: number;            // default 7
  networkInterface?: string;   // optional, for multi-NIC machines
  enabled: boolean;
}
```

### DMX mapping fields (extends existing OscMapping)

```typescript
interface DmxMappingFields {
  outputType: "osc" | "dmx";
  dmxEffectId?: string;
}
```

### OscDmxTrigger (new: OSC → DMX)

```typescript
interface OscDmxTrigger {
  id: string;
  name: string;
  oscAddress: string;
  mode: "match-only" | "passthrough";
  dmxEffectId?: string;          // match-only: effect to trigger
  dmxChannels?: number[];        // passthrough: channels to control
  inputMin?: number;             // incoming value range (default 0)
  inputMax?: number;             // default 1.0 for float
  outputMin?: number;            // DMX range (default 0)
  outputMax?: number;            // default 255
}
```

### Deck tile types (extends existing DeckItem)

New `DeckItem.type` values: `"dmx-trigger"`, `"dmx-fader"`, `"dmx-flash"`.

```typescript
interface DmxTriggerConfig {
  dmxEffectId: string;
}

interface DmxFaderConfig {
  channel: number;              // DMX channel 1-512
  min: number;                  // default 0
  max: number;                  // default 255
}

interface DmxFlashConfig {
  channels: number[];           // channels to flash
  value: number;                // default 255
}
```

## DmxEngine

Class in `electron/dmx-engine.ts`. Manages:

- **buffer**: `Uint8Array(512)` — current DMX output state
- **activeEffects**: `RunningEffect[]` — effects with start timestamp and segment cursor
- **directValues**: `Map<number, number>` — from deck faders/flash tiles
- **sacnSender**: sACN sender from the `sacn` npm package

### Public API

| Method | Called by | Cost |
|--------|-----------|------|
| `triggerEffect(id, velocityScale?)` | MIDI tick, OSC bridge, deck trigger tile | Array push |
| `stopEffect(id)` | Deck tile, OSC bridge | Array filter |
| `setChannel(ch, value)` | Deck fader, OSC passthrough | Map set |
| `releaseChannel(ch)` | Deck flash release | Map delete |
| `setConfig(config)` | Settings UI | Restart sender |
| `getBuffer()` | UI readback for value bars | Return reference |

### 44Hz send loop

1. For each active effect: compute current segment, interpolate value using curve, advance segment cursor if duration elapsed
2. Remove completed non-looping effects
3. HTP merge: for each channel, take `max(all effect values, direct value)`
4. Compare buffer to previous frame — only send sACN packet if changed (dirty flag)

### Curve interpolation

Presets map to functions:

| Curve | Implementation |
|-------|---------------|
| snap | `t >= 1 ? endValue : startValue` |
| linear | `startValue + (endValue - startValue) * t` |
| ease-in | quadratic: `t * t` |
| ease-out | quadratic: `1 - (1-t)² ` |
| ease-in-out | `t < 0.5 ? 2t² : 1 - (-2t+2)²/2` |
| sine | `startValue + (endValue - startValue) * (sin(2π × hz × elapsed/1000) + 1) / 2` |
| strobe | `elapsed % (1000/hz) < (500/hz) ? endValue : startValue` |
| bezier | standard cubic bezier with Newton-Raphson solver for t→x mapping |

## OscDmxBridge

Class in `electron/osc-dmx-bridge.ts`. Subscribes to `OscManager.on('message')`:

1. For each incoming message, check address against trigger list
2. **match-only**: call `dmxEngine.triggerEffect(trigger.dmxEffectId)`
3. **passthrough**: extract first numeric arg, remap from input range to output range, call `dmxEngine.setChannel(ch, value)` for each target channel

Runs entirely in the main process — no IPC between OSC receive and DMX trigger.

## Curve Editor UI

Integrated into the existing mapping editor popup. When output type is set to "DMX":

### Preset mode
- 8-preset grid with tiny SVG curve thumbnails: snap, linear, ease-in, ease-out, ease-in-out, sine, strobe, custom
- Click preset → auto-fills start/end value, duration, curve type
- Fields below: start value, end value, duration (ms), hold (ms)

### Custom bezier mode
- Small canvas (~200×160px) with draggable control points
- Shows bezier parameters as `bezier(x1, y1, x2, y2)`
- Reset button returns to default curve

### Segment strip
- Horizontal strip below the curve editor showing all segments as colored blocks
- Each block shows: name, value range, duration, curve type
- Click a segment to edit it
- `+` button to add new segments
- Combined preview line at the bottom showing the full effect curve
- Play button to preview the effect animation

## Deck Tiles

Three new tile types in the deck grid, using amber/gold color family to distinguish from blue OSC tiles:

### DMX Trigger tile
- Tap to fire an effect
- Shows effect name, target channels, mini curve preview SVG
- Active state: glowing bottom bar
- Config panel: select effect from dropdown

### DMX Fader tile
- Vertical slider controlling a single DMX channel (0-255)
- Amber fill showing current level, value label at bottom
- Same drag interaction as existing OSC slider
- Uses `setChannel()` — participates in HTP merge

### DMX Flash tile
- 255 while pressed, 0 on release
- Red color family (distinct from amber)
- Pressed state: bright fill with glow
- Uses `setChannel()` on press, `releaseChannel()` on release

## IPC Handlers

New handlers in `electron/ipc-handlers.ts`:

```
dmx:get-config        → SacnConfig
dmx:set-config        → void
dmx:get-effects       → DmxEffect[]
dmx:save-effect       → DmxEffect
dmx:delete-effect     → void
dmx:trigger-effect    → void
dmx:stop-effect       → void
dmx:set-channel       → void
dmx:release-channel   → void
dmx:get-buffer        → number[]
dmx:get-triggers      → OscDmxTrigger[]
dmx:save-trigger      → OscDmxTrigger
dmx:delete-trigger    → void
```

## Storage

`DmxStore` class in `electron/dmx-store.ts`, persists to app data directory:

- `dmx-config.json` — SacnConfig
- `dmx-effects.json` — DmxEffect[]
- `dmx-triggers.json` — OscDmxTrigger[]

## File Structure

### New files

```
electron/
  dmx-engine.ts              # Core engine: buffer, effects, 44Hz loop, sACN send
  dmx-store.ts               # Persists effects, triggers, sACN config
  osc-dmx-bridge.ts          # Listens to OscManager, matches triggers, calls engine

src/lib/
  dmx-types.ts               # DmxEffect, DmxSegment, CurveDefinition, OscDmxTrigger, SacnConfig

src/components/dmx/
  curve-editor.tsx            # Preset grid + bezier canvas
  segment-strip.tsx           # Multi-segment timeline editor
  dmx-settings.tsx            # sACN config (universe, interface)
  osc-trigger-panel.tsx       # OSC→DMX trigger list editor
  dmx-fader-tile.tsx          # Deck fader tile
  dmx-trigger-tile.tsx        # Deck trigger tile
  dmx-flash-tile.tsx          # Deck flash tile

src/hooks/
  use-dmx.ts                 # IPC hooks for DMX engine control + state readback
```

### Modified files

```
electron/ipc-handlers.ts                        # Add dmx:* IPC handlers
electron/main.ts                                # Instantiate DmxEngine, DmxStore, OscDmxBridge
src/lib/types.ts                                # Add DeckItem types, DmxMappingFields
src/components/deck-item.tsx                     # Render new DMX tile types
src/components/deck-config-panel.tsx             # Config panels for DMX tiles
src/components/deck-toolbar.tsx                  # Add DMX tile placement options
src/components/timeline/osc-mapping-editor.tsx   # Add DMX output type toggle + effect selector
src/hooks/use-osc-playback.ts                   # Add DMX dispatch alongside OSC dispatch
src/app/deck/page.tsx                           # Wire up DMX tile interactions
```

## Dependencies

- **`sacn`** — sACN/E1.31 sender. ~3.5k weekly downloads, last published 2024, typed, handles E1.31 multicast. Only viable Node.js option for sACN.

## Out of scope

- Multiple universes (data model is universe-aware for future expansion)
- Full DMX channel mixer UI (lighting console view)
- DMX input/receive
- Art-Net protocol support
- Full keyframe envelope editor (bezier covers the gap)
