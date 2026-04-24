# Timeline Trigger Discovery — Design Spec

**Date:** 2026-04-17
**Feature:** Post-session analysis helpers for identifying good MIDI triggers on the Timeline

---

## Overview

Add a **Trigger Analyzer** to the Timeline tab. When a take is loaded (from file or stopped recording), the renderer analyzes every lane and produces:

- **Rhythm score** (tempo-agnostic): how periodic the lane's onsets are.
- **Dynamic score**: how much the lane's values vary.
- **Melody score** (notes lanes only): whether the lane behaves like a melodic line vs drums/chords.
- **Redundancy pairs**: lanes that fire at the same times with the same shape.

Results are surfaced in two places:

1. **Inline lane badges** — each lane label gets auto-computed badges plus any user-created badges.
2. **Triggers sidebar** — a collapsible right-hand panel ranking lanes by score and listing redundant pairs.

Users can tag lanes with **free-text badges** (label + color) that persist inside the `.oscrec` file.

Playback, recording, save/load, and audio sync are unchanged. This feature is additive.

---

## Primary use case

Post-session: the user loads a saved take, wants to identify which MIDI triggers (notes, pads, CCs) are worth wiring into their visuals tool via OSC. Rhythm scoring surfaces on-beat hits; redundancy flags duplicate controllers; melody scoring surfaces lead lines; user badges let them shortlist candidates as they scan.

Live recording is not a target — analysis only runs once a take has ended (or loaded).

---

## Architecture

```
Loaded Recording
    │
    ▼
┌───────────────────────────────────────┐
│  useTriggerAnalysis (renderer)        │
│  • Memoized on (recording.id,         │
│    bufferVersion)                     │
│  • Runs analysis in requestIdleCallback│
│  • Returns { analyses, pairs, ready } │
└────────┬──────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────┐
│  trigger-analysis.ts (pure)           │
│  • Per-lane scores (rhythm/dynamic/   │
│    melody)                            │
│  • Pairwise redundancy correlation    │
└────────┬──────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────┐
│  Timeline UI                          │
│  • Lane badges (inline)               │
│  • Triggers sidebar (right panel)     │
│  • Badge editor modal                 │
└───────────────────────────────────────┘

User-created badges persist in Recording.badges
↳ read on load, saved with .oscrec, marks take unsaved on change.
```

Everything stays in the renderer. No main-process changes beyond relaxing `validateRecording` to accept the optional `badges` field.

---

## Data model additions

In `src/lib/types.ts`:

```typescript
/** A user-applied tag on a single lane within a recording. */
export interface LaneBadge {
  id: string;        // uuid
  laneKey: string;   // matches laneKeyString output
  label: string;     // free text, ≤24 chars (clamped on save)
  color?: string;    // optional CSS color; deterministic hash fallback
}

/** Computed analysis output for one lane. */
export interface LaneAnalysis {
  laneKey: string;
  eventCount: number;
  eventsPerSec: number;
  rhythmScore: number;        // 0..1
  dynamicScore: number;       // 0..1
  valueRange: [number, number] | null;
  ioiHistogram: number[];     // 20 log-spaced buckets
  isDead: boolean;

  // notes-lane only (undefined elsewhere)
  melodyScore?: number;       // 0..1
  pitchRange?: [number, number];
  pitchContour?: number[];    // 32-bucket mean-pitch-per-chunk
}

/** A pair of lanes flagged as redundant. */
export interface RedundancyPair {
  laneKeyA: string;
  laneKeyB: string;
  similarity: number;         // 0..1
  kind: "onset" | "value";
}
```

`Recording` gains one optional field (no version bump required):

```typescript
export interface Recording {
  // ...existing...
  badges?: LaneBadge[];
}
```

Old `.oscrec` files without `badges` load fine; loader defaults to `[]`.

---

## Analysis pipeline (`src/lib/trigger-analysis.ts`)

Pure module, no React, no DOM. One entry point:

```typescript
export function analyzeRecording(rec: Recording, laneMap: LaneMap, noteSpans: NoteSpan[]): {
  analyses: LaneAnalysis[];
  pairs: RedundancyPair[];
};
```

### Per-lane scoring

For each lane in `laneMap`:

- **Events per second** = `eventCount / (durationMs / 1000)`.
- **isDead** = `eventCount < 3 || eventsPerSec < 0.05`.
- **Onsets**: notes lane uses note-on times from `noteSpans`; other lanes use all event `tRel` values.
- **Inter-onset intervals (IOIs)** = `[t1-t0, t2-t1, …]`.
- **Rhythm score**: 20-bucket log-spaced histogram of IOIs (span ~20ms to 10s). Score = `1 - shannonEntropy(histogram) / log2(20)`, clamped to `[0,1]`. Lanes with <4 onsets score 0.
- **Dynamic score**: `stdDev(values) / 0.25`, clamped to 1. Values = `eventValue(e)` (already in [0,1] for CC/AT/notes-velocity; pitch returns [-1,1] so remap to [0,1] first). Notes lanes use the velocity of each note-on. 0.25 divisor treats a std-dev of 0.25 as "fully dynamic"; empirically this makes a wiggling fader score near 1 and a stuck fader score near 0.
- **Value range**: raw min/max observed, for display in the sidebar.

