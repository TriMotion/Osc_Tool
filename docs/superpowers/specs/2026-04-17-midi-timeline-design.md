# MIDI Timeline — Design Spec

**Date:** 2026-04-17
**Feature:** MIDI recording, visualization, and audio-synced playback

---

## Overview

Add a **Timeline** feature on top of the existing MIDI bridge. Users can:

- Explicitly arm and capture MIDI-in + OSC-out pairs while the bridge is running.
- Visualize captured events as a per-device accordion timeline, with lanes for notes (piano-roll mini), CCs, pitch, aftertouch, and program changes.
- Hover any event to see timestamp, device, MIDI message, and resulting OSC address/args.
- Save takes as portable `.oscrec` JSON files and reload them later.
- Load an audio file (WAV/MP3/OGG/FLAC/M4A), align it with a draggable offset, and play it back with a synced visual playhead.

Playback is **visual-only** in v1 — no MIDI/OSC is re-emitted during playback. The feature is an inspector and analyst's tool, not a show-playback tool.

The feature lives under a new `/timeline` route. The existing `/midi` bridge page is untouched.

---

## Architecture

```
MIDI Devices (hardware)
    │
    ▼
┌───────────────────────────────────────┐
│ MidiManager (main process, existing)  │
│ Emits MidiEvent batches every 50ms    │
└──────────┬────────────────────────────┘
           │ IPC "midi:events"
           ▼
┌───────────────────────────────────────┐
│ /timeline  (renderer)                 │
│                                       │
│  useRecorder()                        │
│   • state: idle | recording | stopped │
│   • buffer: RecordedEvent[] (sorted)  │
│   • startedAt: epoch ms               │
│                                       │
│  useAudioSync()                       │
│   • HTMLAudioElement (playback)       │
│   • decoded PCM peaks (waveform)      │
│   • offsetMs (audio↔MIDI alignment)   │
│                                       │
│  useRecordingIO()                     │
│   • save / save-as / load / recent    │
│                                       │
│  TimelineCanvas                       │
│   • accordion device sections         │
│   • viewport-culled lane rendering    │
│   • playhead + hover card             │
│                                       │
└────────┬──────────────────────────────┘
         │ IPC "recording:save" / "recording:load"
         ▼
┌───────────────────────────────────────┐
│ recording-store (main, new)           │
│  • fs.writeFile / readFile            │
│  • dialog.showSaveDialog / Open       │
│  • userData/recordings/  default dir  │
│  • userData/recent-recordings.json    │
└───────────────────────────────────────┘
```

The recording buffer lives only in the renderer. Main's responsibilities stay narrow: forward MIDI events (already does) and do file I/O for `.oscrec` files and the recent-list. Audio decoding happens entirely in the renderer via Web Audio.

---

## Data Model

New types in `src/lib/types.ts`:

```typescript
type RecorderState = "idle" | "recording" | "stopped";

interface Recording {
  version: 1;
  id: string;                           // uuid
  name: string;                         // user-editable, default "Untitled"
  startedAt: number;                    // epoch ms at take start
  durationMs: number;                   // Date.now() at stop - startedAt
  events: RecordedEvent[];              // sorted by tRel ascending
  devices: string[];                    // distinct device names seen
  mappingRulesSnapshot: MidiMappingRule[]; // rules active at stop time
  audio?: AudioRef;
}

interface RecordedEvent {
  tRel: number;                         // ms since startedAt (not wall-clock)
  midi: MidiEvent["midi"];              // reuses existing shape
  osc: OscMessage;                      // reuses existing shape
}

interface AudioRef {
  filePath: string;                     // absolute path, resolved on load
  offsetMs: number;                     // audio.t = recording.t + offsetMs
                                        // positive = audio starts AFTER MIDI t=0
}
```

**Key decisions:**

- **`tRel` (not wall-clock) per event.** Keeps recordings portable; viewport math is always "ms since take start". Wall-clock is only retained on `Recording.startedAt` for display.
- **`mappingRulesSnapshot` embedded.** Snapshotted at stop time so users can see the ruleset that produced the late-recording events even if they've changed rules since. Informational only — not replayed. (If the user changes rules mid-recording, the OSC shown in each event is what actually went out at emit time, because OSC is captured alongside MIDI; the snapshot is a single end-of-take reference.)
- **Audio stored as path reference, not embedded bytes.** Keeps `.oscrec` small and keeps the user in control of their media files. On load, if the path is missing, we show "Audio file not found" and let the user re-pick.
- **File format:** pretty-printed JSON, `.oscrec` extension, UTF-8. No binary blobs.

---

## UI Components

New directory `src/app/timeline/` and `src/components/timeline/`:

