# OSC Effects System

Curve/loop-based OSC message generation, mirroring the existing DMX effects architecture. Enables animated OSC output (fades, pulses, multi-step sequences) triggered by MIDI mappings, targeting Resolume and other OSC receivers.

## Data Model

```typescript
// src/lib/osc-effect-types.ts

// Reuses CurveDefinition from dmx-types.ts (snap, linear, ease-in/out, sine, strobe, bezier)

interface OscEffectSegment {
  startValue: number;      // float, typically 0.0–1.0
  endValue: number;        // float
  durationMs: number;
  curve: CurveDefinition;
  holdMs: number;
}

interface OscEffect {
  id: string;
  name: string;
  segments: OscEffectSegment[];
  loop: boolean;
  velocitySensitive: boolean;
  mode: "one-shot" | "sustained";
  releaseSegment?: OscEffectSegment;  // sustained mode only — plays on note-off
  tickRateHz: number;                 // default 40, configurable per-effect
}
```

Differences from `DmxEffect`:
- No `channels` per segment — the OSC target (endpoint + address) comes from the mapping that triggers it
- Float values instead of 0–255 integers; segment start/end can be any float (e.g., 0.3→0.8)
- `mode` field: "one-shot" runs and finishes, "sustained" loops while note held then plays release
- `releaseSegment`: optional single segment that plays on note-off (sustained mode only)
- `tickRateHz`: controls interpolation rate (default 40Hz, raise for smooth fades, lower to reduce traffic)

## Engine

```typescript
// electron/osc-effect-engine.ts

class OscEffectEngine {
  private effects: Map<string, OscEffect>;
  private activeEffects: RunningOscEffect[];
  private intervalId: NodeJS.Timeout | null;
  private oscManager: OscManager;

  triggerEffect(effectId: string, target: {
    host: string;
    port: number;
    address: string;
    argType: "f" | "i";
  }, velocityScale?: number): string;  // returns instance ID

  releaseEffect(instanceId: string): void;
  stopEffect(instanceId: string): void;
  private tick(): void;
}
```

Runs in the electron main process alongside `DmxEngine`. Uses the existing `OscManager` to send messages.

### Tick loop behavior

- Runs at the fastest `tickRateHz` among active effects; stops when no effects are active
- Each tick: interpolate current segment value via `interpolateCurve()`, send to the instance's target
- Reuses `CurveDefinition` and `interpolateCurve` from `src/lib/dmx-curves.ts`

### Effect modes

**One-shot**: Runs all segments in sequence. Removes itself when the last segment completes. If `loop: true`, wraps back to segment 0.

**Sustained**: Runs segments in sequence. When the last segment completes, holds its end value (or loops if `loop: true`). On `releaseEffect()`, transitions to the release segment. If the release segment is not defined, stops immediately.

### Concurrency

Multiple instances of the same effect can run simultaneously on different targets (e.g., two MIDI notes triggering the same fade effect on different Resolume layers). Each instance is independently tracked by a unique instance ID.

## Storage

`electron/osc-effect-store.ts` — mirrors `dmx-store.ts`:
- Persists to `userData/osc-effects.json`
- CRUD operations: getAll, save (upsert), delete

## IPC

New IPC channels:

| Channel | Args | Returns |
|---|---|---|
| `osc-effect:get-all` | — | `OscEffect[]` |
| `osc-effect:save` | `OscEffect` | `OscEffect` |
| `osc-effect:delete` | `id: string` | `void` |
| `osc-effect:trigger` | `effectId, target, velocityScale?` | `instanceId: string` |
| `osc-effect:release` | `instanceId: string` | `void` |
| `osc-effect:stop` | `instanceId: string` | `void` |

## Frontend Hook

`src/hooks/use-osc-effects.ts` — same pattern as `useDmx()`:
- Fetches effects on mount via `osc-effect:get-all`
- Exposes: `effects`, `saveEffect`, `deleteEffect`, `triggerEffect`, `releaseEffect`, `stopEffect`

## Integration with Mappings

### OscMapping change

Add optional field to `OscMapping` in `src/lib/types.ts`:

```typescript
oscEffectId?: string;  // if set, triggers an effect instead of sending a single value
```

### Live monitor integration

In `useLiveMonitor` (`src/hooks/use-live-monitor.ts`), when a matched mapping has `oscEffectId`:

1. Instead of `osc:send`, call `osc-effect:trigger` with:
   - The effect ID
   - The target (endpoint host/port + resolved OSC address)
   - Velocity scale (if the effect is velocity-sensitive)
2. Track the returned instance ID keyed by MIDI note
3. On note-off for a sustained effect, call `osc-effect:release` with the instance ID

Mappings without `oscEffectId` continue to work as they do now (single fire-and-forget messages).

## UI

### Output tab — OSC Effects section

New section in `DmxPanel` (or a parallel `OscEffectsPanel`) on the Output page:

- **Effect list**: name, mode badge (one-shot/sustained), loop/velocity badges, per-segment details (value range, duration, curve type). Test/Edit/Duplicate/Delete buttons.
- **Effect editor**: reuses existing `CurveEditor` and `SegmentStrip` components. Fields: name, mode toggle, loop checkbox, velocity-sensitive checkbox, tick rate slider, segment list with add/remove, release segment editor (visible only in sustained mode).

### Mapping editors

Both `OscMappingEditor` (timeline) and `MappingConfigPanel` (live tab):

- New "Effect" dropdown in the OSC output section, listing available OSC effects
- Optional — when no effect is selected, the mapping sends a single value as before
- When an effect is selected, the endpoint + address fields remain (they define where the effect sends its output)

## File inventory

New files:
- `src/lib/osc-effect-types.ts` — types
- `electron/osc-effect-store.ts` — persistence
- `electron/osc-effect-engine.ts` — tick-based engine
- `src/hooks/use-osc-effects.ts` — frontend hook

Modified files:
- `src/lib/types.ts` — add `oscEffectId` to `OscMapping`
- `electron/ipc-handlers.ts` — register new IPC channels
- `electron/main.ts` — instantiate engine, wire to OscManager
- `src/hooks/use-live-monitor.ts` — effect trigger/release on mapping match
- `src/app/output/page.tsx` — OSC effects UI section
- `src/components/timeline/osc-mapping-editor.tsx` — effect dropdown
- `src/components/live/mapping-config-panel.tsx` — effect dropdown