### Notes-lane extras

Computed from `noteSpans` for the specific device:

- **Monophony ratio**: build a sorted event list of `(time, +1)` per note-on and `(time, -1)` per note-off. Sweep through, tracking `activeCount`. Let `activeSpan = lastNoteOffTime - firstNoteOnTime`. `monophonyRatio = timeWithActiveCount≤1 / activeSpan`. A polyphonic drum loop (frequent overlaps) scores low; a single-voice tune scores near 1. If `activeSpan === 0` or no notes, score is 0.
- **Pitch variability**: `stdDev(pitchesFromNoteOns) / 12`, clamped to 1.
- **Melody score** = `monophonyRatio × min(1, pitchVariability)`. A held drone → ~0. A chord stack → ~0. A single-voice tune → ~1.
- **Pitch range** = min/max pitch across `noteSpans`.
- **Pitch contour**: 32 time buckets across the take. For each bucket, mean pitch of active notes (linear-interp from last known if the bucket is silent).

### Redundancy detection

- Short recordings (`durationMs < 1000`): skip entirely.
- Build a shared 50ms-resolution time grid (length = `ceil(durationMs / 50)`).
- For each lane, compute a **binary onset vector** (1 if any event falls in that bin, 0 otherwise).
- For each pair of lanes within the same kind (notes↔notes, CC↔CC, pitch↔pitch, AT↔AT, program↔program), compute Pearson correlation on the onset vectors.
- Additionally for value-bearing kinds (CC/pitch/AT), build a **value vector** (last known value per bin, forward-filled) and also Pearson-correlate those.
- Keep whichever correlation is higher per pair. Report pairs with `r ≥ 0.8`, capped at 20, sorted descending.
- Complexity: O(L² × bins) where L = active lanes, bins = durationMs/50. Typical: 60 lanes × 72k bins ≈ 260M ops, ~1–2s on a modern laptop.

### Runtime

- `useTriggerAnalysis` runs in `requestIdleCallback(analyze, { timeout: 3000 })`.
- Chunked: the pairwise redundancy loop yields every 50ms via `await new Promise(r => setTimeout(r, 0))` between outer-loop iterations.
- Memoization key: `${recording.id}|${bufferVersion}`.
- Returns `{ analyses: null, pairs: null, ready: false }` until done, then full result.

---

## UI components

### Directory layout

```
src/lib/trigger-analysis.ts                   (new, pure)
src/hooks/use-trigger-analysis.ts             (new)
src/components/timeline/
  lane-badges.tsx                             (new)
  triggers-sidebar.tsx                        (new)
  badge-editor-modal.tsx                      (new)
  pitch-sparkline.tsx                         (new)
  [existing lanes/canvas/toolbar/section]     (modified)
```

### Lane badges

New component `LaneBadges` accepts `analysis?: LaneAnalysis`, `userBadges?: LaneBadge[]`, callbacks `onBadgeAdd / Edit / Delete`. Renders a compact row in the lane's left-gutter label area, below the existing label/sublabel:

- `●` gray dot if `isDead`.
- `♻ 0.87` (accent pill) if `rhythmScore ≥ 0.5`.
- `〜 wide` (green pill) if `dynamicScore ≥ 0.5`.
- `🎵 0.81` (pink pill) if `melodyScore ≥ 0.5`.
- User badges render in their chosen color (or hash-fallback).
- Trailing `+` icon opens the badge-editor modal.

User badge clicks open an inline popover: edit label, pick color (6 swatches), delete.

Badges are interactive inside the gutter; they don't trigger the lane-resize handle or event-hover tooltips (stopPropagation on pointer events).

### Pitch sparkline (notes lanes only)

80px × 16px SVG, drawn under the lane label when `pitchContour` exists. Polyline with each of the 32 points mapped to `(i × width/31, (1 - (p - pitchMin) / (pitchMax - pitchMin)) × height)`. Stroke in accent-dim.

### Triggers sidebar

Collapsible right-hand panel, 280px wide, toggled by a "📊 Triggers" button in `TimelineToolbar`. Default collapsed.

Panel sections (each collapsible):

1. **Most rhythmic** — top 10 lanes by `rhythmScore`, shown as `♻ 0.87  Push 2 · CC 7`.
2. **Most melodic** — top 5 notes lanes by `melodyScore`.
3. **Most dynamic** — top 10 value-bearing lanes by `dynamicScore`.
4. **Redundant pairs** — up to 20 pairs sorted by similarity (matches the analyzer cap); e.g. `92% · CC 7 ↔ CC 11`.
5. **Your tagged** — grouped by badge label (`⭐ kick (2)`, expandable to the actual lanes).