```
/timeline/page.tsx                     — orchestrator
  <TimelineToolbar/>                   — record/stop, save/load, audio load, play/pause,
                                         zoom, offset numeric input
  <TimelineCanvas/>                    — the accordion timeline
    <TimeRuler/>                       — seconds markers, clickable to seek
    <AudioLane/>                       — waveform, drag-to-offset
    <DeviceSection/>  (× N devices)    — collapsible per device
      <NotesLane/>                     — piano-roll mini (notes stacked by pitch)
      <CCLane/>         (× N active)   — one per (channel, cc#)
      <PitchLane/>      (× N channels)
      <AftertouchLane/> (× N channels)
      <ProgramLane/>    (× N channels) — discrete markers
    <Playhead/>                        — absolute-positioned vertical line
    <HoverCard/>                       — floating tooltip showing MIDI + OSC
  <RecordingInfoPanel/>                — name, duration, event count, save indicator
```

Hooks in `src/hooks/`:

- **`use-recorder.ts`** — owns `RecorderState`, the buffer, and `start / stop / clear`. Subscribes via `useMidiEvents()` (existing) and pushes into `buffer` when `state === "recording"`, otherwise ignores.
- **`use-recording-io.ts`** — wraps `recording:save`, `recording:save-as`, `recording:load`, `recording:list-recent` IPC calls and exposes unsaved-take tracking.
- **`use-audio-sync.ts`** — owns `HTMLAudioElement`, decoded peak array for the waveform, `offsetMs`, and transport (`play / pause / seek / playheadMs`). Works with or without an audio file loaded — it's really the transport hook.

Sidebar gets a new "Timeline" nav entry below "MIDI" (edit `src/components/sidebar.tsx`).

---

## Recording Flow

1. User navigates to `/timeline`. Bridge status (from `useMidiControl`) is shown but not controlled here — if the bridge is off, a hint says "Start the bridge first" with a link back to `/midi`.
2. User clicks **Record**.
   - If a previous unsaved take exists in memory, show a confirm dialog: *"Discard current take?"*. On confirm, `clear()` buffer.
   - `startedAt = Date.now()` is captured.
   - State flips to `recording`.
3. `useMidiEvents` callback receives batches. For each event, compute `tRel = midi.timestamp - startedAt` and append to the buffer. Because MIDI batches come in sorted by timestamp and recording starts monotonically, the buffer remains sorted by `tRel` without an explicit sort step.
4. During recording, `TimelineCanvas` auto-scrolls so the newest event stays near the right edge ("tail-follow" mode). If the user manually scrolls left, tail-follow disengages until they click "Jump to live".
5. User clicks **Stop**.
   - `durationMs = Date.now() - startedAt`.
   - `devices` computed once from unique `midi.deviceName`.
   - `mappingRulesSnapshot` captured from current mapping rules at stop time.
   - State becomes `stopped`. Unsaved-take indicator lights up in the info panel.
6. User can **Save** / **Save As** via the toolbar. No auto-save in v1.

**One take at a time.** Starting a new recording discards the current unsaved take after confirmation. No multi-take library in memory. If the app window closes with an unsaved take, the take is lost — v1 has no auto-save or crash recovery.

---

## Playback + Audio Sync

### Transport clock

- **No audio loaded:** `playheadMs` is driven by an internal clock — on play, record `playStartT = performance.now()`, `playStartHead = playheadMs`; each frame `playheadMs = playStartHead + (performance.now() - playStartT)`.
- **Audio loaded and playing:** `HTMLAudioElement.currentTime` is the authoritative clock. `playheadMs = audio.currentTime * 1000 - offsetMs`.
- **Seeking from the timeline** sets `audio.currentTime = (newPlayheadMs + offsetMs) / 1000` when audio is loaded; otherwise updates the internal clock state directly.
- **Playhead rendering** at `requestAnimationFrame` rate (~60 Hz). The playhead is a position-absolute `<div>` inside `TimelineCanvas` — no React re-render per frame, direct DOM mutation from the rAF loop.

### Audio loading

1. User clicks **Load Audio** → `dialog.showOpenDialog` (main) returns an absolute path.
2. Main reads the file bytes and returns them to the renderer as an `ArrayBuffer` via IPC (`recording:read-audio-bytes`), avoiding `file://` protocol and Electron `webSecurity` concerns. For playback, main also returns a short-lived `blob:` or `data:` URL the renderer assigns to `<audio>.src` — or, if simpler, registers a custom `media://` protocol handler in `main.ts` that streams file bytes.
3. Renderer calls `AudioContext.decodeAudioData(arrayBuffer)` → produces a `Float32Array` per channel.
4. Downsample to a peaks array: for each pixel column at the current zoom, compute `(min, max)` of samples within that column's time range. Render once to an offscreen canvas, reuse across zoom changes until zoom actually changes (then recompute).
5. The decoded `AudioBuffer` is not retained — just the peaks — to keep memory bounded for long audio files.
6. The `<audio>` element uses the `blob:` URL (or custom protocol URL) from step 2 as its `src` for actual playback. Web Audio is only used to produce the peaks array.