Behaviors:
- Hover a row → corresponding lane gets a 1px accent outline in the timeline.
- Click a row → timeline scrolls the lane into view, flashes the lane briefly (200ms accent outline).
- Click a redundant pair → both lanes flash simultaneously.
- Bottom of panel: `+ Tag current lane` button — opens the badge editor for the last-hovered lane.

### Badge editor modal

Small centered modal:
- Text input for label (maxlength 24).
- Color picker: 6 preset swatches (blue / green / pink / orange / purple / gray) plus "auto" (hash-based).
- Autocomplete list below input, showing previously-used labels in the take.
- Save / Cancel / Delete (only when editing).

On Save: `patchRecording({ badges: [...existing, newBadge] })`. On Delete: remove by id. On Edit: replace by id.

### Modified components

- **NotesLane / ContinuousLane / ProgramLane**: accept `analysis`, `userBadges`, badge callbacks. Render `LaneBadges` and (notes only) `PitchSparkline` in the gutter. Their height may grow if badges wrap — the `ResizeHandle` still works.
- **DeviceSection**: threads analysis + badges to each lane via `getAnalysisFor(key)` and `getBadgesFor(key)` helpers from its props.
- **TimelineCanvas**: owns sidebar open/closed state and lane-highlight state (a `string | null` "flashed lane key"). Adjusts its own flex layout to leave room for the sidebar when open. Routes hover/click actions from sidebar rows back to the existing scroll-to-lane mechanism.
- **TimelineToolbar**: adds a "📊 Triggers" toggle button (like the existing audio offset button).
- **/timeline/page.tsx**: wires `useTriggerAnalysis(recording, bufferVersion, laneMap, noteSpans)`. Threads `analyses`, `pairs`, `recording.badges` into `TimelineCanvas`. Provides badge CRUD callbacks that call `recorder.patchRecording({ badges: ... })`.

---

## Save / load integration

- `RecordingStore.validateRecording` adds: if `badges` present, it must be an array of objects with `id: string`, `laneKey: string`, `label: string`. `color` is optional string. Malformed → reject with `Recording.badges[i] is malformed`.
- Writing: `badges` serializes naturally alongside other fields. The streaming serializer (`writeStreamed`) already uses `{...rec, events: [...]}` so `badges` travels with `rest` — no change needed.
- Patch recording in the renderer marks `hasUnsaved = true`.

---

## Error handling

| Condition | Behavior |
|-----------|----------|
| Analysis throws | Caught in `useTriggerAnalysis`; sidebar shows "Analysis failed — try reloading the take". Console logs the error. Timeline stays functional. |
| 0 events in take | Skip analysis. Sidebar shows "No events to analyze." |
| durationMs < 1000 | Skip redundancy; rhythm/dynamic/melody still run. |
| Long recording (>30min) | Analysis runs in chunks yielding every 50ms; sidebar shows "Analyzing…" placeholder. Badge edits queue and apply on completion. |
| Old `.oscrec` without `badges` | Loader defaults to `[]`. |
| Label over 24 chars | Trimmed on save with toast "Trimmed to 24 chars". |
| Duplicate label on same lane | Silently deduped by `(laneKey, label)`. |
| Invalid color | Hash-based fallback at render time. |
| Corrupt `badges` field | `validateRecording` rejects file with clear message. |

No silent fallbacks that hide the failure from the user.

---

## Testing

Manual per PR (project convention). Must pass before merge:

1. Load a take with ≥4 devices and ~20 active lanes. Open the Triggers sidebar. All 5 sections populate within ~2s. Values look plausible (steady kick > random hits).
2. Hover a row in each list — corresponding lane shows an outline in the timeline.
3. Click a row in "Most rhythmic" — timeline scrolls, lane flashes.
4. Click a redundant pair — both lanes flash simultaneously.
5. Right-click a CC lane → "Tag this lane" → add "main fader" in blue. Badge appears on the lane and in "Your tagged".
6. Edit the badge (new color, new label). Confirm live update.
7. Delete the badge. Confirm it disappears from both surfaces.
8. Save. Reopen. Badges persist. Autocomplete suggests the prior label when typing.
9. Load a pre-feature `.oscrec` (no `badges`). No error; sidebar works; badges empty.
10. Record a new take, stop, open sidebar. Analysis runs on the fresh take; scores are correct.
11. Load a 30-minute recording. "Analyzing…" appears briefly; UI does not jank.
12. Corrupt a `.oscrec` (break the `badges` array). Load — expect a clear validator error.

---

## Out of scope (v1)

- Analysis auto-update while recording — post-stop/load only.
- BPM-anchored rhythm scoring and beat-grid overlay — tempo-agnostic only.
- Cross-recording badges (persist tags across files) — single-take scope.
- Cross-kind redundancy (note-vs-CC) — like-kind only.
- Exporting triggers (e.g. "send OSC addresses to my visuals tool") — user reads the label and copies manually.
- Motif / sequence detection — pitch contour sparkline is the only melodic visualization.
- Sharing/collaborating on badges — single-user tool.
- Velocity-histogram mini-chart per lane — covered implicitly by dynamic score.