### Offset UX

- **Numeric input** in the toolbar (`+1.240s`), 1ms precision, accepts negative values.
- **Drag on the audio lane** to shift the waveform horizontally. Cursor changes to `ew-resize` on hover. Drag updates `offsetMs` live. Modifier keys for step size: *no modifier* = 1ms, *Shift* = 10ms snap, *Alt* = 100ms snap.
- Offset is saved into `Recording.audio.offsetMs` and persists with the file.

---

## Timeline Rendering Strategy

With a v1 target of ~2M events (≈1h of busy MIDI), we cannot render every lane element as a DOM node per frame. Strategy per lane type:

### Notes lane (piano-roll mini)

- After stop (and incrementally during recording), pair note-on with matching note-off events to produce `NoteSpan { pitch, channel, velocity, tStart, tEnd }`. Unmatched note-ons at stop time get `tEnd = durationMs`.
- On each viewport change, binary-search for spans that intersect `[t0, t1]`. Render each as a positioned `<div>` with `top` mapped from pitch.
- Typical viewport shows 20–200 notes → cheap as DOM.

### CC / pitch / aftertouch lanes (continuous curves)

- One `<canvas>` per lane.
- On viewport or data change, binary-search events in `[t0, t1]`. **Bucket to pixels:** for each pixel column, compute min/max of values falling in that column's time range, draw a vertical line from `(col, min)` to `(col, max)`. Looks like a waveform. Cost is O(pixels), not O(events).
- **During recording**, only the right edge is dirty. Blit the prior canvas leftward by the delta (one pixel per ~frame-worth of ms at current zoom) and redraw only the newly-exposed pixel range on the right. Keeps cost constant as the take grows.

### Program change markers (discrete)

- Binary-search the viewport, render each hit as a positioned `<div>` with a circle marker. Same approach as notes.

### Lane discovery

- After stop (and incrementally during recording), walk the buffer once to produce a `LaneMap` keyed by `(deviceName, laneKind, channel, data1)` → event-index array. Inactive combinations never get a lane.
- Memoized on `Recording.id + recording.events.length` (length bumps each frame during recording). Incremental update during recording: append new events' indices to the appropriate lane array.

### Binary search

- Events are sorted by `tRel` at record time and never re-sorted. `findFirstGTE(tRel)` / `findLastLTE(tRel)` return viewport bounds in O(log n).
- One shared helper in `src/lib/timeline-util.ts`.

---

## File I/O + IPC

New `electron/recording-store.ts`, analogous to `endpoints-store.ts`.

### IPC channels

```
recording:save           (rec: Recording)
  → { path: string } | { cancelled: true }

recording:save-as        (rec: Recording)
  → { path: string } | { cancelled: true }

recording:load           ()
  → { recording: Recording, path: string } | { cancelled: true }

recording:load-path      (path: string)
  → { recording: Recording }

recording:list-recent    ()
  → { entries: Array<{ path: string, name: string, savedAt: number }> }

recording:pick-audio     ()
  → { path: string } | { cancelled: true }

recording:read-audio-bytes  (path: string)
  → { bytes: ArrayBuffer, mimeType: string }
```

### Behavior

- **Save / Save As** uses `dialog.showSaveDialog` with `.oscrec` filter. Default directory: `app.getPath("userData") + "/recordings/"` (created if missing).
- **Load** uses `dialog.showOpenDialog` with `.oscrec` filter.
- **`recording:pick-audio`** uses `dialog.showOpenDialog` with an audio-file filter (WAV/MP3/OGG/FLAC/M4A). Returns the absolute path only; decoding stays in the renderer.
- **Recent list** persisted to `userData/recent-recordings.json`, capped at 10 entries. Each successful save/load prepends or moves-to-top. Missing-file entries are pruned on `list-recent`.
- **Validation on load:** reject with a clear message if `version !== 1`, if `events` is not an array, if any event is missing `tRel` or `midi`, or if JSON parse fails. No silent migrations.
- **Large recording save:** above ~50MB of serialized JSON, stream-serialize on the main side (walk events via `createWriteStream`, no full `JSON.stringify`). Under the cap, plain `JSON.stringify` with 2-space indent. 50MB is a code constant, not user-tunable.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| No MIDI events during recording | Stop produces a valid empty recording. UI shows an empty-state: *"No events captured — was the bridge running?"* |
| Bridge stopped mid-recording | Recording continues; no new events arrive; tail freezes. Stop still produces a valid file. |
| Audio decode fails | Toast the error, leave prior audio state intact. |
| Audio file missing on load | Recording loads with `audio: undefined`, toast *"Audio file not found at `<path>` — load a different file?"* |
| Schema mismatch on load (`version !== 1`) | Reject with *"Unsupported recording version: `<X>` (expected 1)"*. |
| Corrupt JSON on load | Reject with *"Could not parse recording file: `<message>`"*. |
| Save fails (disk full, permissions) | Toast the OS error; take remains in memory, unsaved indicator stays lit. |
| Recording > 50MB serialized | Main-side streaming serializer automatically used; transparent to the renderer. |

No silent fallbacks. Every failure path produces a visible toast or error state.

---

## Testing

The repo has no unit-test harness today. Verification is manual per PR, aligned with project convention.

**Manual test plan (must pass before merge):**

1. Connect a MIDI controller (notes + at least one CC). Start bridge. Record 60s of mixed activity. Verify the timeline shows the expected devices, notes appear in the piano-roll lane, and CC movement renders as continuous curves.
2. Save the take. Reload it from file. Verify event count, device list, durations, and mapping rules snapshot are identical.
3. Load a ≥30-minute recording (synthesize one if needed). Scrub across the whole duration at multiple zoom levels (10s, 60s, 600s visible). Verify rendering stays smooth and hover works throughout.
4. Load audio of each supported format (WAV, MP3, OGG, FLAC, M4A). Waveform renders. Playback works. Playhead stays visually synced with the audio.
5. Drag-align audio offset. Verify playhead tracks correctly after offset change. Use Shift / Alt modifiers, confirm step sizes.
6. Seek from the timeline (click the ruler, drag the playhead) with audio loaded. Verify `audio.currentTime` updates and plays from the new point.
7. Start a new recording while an unsaved take exists. Verify the confirm dialog appears and "Cancel" preserves the take.
8. Corrupt an `.oscrec` file (remove a field, break JSON, change `version` to 2). Load it. Verify each failure produces the correct toast and the renderer state is not mutated.
9. Start recording, stop the bridge, wait 10s, restart the bridge, produce more events, stop recording. Verify the resulting take includes both segments with the 10s gap and loads correctly from disk.

---

## New + Modified Files

**New:**

| File | Purpose |
|------|---------|
| `electron/recording-store.ts` | File I/O for `.oscrec`, recent list, audio picker |
| `src/app/timeline/page.tsx` | Timeline route orchestrator |
| `src/components/timeline/timeline-toolbar.tsx` | Record/stop, save/load, audio load, transport, zoom, offset |
| `src/components/timeline/timeline-canvas.tsx` | Accordion timeline, viewport, playhead, hover |
| `src/components/timeline/time-ruler.tsx` | Seconds ruler + click-to-seek |
| `src/components/timeline/audio-lane.tsx` | Waveform render + drag-to-offset |
| `src/components/timeline/device-section.tsx` | Collapsible device block |
| `src/components/timeline/notes-lane.tsx` | Piano-roll mini |
| `src/components/timeline/cc-lane.tsx` | Canvas-backed continuous curve |
| `src/components/timeline/pitch-lane.tsx` | Same as CC, different color |
| `src/components/timeline/aftertouch-lane.tsx` | Same as CC, poly vs channel variants |
| `src/components/timeline/program-lane.tsx` | Discrete markers |
| `src/components/timeline/hover-card.tsx` | Floating tooltip |
| `src/components/timeline/recording-info.tsx` | Name/duration/event-count/save panel |
| `src/hooks/use-recorder.ts` | Recorder state + buffer |
| `src/hooks/use-recording-io.ts` | Save/load/recent IPC wrapper |
| `src/hooks/use-audio-sync.ts` | Transport + audio element + peaks |
| `src/lib/timeline-util.ts` | Binary search, note-span pairing, peak bucketing |

**Modified:**

| File | Change |
|------|--------|
| `electron/ipc-handlers.ts` | Register `recording:*` handlers |
| `electron/main.ts` | Instantiate recording-store |
| `src/lib/types.ts` | Add `Recording`, `RecordedEvent`, `AudioRef`, `RecorderState`, `LaneMap`, `NoteSpan` |
| `src/components/sidebar.tsx` | Add "Timeline" nav item below "MIDI" |
| `package.json` / `electron:compile` script | Add `electron/recording-store.ts` to the esbuild entry list |

---

## Out of Scope (v1)

- Re-emitting MIDI/OSC during playback (visual-only by decision).
- Editing events in the timeline (cut/paste/quantize/nudge).
- Multiple takes buffered in memory simultaneously.
- Standard MIDI file (`.mid`) import/export.
- Hot-reloading a recording from disk if the file changes externally.
- Hours-long recordings (>1h); not blocked by design, but rendering performance is unverified above the 1h / ~2M-event target.
- Time-signature / tempo / bars-and-beats grid — timeline is seconds-based only.
- Auto-save / crash recovery.
- Deck integration (triggering deck items from timeline events).
- Web server / remote playback.
