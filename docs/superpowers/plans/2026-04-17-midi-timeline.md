# MIDI Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Timeline tab to Oscilot that records paired MIDI-in + OSC-out events into explicitly-armed "takes", visualizes them per-device on a scrollable/zoomable timeline (accordion layout with notes piano-roll + CC/pitch/aftertouch curves + program-change markers), lets users save/load takes as `.oscrec` JSON, and plays takes back synced to a user-loaded audio file.

**Architecture:** The existing `MidiManager` (main) already streams `MidiEvent[]` batches to the renderer every 50ms. A new `useRecorder` hook in the renderer owns an in-memory ring of `RecordedEvent` (sorted by `tRel`) and starts capturing when the user hits Record. Save/load go through a new `recording-store.ts` in main, which also reads audio bytes over IPC (no `file://` fetch). Audio playback uses an `<audio>` element with a blob URL; Web Audio decodes peaks for the waveform. Timeline rendering uses viewport culling (binary search on `tRel`) with lanes drawn as positioned DOM (notes, markers) or canvas (CC/pitch/aftertouch curves bucketed to pixel columns).

**Tech Stack:** Existing — Electron + Next.js (React 19) + Tailwind 4 + Framer Motion. No new runtime dependencies. Project convention is manual verification per PR (no unit-test harness); each task includes a short manual verification step.

---

## File Map

**Create:**
- `src/lib/timeline-util.ts` — pure helpers: binary search on `tRel`, note-span pairing, canvas pixel-bucketing, peak extraction
- `electron/recording-store.ts` — `.oscrec` save/load, recent list, audio file dialog + byte read
- `src/hooks/use-recorder.ts` — recorder state machine, buffer ref, version counter
- `src/hooks/use-recording-io.ts` — IPC wrapper for save/load/list-recent/pick-audio/read-audio-bytes
- `src/hooks/use-audio-sync.ts` — transport clock, `<audio>` element, blob URL, peak array
- `src/components/timeline/time-ruler.tsx` — seconds ruler + click-to-seek
- `src/components/timeline/audio-lane.tsx` — waveform render + drag-to-offset
- `src/components/timeline/notes-lane.tsx` — piano-roll mini using positioned `<div>`s
- `src/components/timeline/continuous-lane.tsx` — canvas-backed curve renderer (used by CC/pitch/aftertouch)
- `src/components/timeline/program-lane.tsx` — discrete markers
- `src/components/timeline/device-section.tsx` — collapsible per-device block; owns its lane list
- `src/components/timeline/hover-card.tsx` — floating tooltip
- `src/components/timeline/timeline-canvas.tsx` — accordion viewport + playhead + hover hit-testing
- `src/components/timeline/timeline-toolbar.tsx` — record/stop, save/load, audio load, transport, zoom, offset
- `src/components/timeline/recording-info.tsx` — name / duration / event count / save indicator
- `src/app/timeline/page.tsx` — orchestrator route

**Modify:**
- `src/lib/types.ts` — add `Recording`, `RecordedEvent`, `AudioRef`, `RecorderState`, `NoteSpan`, `LaneKey`, `LaneMap`
- `electron/ipc-handlers.ts` — instantiate `RecordingStore`, register `recording:*` handlers
- `package.json` — add `electron/recording-store.ts` to the `electron:compile` esbuild entry list
- `src/components/sidebar.tsx` — add "Timeline" nav item

---

## Task 1: Add shared types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Append new types to `src/lib/types.ts`**

Add to the bottom of the file:

```typescript
// --- Recording / Timeline types ---

export type RecorderState = "idle" | "recording" | "stopped";

export interface AudioRef {
  filePath: string;        // absolute path, resolved on load
  offsetMs: number;        // audio.t = recording.t + offsetMs (positive = audio starts AFTER MIDI t=0)
}

export interface RecordedEvent {
  tRel: number;            // ms since Recording.startedAt (not wall-clock)
  midi: MidiEvent["midi"]; // reuses MIDI shape
  osc: OscMessage;         // reuses OSC shape
}

export interface Recording {
  version: 1;
  id: string;
  name: string;
  startedAt: number;       // epoch ms at take start
  durationMs: number;      // Date.now() at stop - startedAt
  events: RecordedEvent[]; // sorted by tRel ascending
  devices: string[];
  mappingRulesSnapshot: MidiMappingRule[]; // rules active at stop time
  audio?: AudioRef;
}

// Pairing of note-on with its matching note-off.
// tEnd === durationMs if the take stopped before note-off arrived.
export interface NoteSpan {
  device: string;
  channel: number;
  pitch: number;           // 0-127
  velocity: number;        // 0-127 (from the note-on)
  tStart: number;
  tEnd: number;
}

// Identifies a single timeline lane within a device section.
export type LaneKey =
  | { kind: "notes"; device: string }
  | { kind: "cc"; device: string; channel: number; cc: number }
  | { kind: "pitch"; device: string; channel: number }
  | { kind: "aftertouch"; device: string; channel: number; note?: number } // note set for poly
  | { kind: "program"; device: string; channel: number };

// For non-notes lanes: indices into Recording.events that belong to this lane,
// sorted by tRel (inherited from Recording.events ordering).
// For notes: indices of note-on events; paired note-offs are computed separately.
export type LaneMap = Map<string, { key: LaneKey; eventIndices: number[] }>;

// Stable string key for LaneMap.
export function laneKeyString(k: LaneKey): string {
  switch (k.kind) {
    case "notes":      return `${k.device}|notes`;
    case "cc":         return `${k.device}|cc|${k.channel}|${k.cc}`;
    case "pitch":      return `${k.device}|pitch|${k.channel}`;
    case "aftertouch": return `${k.device}|at|${k.channel}|${k.note ?? "ch"}`;
    case "program":    return `${k.device}|prog|${k.channel}`;
  }
}

export interface RecentRecordingEntry {
  path: string;
  name: string;
  savedAt: number;
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors. (Pre-existing errors unrelated to the new types are fine.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add Recording, RecordedEvent, LaneMap, and related timeline types"
```

---

## Task 2: Create `src/lib/timeline-util.ts`

**Files:**
- Create: `src/lib/timeline-util.ts`

This file holds the only algorithmic complexity in the feature. Keep it pure (no React, no DOM) so it stays easy to reason about.

- [ ] **Step 1: Write the file**

Create `src/lib/timeline-util.ts`:

```typescript
import type { LaneKey, LaneMap, NoteSpan, RecordedEvent } from "@/lib/types";
import { laneKeyString } from "@/lib/types";

/**
 * Lowest index i such that events[i].tRel >= target.
 * Returns events.length if no such element.
 */
export function findFirstGTE(events: RecordedEvent[], target: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].tRel < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Highest index i such that events[i].tRel <= target.
 * Returns -1 if no such element.
 */
export function findLastLTE(events: RecordedEvent[], target: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].tRel <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Inclusive-exclusive viewport slice: [startIdx, endIdx).
 * Returns the index range of events with tRel in [t0, t1).
 */
export function viewportRange(events: RecordedEvent[], t0: number, t1: number): [number, number] {
  return [findFirstGTE(events, t0), findFirstGTE(events, t1)];
}

/**
 * Pair note-on with matching note-off per (device, channel, pitch).
 * Unmatched note-ons get tEnd = fallbackEndMs.
 *
 * Uses a stack-per-(device,channel,pitch) so repeated note-ons without
 * intervening note-offs still produce distinct spans.
 */
export function pairNoteSpans(events: RecordedEvent[], fallbackEndMs: number): NoteSpan[] {
  const open = new Map<string, Array<{ tStart: number; velocity: number; device: string; channel: number; pitch: number }>>();
  const spans: NoteSpan[] = [];

  const keyFor = (device: string, channel: number, pitch: number) =>
    `${device}|${channel}|${pitch}`;

  for (const e of events) {
    const m = e.midi;
    if (m.type === "noteon") {
      const k = keyFor(m.deviceName, m.channel, m.data1);
      const stack = open.get(k) ?? [];
      stack.push({
        tStart: e.tRel,
        velocity: m.data2,
        device: m.deviceName,
        channel: m.channel,
        pitch: m.data1,
      });
      open.set(k, stack);
    } else if (m.type === "noteoff") {
      const k = keyFor(m.deviceName, m.channel, m.data1);
      const stack = open.get(k);
      if (stack && stack.length > 0) {
        const on = stack.shift()!; // pair oldest open note-on (FIFO)
        spans.push({
          device: on.device,
          channel: on.channel,
          pitch: on.pitch,
          velocity: on.velocity,
          tStart: on.tStart,
          tEnd: e.tRel,
        });
      }
      // Stray note-off (no matching on) is ignored.
    }
  }

  // Flush unmatched note-ons with fallbackEndMs.
  for (const stack of open.values()) {
    for (const on of stack) {
      spans.push({
        device: on.device,
        channel: on.channel,
        pitch: on.pitch,
        velocity: on.velocity,
        tStart: on.tStart,
        tEnd: fallbackEndMs,
      });
    }
  }

  spans.sort((a, b) => a.tStart - b.tStart);
  return spans;
}

/**
 * Walk the buffer and build the LaneMap.
 *
 * @param events full recording buffer (sorted by tRel)
 * @param prior optional prior LaneMap to extend (for incremental updates during recording)
 * @param startIdx index to start scanning from (use priorLength for incremental)
 */
export function buildLaneMap(
  events: RecordedEvent[],
  prior: LaneMap = new Map(),
  startIdx = 0
): LaneMap {
  const map = prior;

  const push = (key: LaneKey, idx: number) => {
    const k = laneKeyString(key);
    let entry = map.get(k);
    if (!entry) {
      entry = { key, eventIndices: [] };
      map.set(k, entry);
    }
    entry.eventIndices.push(idx);
  };

  for (let i = startIdx; i < events.length; i++) {
    const m = events[i].midi;
    const device = m.deviceName;
    switch (m.type) {
      case "noteon":
      case "noteoff":
        push({ kind: "notes", device }, i);
        break;
      case "cc":
        push({ kind: "cc", device, channel: m.channel, cc: m.data1 }, i);
        break;
      case "pitch":
        push({ kind: "pitch", device, channel: m.channel }, i);
        break;
      case "aftertouch":
        // data2 === 0 with statusType 0xA0 happens when data1 is the note (poly).
        // We can't fully recover statusType here, so rely on data2 !== 0 as heuristic
        // for channel aftertouch (data2 not meaningful for channel AT since only data1 carries pressure).
        // Pragmatic rule: if this is the second byte with data2 present, treat as poly.
        // Because MidiManager already distinguishes via autoMap, we encode the kind by inspecting data2.
        // In practice: AftertouchLane checks `m.data2 === 0` below.
        // For lane grouping we use data1 as note only when data2 is the pressure (poly aftertouch).
        // Treat all aftertouch on a given channel as one channel-AT lane when data2 === 0,
        // else a poly-AT lane keyed by note (data1).
        if (m.data2 === 0) {
          push({ kind: "aftertouch", device, channel: m.channel }, i);
        } else {
          push({ kind: "aftertouch", device, channel: m.channel, note: m.data1 }, i);
        }
        break;
      case "program":
        push({ kind: "program", device, channel: m.channel }, i);
        break;
    }
  }

  return map;
}

/**
 * Normalize MIDI data2 (0-127) to 0.0-1.0. For pitch, data1+data2 form 14 bits → -1.0..1.0.
 * For channel aftertouch (data2 === 0), data1 is the pressure.
 */
export function eventValue(e: RecordedEvent): number {
  const m = e.midi;
  if (m.type === "pitch") {
    return (((m.data2 << 7) | m.data1) - 8192) / 8192; // -1..+1
  }
  if (m.type === "aftertouch" && m.data2 === 0) {
    return m.data1 / 127;
  }
  return m.data2 / 127;
}

/**
 * For continuous lanes: bucket events in [t0, t1) to `pixelCount` columns,
 * producing (minY, maxY) per column in [0, 1] space. Columns with no events return NaN.
 *
 * Caller is responsible for mapping y into 0.0..1.0 for the lane's display range
 * (e.g. pitch lane uses -1..+1 and rescales to 0..1 before calling, or uses a different mapper).
 */
export function bucketContinuous(
  events: RecordedEvent[],
  indices: number[],
  t0: number,
  t1: number,
  pixelCount: number,
  valueFn: (e: RecordedEvent) => number
): Array<{ min: number; max: number } | null> {
  const out: Array<{ min: number; max: number } | null> = new Array(pixelCount).fill(null);
  if (t1 <= t0 || pixelCount <= 0 || indices.length === 0) return out;

  const msPerPx = (t1 - t0) / pixelCount;

  // Find the first index in `indices` whose event.tRel >= t0.
  let lo = 0;
  let hi = indices.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[indices[mid]].tRel < t0) lo = mid + 1;
    else hi = mid;
  }

  for (let k = lo; k < indices.length; k++) {
    const e = events[indices[k]];
    if (e.tRel >= t1) break;
    const col = Math.min(pixelCount - 1, Math.floor((e.tRel - t0) / msPerPx));
    const v = valueFn(e);
    const cur = out[col];
    if (cur === null) out[col] = { min: v, max: v };
    else {
      if (v < cur.min) cur.min = v;
      if (v > cur.max) cur.max = v;
    }
  }
  return out;
}

/**
 * Reduce a PCM Float32Array into per-column (min, max) peaks.
 * Samples are downsampled by linear bucketing to fit pixelCount columns.
 */
export function computeAudioPeaks(
  samples: Float32Array,
  pixelCount: number
): Array<{ min: number; max: number }> {
  const out: Array<{ min: number; max: number }> = new Array(pixelCount);
  if (pixelCount <= 0) return out;
  const samplesPerPx = samples.length / pixelCount;

  for (let col = 0; col < pixelCount; col++) {
    const start = Math.floor(col * samplesPerPx);
    const end = Math.min(samples.length, Math.floor((col + 1) * samplesPerPx));
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = start; i < end; i++) {
      const s = samples[i];
      if (s < mn) mn = s;
      if (s > mx) mx = s;
    }
    if (mn === Infinity) { mn = 0; mx = 0; }
    out[col] = { min: mn, max: mx };
  }
  return out;
}

/** Format a millisecond offset as "mm:ss.mmm". Negative values prefixed with "-". */
export function formatTime(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  const mmm = Math.floor(abs % 1000).toString().padStart(3, "0");
  return `${sign}${mm}:${ss}.${mmm}`;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/timeline-util.ts
git commit -m "feat: add timeline-util (binary search, note pairing, bucketing)"
```

---

## Task 3: Create `electron/recording-store.ts`

**Files:**
- Create: `electron/recording-store.ts`

- [ ] **Step 1: Write the file**

Create `electron/recording-store.ts`:

```typescript
import { app, dialog, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { Recording, RecentRecordingEntry } from "../src/lib/types";

const RECENT_LIMIT = 10;
const STREAM_SERIALIZE_THRESHOLD = 50 * 1024 * 1024; // 50 MB
const AUDIO_FILTERS = [
  { name: "Audio", extensions: ["wav", "mp3", "ogg", "flac", "m4a", "aac"] },
];
const OSCREC_FILTERS = [
  { name: "Oscilot Recording", extensions: ["oscrec"] },
];

export class RecordingStore {
  private recordingsDir: string;
  private recentFile: string;

  constructor() {
    this.recordingsDir = path.join(app.getPath("userData"), "recordings");
    this.recentFile = path.join(app.getPath("userData"), "recent-recordings.json");
    if (!fs.existsSync(this.recordingsDir)) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
    }
  }

  async saveDialog(win: BrowserWindow | null, rec: Recording, defaultPath?: string): Promise<
    { path: string } | { cancelled: true }
  > {
    const suggested = defaultPath ?? path.join(
      this.recordingsDir,
      sanitizeFilename(rec.name || "Untitled") + ".oscrec"
    );
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      title: "Save Recording",
      defaultPath: suggested,
      filters: OSCREC_FILTERS,
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    this.writeFile(result.filePath, rec);
    this.pushRecent({ path: result.filePath, name: rec.name, savedAt: Date.now() });
    return { path: result.filePath };
  }

  writeFile(filePath: string, rec: Recording): void {
    const payload = { ...rec, version: 1 as const };
    const estimate = rec.events.length * 160; // rough bytes/event
    if (estimate > STREAM_SERIALIZE_THRESHOLD) {
      this.writeStreamed(filePath, payload);
    } else {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    }
  }

  private writeStreamed(filePath: string, rec: Recording & { version: 1 }): void {
    // Stream the events array to avoid building a massive JSON string in memory.
    const fd = fs.openSync(filePath, "w");
    try {
      const head = JSON.stringify({ ...rec, events: [] }, null, 2);
      // Replace the trailing `  "events": []\n}` with an opening `  "events": [\n`.
      const idx = head.lastIndexOf('"events": []');
      if (idx < 0) throw new Error("Stream serializer: events placeholder not found");
      fs.writeSync(fd, head.slice(0, idx) + '"events": [\n');
      for (let i = 0; i < rec.events.length; i++) {
        const sep = i === rec.events.length - 1 ? "\n" : ",\n";
        fs.writeSync(fd, "    " + JSON.stringify(rec.events[i]) + sep);
      }
      fs.writeSync(fd, "  ]\n}\n");
    } finally {
      fs.closeSync(fd);
    }
  }

  async loadDialog(win: BrowserWindow | null): Promise<
    { recording: Recording; path: string } | { cancelled: true }
  > {
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Open Recording",
      filters: OSCREC_FILTERS,
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    const filePath = result.filePaths[0];
    const recording = this.readFile(filePath);
    this.pushRecent({ path: filePath, name: recording.name, savedAt: Date.now() });
    return { recording, path: filePath };
  }

  readFile(filePath: string): Recording {
    const raw = fs.readFileSync(filePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Could not parse recording file: ${(err as Error).message}`);
    }
    return validateRecording(parsed);
  }

  listRecent(): RecentRecordingEntry[] {
    if (!fs.existsSync(this.recentFile)) return [];
    try {
      const raw = fs.readFileSync(this.recentFile, "utf-8");
      const entries = JSON.parse(raw) as RecentRecordingEntry[];
      const alive = entries.filter((e) => fs.existsSync(e.path));
      if (alive.length !== entries.length) {
        fs.writeFileSync(this.recentFile, JSON.stringify(alive, null, 2), "utf-8");
      }
      return alive;
    } catch {
      return [];
    }
  }

  private pushRecent(entry: RecentRecordingEntry): void {
    const current = this.listRecent().filter((e) => e.path !== entry.path);
    const next = [entry, ...current].slice(0, RECENT_LIMIT);
    fs.writeFileSync(this.recentFile, JSON.stringify(next, null, 2), "utf-8");
  }

  async pickAudio(win: BrowserWindow | null): Promise<{ path: string } | { cancelled: true }> {
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Load Audio File",
      filters: AUDIO_FILTERS,
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    return { path: result.filePaths[0] };
  }

  readAudioBytes(filePath: string): { bytes: ArrayBuffer; mimeType: string } {
    const buf = fs.readFileSync(filePath);
    // Transferring Buffer over IPC serializes to a Uint8Array; callers convert to ArrayBuffer.
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return { bytes: ab, mimeType: mimeFor(filePath) };
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]+/g, "_").slice(0, 80).trim() || "Untitled";
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".wav":  return "audio/wav";
    case ".mp3":  return "audio/mpeg";
    case ".ogg":  return "audio/ogg";
    case ".flac": return "audio/flac";
    case ".m4a":
    case ".aac":  return "audio/aac";
    default:      return "application/octet-stream";
  }
}

function validateRecording(v: unknown): Recording {
  if (!v || typeof v !== "object") throw new Error("Recording file is not a JSON object");
  const r = v as Partial<Recording>;
  if (r.version !== 1) throw new Error(`Unsupported recording version: ${String(r.version)} (expected 1)`);
  if (typeof r.id !== "string") throw new Error("Recording missing 'id'");
  if (typeof r.name !== "string") throw new Error("Recording missing 'name'");
  if (typeof r.startedAt !== "number") throw new Error("Recording missing 'startedAt'");
  if (typeof r.durationMs !== "number") throw new Error("Recording missing 'durationMs'");
  if (!Array.isArray(r.events)) throw new Error("Recording.events must be an array");
  if (!Array.isArray(r.devices)) throw new Error("Recording.devices must be an array");
  if (!Array.isArray(r.mappingRulesSnapshot)) throw new Error("Recording.mappingRulesSnapshot must be an array");
  for (let i = 0; i < r.events.length; i++) {
    const e = r.events[i] as Partial<Recording["events"][number]>;
    if (typeof e.tRel !== "number" || !e.midi || !e.osc) {
      throw new Error(`Recording.events[${i}] is malformed`);
    }
  }
  return r as Recording;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/recording-store.ts
git commit -m "feat: add RecordingStore for saving/loading .oscrec files and reading audio bytes"
```

---

## Task 4: Wire `recording:*` IPC handlers

**Files:**
- Modify: `electron/ipc-handlers.ts`
- Modify: `package.json` (esbuild compile script)

- [ ] **Step 1: Add recording-store to the esbuild compile entry list**

In `package.json`, find the `electron:compile` script. Current value (line 13):

```
"electron:compile": "esbuild electron/main.ts electron/preload.ts electron/ipc-handlers.ts electron/osc-manager.ts electron/endpoints-store.ts electron/deck-store.ts electron/diagnostics.ts electron/web-server.ts electron/auto-updater.ts electron/midi-manager.ts electron/midi-store.ts --outdir=electron --platform=node --format=cjs --packages=external",
```

Change it to include `electron/recording-store.ts`:

```
"electron:compile": "esbuild electron/main.ts electron/preload.ts electron/ipc-handlers.ts electron/osc-manager.ts electron/endpoints-store.ts electron/deck-store.ts electron/diagnostics.ts electron/web-server.ts electron/auto-updater.ts electron/midi-manager.ts electron/midi-store.ts electron/recording-store.ts --outdir=electron --platform=node --format=cjs --packages=external",
```

- [ ] **Step 2: Import and instantiate `RecordingStore` in `electron/ipc-handlers.ts`**

At the top of `ipc-handlers.ts`, add to the imports (after `import { MidiStore } from "./midi-store";`):

```typescript
import { RecordingStore } from "./recording-store";
import { Recording } from "../src/lib/types";
```

Note: `Recording` goes next to the existing imports from `../src/lib/types`. If the file already imports from that path, merge into one import statement.

- [ ] **Step 3: Instantiate inside `registerIpcHandlers`**

Just after `const midiManager = new MidiManager(oscManager);`, add:

```typescript
  const recordingStore = new RecordingStore();
```

- [ ] **Step 4: Register `recording:*` handlers**

Append a new block after the existing `// --- MIDI ---` handlers and before the `// --- Forward OSC messages to renderer (batched) ---` section:

```typescript
  // --- Recording / Timeline ---
  ipcMain.handle("recording:save", async (_e, rec: Recording, suggestedPath?: string) => {
    return recordingStore.saveDialog(getMainWindow(), rec, suggestedPath);
  });

  ipcMain.handle("recording:save-as", async (_e, rec: Recording) => {
    return recordingStore.saveDialog(getMainWindow(), rec);
  });

  ipcMain.handle("recording:load", async () => {
    try {
      return await recordingStore.loadDialog(getMainWindow());
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("recording:load-path", async (_e, filePath: string) => {
    try {
      const recording = recordingStore.readFile(filePath);
      return { recording, path: filePath };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("recording:list-recent", () => {
    return { entries: recordingStore.listRecent() };
  });

  ipcMain.handle("recording:pick-audio", async () => {
    return recordingStore.pickAudio(getMainWindow());
  });

  ipcMain.handle("recording:read-audio-bytes", (_e, filePath: string) => {
    try {
      return recordingStore.readAudioBytes(filePath);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
```

- [ ] **Step 5: Recompile electron**

```bash
pnpm electron:compile
```

Expected: compiles without errors. If you get `Could not resolve "./recording-store"`, double-check the `package.json` change in Step 1.

- [ ] **Step 6: Start the app and verify no regressions**

```bash
pnpm electron:dev
```

Manual check: app opens, existing tabs (Listener/Sender/Deck/MIDI/Diagnostics) still load without console errors. The new `recording:*` channels exist but aren't called yet.

- [ ] **Step 7: Commit**

```bash
git add electron/ipc-handlers.ts package.json
git commit -m "feat: register recording:* IPC handlers and add recording-store to esbuild"
```

---

## Task 5: Create `src/hooks/use-recorder.ts`

**Files:**
- Create: `src/hooks/use-recorder.ts`

The recorder uses a mutable buffer ref (authoritative) + a version counter (triggers renders). This lets downstream components read the full buffer on demand without copying millions of events per render.

- [ ] **Step 1: Write the file**

Create `src/hooks/use-recorder.ts`:

```typescript
"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import type {
  MidiEvent,
  MidiMappingRule,
  Recording,
  RecordedEvent,
  RecorderState,
} from "@/lib/types";
import { useMidiEvents } from "@/hooks/use-midi";

interface UseRecorderArgs {
  getMappingRulesSnapshot: () => MidiMappingRule[]; // called on stop
}

/**
 * Recorder state machine + in-memory buffer.
 *
 * The buffer is kept in a ref (not state) to avoid copying huge arrays on
 * every batch. `bufferVersion` is bumped each time the buffer is mutated;
 * components that read `bufferRef.current` depend on `bufferVersion` to
 * re-render.
 */
export function useRecorder({ getMappingRulesSnapshot }: UseRecorderArgs) {
  const [state, setState] = useState<RecorderState>("idle");
  const [bufferVersion, setBufferVersion] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);

  const bufferRef = useRef<RecordedEvent[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const stateRef = useRef<RecorderState>("idle");
  stateRef.current = state;

  useMidiEvents(
    useCallback((incoming: MidiEvent[]) => {
      if (stateRef.current !== "recording") return;
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;

      for (const ev of incoming) {
        const tRel = Math.max(0, ev.midi.timestamp - startedAt);
        bufferRef.current.push({ tRel, midi: ev.midi, osc: ev.osc });
      }
      setBufferVersion((v) => v + 1);
    }, [])
  );

  const start = useCallback(() => {
    bufferRef.current = [];
    startedAtRef.current = Date.now();
    setRecording(null);
    setHasUnsaved(false);
    setBufferVersion((v) => v + 1);
    setState("recording");
  }, []);

  const stop = useCallback(() => {
    if (stateRef.current !== "recording") return;
    const startedAt = startedAtRef.current ?? Date.now();
    const durationMs = Date.now() - startedAt;
    const events = bufferRef.current;
    const devices = Array.from(new Set(events.map((e) => e.midi.deviceName)));

    const rec: Recording = {
      version: 1,
      id: crypto.randomUUID(),
      name: "Untitled",
      startedAt,
      durationMs,
      events,
      devices,
      mappingRulesSnapshot: getMappingRulesSnapshot(),
      audio: undefined,
    };

    setRecording(rec);
    setHasUnsaved(true);
    setState("stopped");
  }, [getMappingRulesSnapshot]);

  /** Clear buffer and recording, returning to idle. Does NOT prompt. */
  const clear = useCallback(() => {
    bufferRef.current = [];
    startedAtRef.current = null;
    setRecording(null);
    setHasUnsaved(false);
    setBufferVersion((v) => v + 1);
    setState("idle");
  }, []);

  /** Replace the current in-memory recording (e.g. after Load from file). */
  const setLoaded = useCallback((rec: Recording) => {
    bufferRef.current = rec.events;
    startedAtRef.current = null;
    setRecording(rec);
    setHasUnsaved(false);
    setBufferVersion((v) => v + 1);
    setState("stopped");
  }, []);

  /** Update recording metadata (e.g. rename, attach audio). Marks as unsaved. */
  const patchRecording = useCallback((patch: Partial<Recording>) => {
    setRecording((prev) => {
      if (!prev) return prev;
      return { ...prev, ...patch };
    });
    setHasUnsaved(true);
  }, []);

  const markSaved = useCallback(() => {
    setHasUnsaved(false);
  }, []);

  // Defensive: if component unmounts mid-recording, don't leak event handler work.
  useEffect(() => () => {
    stateRef.current = "idle";
  }, []);

  return {
    state,
    bufferVersion,
    bufferRef,
    recording,
    hasUnsaved,
    start,
    stop,
    clear,
    setLoaded,
    patchRecording,
    markSaved,
    startedAtRef,
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-recorder.ts
git commit -m "feat: add useRecorder hook with buffer-ref + version-counter pattern"
```

---

## Task 6: Create `src/hooks/use-recording-io.ts`

**Files:**
- Create: `src/hooks/use-recording-io.ts`

- [ ] **Step 1: Write the file**

Create `src/hooks/use-recording-io.ts`:

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";
import type { Recording, RecentRecordingEntry } from "@/lib/types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useRecordingIO() {
  const [recent, setRecent] = useState<RecentRecordingEntry[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);

  const refreshRecent = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const res = (await api.invoke("recording:list-recent")) as { entries: RecentRecordingEntry[] };
    setRecent(res.entries);
  }, []);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  const save = useCallback(
    async (rec: Recording, suggestedPath?: string) => {
      setLastError(null);
      const api = getAPI();
      if (!api) return null;
      const res = (await api.invoke("recording:save", rec, suggestedPath)) as
        | { path: string }
        | { cancelled: true }
        | { error: string };
      if ("error" in res) { setLastError(res.error); return null; }
      if ("cancelled" in res) return null;
      setLastSavedPath(res.path);
      refreshRecent();
      return res.path;
    },
    [refreshRecent]
  );

  const saveAs = useCallback(
    async (rec: Recording) => {
      setLastError(null);
      const api = getAPI();
      if (!api) return null;
      const res = (await api.invoke("recording:save-as", rec)) as
        | { path: string }
        | { cancelled: true }
        | { error: string };
      if ("error" in res) { setLastError(res.error); return null; }
      if ("cancelled" in res) return null;
      setLastSavedPath(res.path);
      refreshRecent();
      return res.path;
    },
    [refreshRecent]
  );

  const load = useCallback(async () => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:load")) as
      | { recording: Recording; path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res) { setLastError(res.error); return null; }
    if ("cancelled" in res) return null;
    refreshRecent();
    return res;
  }, [refreshRecent]);

  const loadPath = useCallback(async (filePath: string) => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:load-path", filePath)) as
      | { recording: Recording; path: string }
      | { error: string };
    if ("error" in res) { setLastError(res.error); return null; }
    return res;
  }, []);

  const pickAudio = useCallback(async () => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:pick-audio")) as
      | { path: string }
      | { cancelled: true };
    if ("cancelled" in res) return null;
    return res.path;
  }, []);

  const readAudioBytes = useCallback(async (filePath: string) => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:read-audio-bytes", filePath)) as
      | { bytes: ArrayBuffer; mimeType: string }
      | { error: string };
    if ("error" in res) { setLastError(res.error); return null; }
    return res;
  }, []);

  return {
    recent,
    lastError,
    lastSavedPath,
    refreshRecent,
    save,
    saveAs,
    load,
    loadPath,
    pickAudio,
    readAudioBytes,
    clearError: () => setLastError(null),
  };
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-recording-io.ts
git commit -m "feat: add useRecordingIO hook (save/load/recent/audio IPC wrappers)"
```

---

## Task 7: Create `src/hooks/use-audio-sync.ts`

**Files:**
- Create: `src/hooks/use-audio-sync.ts`

The transport hook handles both cases (audio loaded and not loaded) uniformly. It always exposes `playheadMs` via a ref that's updated from `requestAnimationFrame`; direct DOM consumers read the ref.

- [ ] **Step 1: Write the file**

Create `src/hooks/use-audio-sync.ts`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeAudioPeaks } from "@/lib/timeline-util";

interface UseAudioSyncArgs {
  /** Recording duration in ms (upper bound for transport). */
  durationMs: number;
  /** Called whenever playhead changes by integration; not every rAF tick. Optional. */
  onPlayheadChange?: (ms: number) => void;
}

interface AudioState {
  filePath: string | null;
  src: string | null;       // blob URL or null
  durationMs: number;       // audio duration in ms (0 if no audio)
  peaksByWidth: Map<number, Array<{ min: number; max: number }>>; // cached per width
  peakSamples: Float32Array | null; // mono mixdown for peak re-computation
  offsetMs: number;
  mimeType: string | null;
}

export function useAudioSync({ durationMs, onPlayheadChange }: UseAudioSyncArgs) {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playheadMsRef = useRef<number>(0);
  const playStartedAtRef = useRef<number | null>(null); // performance.now() when play began
  const playStartedHeadRef = useRef<number>(0);         // playhead at play start
  const rafIdRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [audio, setAudio] = useState<AudioState>({
    filePath: null,
    src: null,
    durationMs: 0,
    peaksByWidth: new Map(),
    peakSamples: null,
    offsetMs: 0,
    mimeType: null,
  });

  // Attach / detach the <audio> element on audio change.
  useEffect(() => {
    if (!audio.src) {
      audioElRef.current = null;
      return;
    }
    const el = new Audio(audio.src);
    el.preload = "auto";
    audioElRef.current = el;
    return () => {
      el.pause();
      audioElRef.current = null;
    };
  }, [audio.src]);

  // rAF loop: maintain playheadMsRef while playing.
  useEffect(() => {
    if (!isPlaying) return;
    const tick = () => {
      const el = audioElRef.current;
      if (el && audio.src) {
        playheadMsRef.current = el.currentTime * 1000 - audio.offsetMs;
      } else if (playStartedAtRef.current !== null) {
        playheadMsRef.current = playStartedHeadRef.current + (performance.now() - playStartedAtRef.current);
      }
      const total = Math.max(durationMs, audio.durationMs - audio.offsetMs);
      if (playheadMsRef.current >= total) {
        playheadMsRef.current = total;
        setIsPlaying(false);
        return;
      }
      onPlayheadChange?.(playheadMsRef.current);
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isPlaying, audio.src, audio.offsetMs, audio.durationMs, durationMs, onPlayheadChange]);

  const play = useCallback(() => {
    const el = audioElRef.current;
    if (el) {
      el.currentTime = Math.max(0, (playheadMsRef.current + audio.offsetMs) / 1000);
      el.play().catch(() => {});
    } else {
      playStartedAtRef.current = performance.now();
      playStartedHeadRef.current = playheadMsRef.current;
    }
    setIsPlaying(true);
  }, [audio.offsetMs]);

  const pause = useCallback(() => {
    const el = audioElRef.current;
    if (el) el.pause();
    setIsPlaying(false);
    playStartedAtRef.current = null;
  }, []);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(ms, Math.max(durationMs, audio.durationMs - audio.offsetMs)));
      playheadMsRef.current = clamped;
      const el = audioElRef.current;
      if (el) el.currentTime = Math.max(0, (clamped + audio.offsetMs) / 1000);
      playStartedAtRef.current = isPlaying ? performance.now() : null;
      playStartedHeadRef.current = clamped;
      onPlayheadChange?.(clamped);
    },
    [durationMs, audio.durationMs, audio.offsetMs, isPlaying, onPlayheadChange]
  );

  const setOffset = useCallback((ms: number) => {
    setAudio((a) => ({ ...a, offsetMs: ms }));
    const el = audioElRef.current;
    if (el) {
      el.currentTime = Math.max(0, (playheadMsRef.current + ms) / 1000);
    }
  }, []);

  /**
   * Decode audio bytes into a playable blob URL + peaks array for the waveform.
   * Retains only a mono-mixdown Float32Array for re-bucketing on zoom change.
   */
  const loadBytes = useCallback(
    async (filePath: string, bytes: ArrayBuffer, mimeType: string, initialOffsetMs = 0) => {
      // Playback: blob URL
      const blob = new Blob([bytes], { type: mimeType });
      const src = URL.createObjectURL(blob);

      // Peaks: decode via Web Audio and mix to mono.
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decoded = await ctx.decodeAudioData(bytes.slice(0));
      const channels = decoded.numberOfChannels;
      const len = decoded.length;
      const mono = new Float32Array(len);
      for (let ch = 0; ch < channels; ch++) {
        const data = decoded.getChannelData(ch);
        for (let i = 0; i < len; i++) mono[i] += data[i];
      }
      if (channels > 1) {
        for (let i = 0; i < len; i++) mono[i] /= channels;
      }
      const audioDurationMs = (len / decoded.sampleRate) * 1000;
      try { await ctx.close(); } catch { /* noop */ }

      setAudio((prev) => {
        if (prev.src) URL.revokeObjectURL(prev.src);
        return {
          filePath,
          src,
          durationMs: audioDurationMs,
          peaksByWidth: new Map(),
          peakSamples: mono,
          offsetMs: initialOffsetMs,
          mimeType,
        };
      });
    },
    []
  );

  /** Get (or compute and cache) the peaks for a given pixel width. */
  const getPeaks = useCallback(
    (pixelWidth: number) => {
      if (!audio.peakSamples) return null;
      const cached = audio.peaksByWidth.get(pixelWidth);
      if (cached) return cached;
      const peaks = computeAudioPeaks(audio.peakSamples, pixelWidth);
      audio.peaksByWidth.set(pixelWidth, peaks);
      return peaks;
    },
    [audio.peakSamples, audio.peaksByWidth]
  );

  const unloadAudio = useCallback(() => {
    setAudio((prev) => {
      if (prev.src) URL.revokeObjectURL(prev.src);
      return {
        filePath: null,
        src: null,
        durationMs: 0,
        peaksByWidth: new Map(),
        peakSamples: null,
        offsetMs: 0,
        mimeType: null,
      };
    });
  }, []);

  return {
    isPlaying,
    audio,
    playheadMsRef,
    play,
    pause,
    seek,
    setOffset,
    loadBytes,
    unloadAudio,
    getPeaks,
  };
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-audio-sync.ts
git commit -m "feat: add useAudioSync hook (transport, audio element, peak cache)"
```

---

## Task 8: Create `TimeRuler` component

**Files:**
- Create: `src/components/timeline/time-ruler.tsx`

- [ ] **Step 1: Write the file**

Create `src/components/timeline/time-ruler.tsx`:

```typescript
"use client";

import { useMemo, useRef } from "react";
import { formatTime } from "@/lib/timeline-util";

interface TimeRulerProps {
  viewStartMs: number;
  viewEndMs: number;
  leftGutterPx: number;
  onSeek: (ms: number) => void;
}

export function TimeRuler({ viewStartMs, viewEndMs, leftGutterPx, onSeek }: TimeRulerProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  const ticks = useMemo(() => {
    const span = viewEndMs - viewStartMs;
    if (span <= 0) return [];
    // Pick a nice tick spacing: 100ms, 500ms, 1s, 5s, 10s, 30s, 60s, 300s.
    const candidates = [100, 500, 1000, 5000, 10000, 30000, 60000, 300000];
    const targetCount = 8;
    let step = candidates[candidates.length - 1];
    for (const c of candidates) {
      if (span / c <= targetCount) { step = c; break; }
    }
    const first = Math.ceil(viewStartMs / step) * step;
    const arr: number[] = [];
    for (let t = first; t <= viewEndMs; t += step) arr.push(t);
    return arr;
  }, [viewStartMs, viewEndMs]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - leftGutterPx;
    const trackWidth = rect.width - leftGutterPx;
    if (x < 0 || trackWidth <= 0) return;
    const ms = viewStartMs + (x / trackWidth) * (viewEndMs - viewStartMs);
    onSeek(ms);
    el.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - leftGutterPx;
    const trackWidth = rect.width - leftGutterPx;
    if (trackWidth <= 0) return;
    const ms = viewStartMs + (x / trackWidth) * (viewEndMs - viewStartMs);
    onSeek(ms);
  };

  return (
    <div
      ref={ref}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      className="relative h-6 border-b border-white/5 text-[10px] text-gray-500 font-mono cursor-ew-resize select-none"
    >
      <div style={{ position: "absolute", left: 0, top: 0, width: leftGutterPx, height: "100%" }} />
      {ticks.map((t) => {
        const pct = ((t - viewStartMs) / (viewEndMs - viewStartMs)) * 100;
        const leftCss = `calc(${leftGutterPx}px + ${pct}% - ${leftGutterPx * pct / 100}px)`;
        return (
          <div key={t} style={{ position: "absolute", left: leftCss, top: 2 }}>
            <span className="opacity-70">{formatTime(t)}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/time-ruler.tsx
git commit -m "feat: add TimeRuler with click-to-seek"
```

---

## Task 9: Create `AudioLane` component

**Files:**
- Create: `src/components/timeline/audio-lane.tsx`

- [ ] **Step 1: Write the file**

Create `src/components/timeline/audio-lane.tsx`:

```typescript
"use client";

import { useEffect, useRef } from "react";

interface AudioLaneProps {
  /** Peaks normalized to [-1, 1]; null = no audio loaded. */
  peaks: Array<{ min: number; max: number }> | null;
  heightPx: number;
  /** Optional filename shown as label. */
  label?: string;
  /** Drag callback: receives pixel delta (positive = audio shifted right). */
  onOffsetDragDelta?: (deltaPx: number, modifier: "none" | "shift" | "alt") => void;
  leftGutterPx: number;
}

export function AudioLane({ peaks, heightPx, label, onOffsetDragDelta, leftGutterPx }: AudioLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const dragModifierRef = useRef<"none" | "shift" | "alt">("none");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    if (!peaks || peaks.length === 0) return;

    ctx.strokeStyle = "rgba(142,203,255,0.55)";
    ctx.lineWidth = 1;
    const mid = height / 2;
    ctx.beginPath();
    for (let i = 0; i < peaks.length; i++) {
      const p = peaks[i];
      const x = (i / peaks.length) * width;
      ctx.moveTo(x, mid - p.max * mid);
      ctx.lineTo(x, mid - p.min * mid);
    }
    ctx.stroke();
  }, [peaks, heightPx]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartXRef.current = e.clientX;
    dragModifierRef.current = e.altKey ? "alt" : e.shiftKey ? "shift" : "none";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current === null) return;
    const delta = e.clientX - dragStartXRef.current;
    dragStartXRef.current = e.clientX;
    onOffsetDragDelta?.(delta, dragModifierRef.current);
  };

  const handlePointerUp = () => {
    dragStartXRef.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className="relative border-b border-white/5"
      style={{ height: heightPx, background: "linear-gradient(180deg, rgba(142,203,255,0.05), rgba(142,203,255,0.01))" }}
    >
      <div
        className="absolute left-0 top-0 h-full text-[10px] text-accent font-mono px-3 flex items-center border-r border-white/5 z-[2]"
        style={{ width: leftGutterPx }}
      >
        ♪ {label ?? (peaks ? "audio" : "no audio")}
      </div>
      <div
        className="absolute top-0 bottom-0"
        style={{ left: leftGutterPx, right: 0, cursor: onOffsetDragDelta ? "ew-resize" : "default" }}
        onPointerDown={onOffsetDragDelta ? handlePointerDown : undefined}
        onPointerMove={onOffsetDragDelta ? handlePointerMove : undefined}
        onPointerUp={onOffsetDragDelta ? handlePointerUp : undefined}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/audio-lane.tsx
git commit -m "feat: add AudioLane with canvas waveform and drag-to-offset"
```

---

## Task 10: Create `NotesLane` component

**Files:**
- Create: `src/components/timeline/notes-lane.tsx`

- [ ] **Step 1: Write the file**

Create `src/components/timeline/notes-lane.tsx`:

```typescript
"use client";

import { useMemo } from "react";
import type { NoteSpan } from "@/lib/types";

interface NotesLaneProps {
  spans: NoteSpan[];
  viewStartMs: number;
  viewEndMs: number;
  heightPx: number;
  leftGutterPx: number;
  onHover?: (span: NoteSpan | null, clientX: number, clientY: number) => void;
}

/**
 * Piano-roll mini. Notes are positioned by pitch (y) and time (x).
 * Pitch range is auto-fit to the recording's active pitches (for compactness),
 * computed on the full span set.
 */
export function NotesLane({ spans, viewStartMs, viewEndMs, heightPx, leftGutterPx, onHover }: NotesLaneProps) {
  const { minPitch, maxPitch } = useMemo(() => {
    if (spans.length === 0) return { minPitch: 36, maxPitch: 84 };
    let mn = Infinity, mx = -Infinity;
    for (const s of spans) {
      if (s.pitch < mn) mn = s.pitch;
      if (s.pitch > mx) mx = s.pitch;
    }
    if (mn === mx) { mn = Math.max(0, mn - 6); mx = Math.min(127, mx + 6); }
    return { minPitch: mn, maxPitch: mx };
  }, [spans]);

  const visibleSpans = useMemo(() => {
    // A span is visible if it overlaps [viewStart, viewEnd).
    return spans.filter((s) => s.tEnd >= viewStartMs && s.tStart < viewEndMs);
  }, [spans, viewStartMs, viewEndMs]);

  const viewSpan = viewEndMs - viewStartMs;
  const pitchSpan = Math.max(1, maxPitch - minPitch);

  return (
    <div
      className="relative border-t border-white/5"
      style={{ height: heightPx }}
    >
      <div
        className="absolute left-0 top-0 h-full text-[10px] text-gray-500 px-3 flex items-center border-r border-white/5 z-[2] bg-black/0"
        style={{ width: leftGutterPx }}
      >
        Notes
      </div>
      <div className="absolute top-0 bottom-0" style={{ left: leftGutterPx, right: 0 }}>
        {visibleSpans.map((s, i) => {
          const xStartPct = ((Math.max(s.tStart, viewStartMs) - viewStartMs) / viewSpan) * 100;
          const xEndPct = ((Math.min(s.tEnd, viewEndMs) - viewStartMs) / viewSpan) * 100;
          const widthPct = Math.max(0.15, xEndPct - xStartPct);
          const yPct = (1 - (s.pitch - minPitch) / pitchSpan) * 100;
          const alpha = 0.45 + (s.velocity / 127) * 0.5;
          return (
            <div
              key={`${s.device}|${s.channel}|${s.pitch}|${s.tStart}|${i}`}
              onMouseEnter={(e) => onHover?.(s, e.clientX, e.clientY)}
              onMouseLeave={() => onHover?.(null, 0, 0)}
              onMouseMove={(e) => onHover?.(s, e.clientX, e.clientY)}
              style={{
                position: "absolute",
                left: `${xStartPct}%`,
                width: `${widthPct}%`,
                top: `calc(${yPct}% - 2px)`,
                height: 3,
                background: `rgba(142,203,255,${alpha})`,
                borderRadius: 1,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/notes-lane.tsx
git commit -m "feat: add NotesLane (piano-roll mini with pitch auto-fit)"
```

---

## Task 11: Create `ContinuousLane` component

**Files:**
- Create: `src/components/timeline/continuous-lane.tsx`

This component backs CC / pitch / aftertouch lanes — all three draw a curve over time.

- [ ] **Step 1: Write the file**

Create `src/components/timeline/continuous-lane.tsx`:

```typescript
"use client";

import { useEffect, useRef } from "react";
import type { RecordedEvent } from "@/lib/types";
import { bucketContinuous, eventValue } from "@/lib/timeline-util";

interface ContinuousLaneProps {
  label: string;              // e.g. "CC 7 · ch1"
  sublabel?: string;          // e.g. "/fader/master"
  events: RecordedEvent[];    // full buffer
  eventIndices: number[];     // indices into events belonging to this lane
  viewStartMs: number;
  viewEndMs: number;
  heightPx: number;
  leftGutterPx: number;
  /** Map raw value into 0..1 lane space. Default: identity (clamped) for 0..1 values; pitch is -1..1 → 0..1. */
  valueMapper?: (v: number) => number;
  color?: string;             // stroke color
  fill?: string;              // fill under curve
  bufferVersion?: number;     // triggers redraw during recording
  onHover?: (evt: RecordedEvent | null, clientX: number, clientY: number) => void;
}

export function ContinuousLane({
  label,
  sublabel,
  events,
  eventIndices,
  viewStartMs,
  viewEndMs,
  heightPx,
  leftGutterPx,
  valueMapper,
  color = "#c7f168",
  fill = "rgba(199,241,104,0.10)",
  bufferVersion,
  onHover,
}: ContinuousLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const map = valueMapper ?? ((v: number) => Math.max(0, Math.min(1, v)));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const pixelCount = width;
    const buckets = bucketContinuous(
      events,
      eventIndices,
      viewStartMs,
      viewEndMs,
      pixelCount,
      (e) => map(eventValue(e))
    );

    // Fill under curve
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, height);
    let hadAny = false;
    for (let i = 0; i < pixelCount; i++) {
      const b = buckets[i];
      if (b) {
        const yTop = height - b.max * height;
        ctx.lineTo(i, yTop);
        hadAny = true;
      }
    }
    if (hadAny) {
      ctx.lineTo(pixelCount - 1, height);
      ctx.closePath();
      ctx.fill();
    }

    // Stroke (top of each bucket)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pixelCount; i++) {
      const b = buckets[i];
      if (!b) continue;
      const yMax = height - b.max * height;
      const yMin = height - b.min * height;
      if (!started) { ctx.moveTo(i, yMax); started = true; }
      else ctx.lineTo(i, yMax);
      if (yMin !== yMax) {
        ctx.moveTo(i, yMin);
        ctx.lineTo(i, yMax);
        ctx.moveTo(i, yMax);
      }
    }
    ctx.stroke();
  }, [events, eventIndices, viewStartMs, viewEndMs, heightPx, color, fill, map, bufferVersion]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap || !onHover) return;
    const rect = wrap.getBoundingClientRect();
    const xIn = e.clientX - rect.left - leftGutterPx;
    const trackWidth = rect.width - leftGutterPx;
    if (xIn < 0 || trackWidth <= 0) { onHover(null, 0, 0); return; }
    const pct = xIn / trackWidth;
    const tMs = viewStartMs + pct * (viewEndMs - viewStartMs);
    // Find nearest event index (in this lane) to tMs.
    if (eventIndices.length === 0) { onHover(null, 0, 0); return; }
    let lo = 0, hi = eventIndices.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[eventIndices[mid]].tRel < tMs) lo = mid + 1;
      else hi = mid;
    }
    const candA = eventIndices[Math.max(0, lo - 1)];
    const candB = eventIndices[Math.min(eventIndices.length - 1, lo)];
    const picked =
      Math.abs(events[candA].tRel - tMs) < Math.abs(events[candB].tRel - tMs) ? candA : candB;
    onHover(events[picked], e.clientX, e.clientY);
  };

  const handleMouseLeave = () => onHover?.(null, 0, 0);

  return (
    <div
      ref={wrapRef}
      className="relative border-t border-white/5 flex"
      style={{ height: heightPx }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="text-[10px] text-gray-500 px-3 py-1 border-r border-white/5 flex flex-col justify-center overflow-hidden"
        style={{ width: leftGutterPx, flexShrink: 0 }}
      >
        <span className="truncate">{label}</span>
        {sublabel && <span className="text-gray-700 text-[9px] truncate">{sublabel}</span>}
      </div>
      <div className="flex-1 relative">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/continuous-lane.tsx
git commit -m "feat: add ContinuousLane (canvas curve with pixel-bucketing) for CC/pitch/aftertouch"
```

---

## Task 12: Create `ProgramLane` component

**Files:**
- Create: `src/components/timeline/program-lane.tsx`

- [ ] **Step 1: Write the file**

Create `src/components/timeline/program-lane.tsx`:

```typescript
"use client";

import { useMemo } from "react";
import type { RecordedEvent } from "@/lib/types";
import { findFirstGTE } from "@/lib/timeline-util";

interface ProgramLaneProps {
  label: string;
  sublabel?: string;
  events: RecordedEvent[];
  eventIndices: number[];
  viewStartMs: number;
  viewEndMs: number;
  heightPx: number;
  leftGutterPx: number;
  onHover?: (evt: RecordedEvent | null, clientX: number, clientY: number) => void;
}

export function ProgramLane({
  label,
  sublabel,
  events,
  eventIndices,
  viewStartMs,
  viewEndMs,
  heightPx,
  leftGutterPx,
  onHover,
}: ProgramLaneProps) {
  // Slice eventIndices to those in viewport using binary search on the underlying events.
  const visible = useMemo(() => {
    if (eventIndices.length === 0) return [];
    const subset = eventIndices; // already sorted by tRel via buffer order
    // binary-search inside subset by mapped tRel
    let lo = 0, hi = subset.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[subset[mid]].tRel < viewStartMs) lo = mid + 1;
      else hi = mid;
    }
    const start = lo;
    lo = 0; hi = subset.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[subset[mid]].tRel < viewEndMs) lo = mid + 1;
      else hi = mid;
    }
    return subset.slice(start, lo);
  }, [eventIndices, events, viewStartMs, viewEndMs]);

  const viewSpan = Math.max(1, viewEndMs - viewStartMs);

  return (
    <div className="relative border-t border-white/5 flex" style={{ height: heightPx }}>
      <div
        className="text-[10px] text-gray-500 px-3 py-1 border-r border-white/5 flex flex-col justify-center overflow-hidden"
        style={{ width: leftGutterPx, flexShrink: 0 }}
      >
        <span className="truncate">{label}</span>
        {sublabel && <span className="text-gray-700 text-[9px] truncate">{sublabel}</span>}
      </div>
      <div className="flex-1 relative">
        {visible.map((idx) => {
          const e = events[idx];
          const pct = ((e.tRel - viewStartMs) / viewSpan) * 100;
          return (
            <div
              key={idx}
              onMouseEnter={(ev) => onHover?.(e, ev.clientX, ev.clientY)}
              onMouseLeave={() => onHover?.(null, 0, 0)}
              style={{
                position: "absolute",
                left: `${pct}%`,
                top: "50%",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#ff9e57",
                transform: "translate(-50%, -50%)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/program-lane.tsx
git commit -m "feat: add ProgramLane with discrete markers"
```

---

## Task 13: Create `DeviceSection` component

**Files:**
- Create: `src/components/timeline/device-section.tsx`

- [ ] **Step 1: Write the file**

Create `src/components/timeline/device-section.tsx`:

```typescript
"use client";

import { useMemo } from "react";
import type { LaneKey, LaneMap, NoteSpan, RecordedEvent, MidiMappingRule } from "@/lib/types";
import { NotesLane } from "./notes-lane";
import { ContinuousLane } from "./continuous-lane";
import { ProgramLane } from "./program-lane";

interface DeviceSectionProps {
  device: string;
  laneMap: LaneMap;
  events: RecordedEvent[];
  noteSpans: NoteSpan[];               // pre-computed via pairNoteSpans for the whole recording
  mappingRules: MidiMappingRule[];     // for resolving OSC address names per lane
  viewStartMs: number;
  viewEndMs: number;
  leftGutterPx: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  bufferVersion?: number;
  onHoverEvent?: (evt: RecordedEvent | null, clientX: number, clientY: number) => void;
  onHoverSpan?: (span: NoteSpan | null, clientX: number, clientY: number) => void;
}

const NOTES_HEIGHT = 48;
const CONT_HEIGHT = 22;
const MARKER_HEIGHT = 22;
const SUMMARY_HEIGHT = 22;

/**
 * Find an OSC address from a mapping rule that matches the given lane key, if any.
 * Used to show the user's named address (e.g. "/fader/master") alongside the lane label.
 */
function oscLabelFor(key: LaneKey, rules: MidiMappingRule[]): string | undefined {
  if (key.kind === "cc") {
    const r = rules.find((r) => r.type === "cc" && (r.channel === undefined || r.channel === key.channel) && (r.data1 === undefined || r.data1 === key.cc));
    return r?.address;
  }
  if (key.kind === "pitch") {
    const r = rules.find((r) => r.type === "pitch" && (r.channel === undefined || r.channel === key.channel));
    return r?.address;
  }
  if (key.kind === "aftertouch") {
    const r = rules.find((r) =>
      r.type === "aftertouch" &&
      (r.channel === undefined || r.channel === key.channel) &&
      (r.data1 === undefined || r.data1 === (key.note ?? r.data1))
    );
    return r?.address;
  }
  if (key.kind === "program") {
    const r = rules.find((r) => r.type === "program" && (r.channel === undefined || r.channel === key.channel));
    return r?.address;
  }
  return undefined;
}

export function DeviceSection(props: DeviceSectionProps) {
  const {
    device, laneMap, events, noteSpans, mappingRules,
    viewStartMs, viewEndMs, leftGutterPx, collapsed, onToggleCollapsed,
    bufferVersion, onHoverEvent, onHoverSpan,
  } = props;

  const laneEntries = useMemo(() => {
    const list = Array.from(laneMap.values()).filter((entry) => keyDevice(entry.key) === device);
    // Order: notes first, then CCs sorted by channel then cc#, pitch, aftertouch, program.
    const rank = (k: LaneKey): number => {
      switch (k.kind) {
        case "notes":      return 0;
        case "cc":         return 1_000 + k.channel * 1000 + k.cc;
        case "pitch":      return 100_000 + k.channel;
        case "aftertouch": return 200_000 + k.channel * 1000 + (k.note ?? 0);
        case "program":    return 300_000 + k.channel;
      }
    };
    return list.sort((a, b) => rank(a.key) - rank(b.key));
  }, [laneMap, device]);

  const deviceNoteSpans = useMemo(
    () => noteSpans.filter((s) => s.device === device),
    [noteSpans, device]
  );

  const headerCount = `${laneEntries.length} lane${laneEntries.length === 1 ? "" : "s"}`;

  return (
    <div className="border-b border-white/5">
      <div
        onClick={onToggleCollapsed}
        className="flex items-center gap-2 px-3 py-1.5 bg-black/20 text-accent text-xs font-semibold cursor-pointer select-none hover:bg-black/30"
      >
        <span>{collapsed ? "▸" : "▾"}</span>
        <span>{device}</span>
        <span className="ml-auto text-gray-600 font-normal">{headerCount}</span>
      </div>

      {collapsed ? (
        <CollapsedSummaryRow
          entries={laneEntries}
          events={events}
          viewStartMs={viewStartMs}
          viewEndMs={viewEndMs}
          leftGutterPx={leftGutterPx}
        />
      ) : (
        <>
          {laneEntries.map((entry) => {
            const osc = oscLabelFor(entry.key, mappingRules);
            switch (entry.key.kind) {
              case "notes":
                return (
                  <NotesLane
                    key="notes"
                    spans={deviceNoteSpans}
                    viewStartMs={viewStartMs}
                    viewEndMs={viewEndMs}
                    heightPx={NOTES_HEIGHT}
                    leftGutterPx={leftGutterPx}
                    onHover={onHoverSpan}
                  />
                );
              case "cc":
                return (
                  <ContinuousLane
                    key={`cc|${entry.key.channel}|${entry.key.cc}`}
                    label={`CC ${entry.key.cc} · ch${entry.key.channel}`}
                    sublabel={osc}
                    events={events}
                    eventIndices={entry.eventIndices}
                    viewStartMs={viewStartMs}
                    viewEndMs={viewEndMs}
                    heightPx={CONT_HEIGHT}
                    leftGutterPx={leftGutterPx}
                    color="#c7f168"
                    fill="rgba(199,241,104,0.10)"
                    bufferVersion={bufferVersion}
                    onHover={onHoverEvent}
                  />
                );
              case "pitch":
                return (
                  <ContinuousLane
                    key={`pitch|${entry.key.channel}`}
                    label={`Pitch · ch${entry.key.channel}`}
                    sublabel={osc}
                    events={events}
                    eventIndices={entry.eventIndices}
                    viewStartMs={viewStartMs}
                    viewEndMs={viewEndMs}
                    heightPx={CONT_HEIGHT}
                    leftGutterPx={leftGutterPx}
                    color="#ffaed7"
                    fill="rgba(255,174,215,0.10)"
                    valueMapper={(v) => (v + 1) / 2} // pitch is -1..+1 → 0..1
                    bufferVersion={bufferVersion}
                    onHover={onHoverEvent}
                  />
                );
              case "aftertouch": {
                const labelSuffix = entry.key.note !== undefined ? ` #${entry.key.note}` : "";
                return (
                  <ContinuousLane
                    key={`at|${entry.key.channel}|${entry.key.note ?? "ch"}`}
                    label={`AT · ch${entry.key.channel}${labelSuffix}`}
                    sublabel={osc}
                    events={events}
                    eventIndices={entry.eventIndices}
                    viewStartMs={viewStartMs}
                    viewEndMs={viewEndMs}
                    heightPx={CONT_HEIGHT}
                    leftGutterPx={leftGutterPx}
                    color="#ffaed7"
                    fill="rgba(255,174,215,0.08)"
                    bufferVersion={bufferVersion}
                    onHover={onHoverEvent}
                  />
                );
              }
              case "program":
                return (
                  <ProgramLane
                    key={`prog|${entry.key.channel}`}
                    label={`Program · ch${entry.key.channel}`}
                    sublabel={osc}
                    events={events}
                    eventIndices={entry.eventIndices}
                    viewStartMs={viewStartMs}
                    viewEndMs={viewEndMs}
                    heightPx={MARKER_HEIGHT}
                    leftGutterPx={leftGutterPx}
                    onHover={onHoverEvent}
                  />
                );
            }
          })}
        </>
      )}
    </div>
  );
}

function keyDevice(k: LaneKey): string { return k.device; }

interface CollapsedSummaryRowProps {
  entries: Array<{ key: LaneKey; eventIndices: number[] }>;
  events: RecordedEvent[];
  viewStartMs: number;
  viewEndMs: number;
  leftGutterPx: number;
}

function CollapsedSummaryRow({ entries, events, viewStartMs, viewEndMs, leftGutterPx }: CollapsedSummaryRowProps) {
  // Collapse all event indices into a single viewport density bar.
  const viewSpan = Math.max(1, viewEndMs - viewStartMs);
  // Coarse buckets — 40 bins.
  const BIN_COUNT = 40;
  const bins = new Array<number>(BIN_COUNT).fill(0);
  for (const entry of entries) {
    for (const idx of entry.eventIndices) {
      const t = events[idx].tRel;
      if (t < viewStartMs || t >= viewEndMs) continue;
      const bin = Math.min(BIN_COUNT - 1, Math.floor(((t - viewStartMs) / viewSpan) * BIN_COUNT));
      bins[bin]++;
    }
  }
  const maxCount = Math.max(1, ...bins);

  return (
    <div className="relative flex border-t border-white/5" style={{ height: SUMMARY_HEIGHT }}>
      <div
        className="text-[10px] text-gray-700 px-3 flex items-center border-r border-white/5"
        style={{ width: leftGutterPx, flexShrink: 0 }}
      >
        (expand)
      </div>
      <div className="flex-1 relative">
        {bins.map((c, i) => {
          if (c === 0) return null;
          const alpha = 0.25 + 0.5 * (c / maxCount);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${(i / BIN_COUNT) * 100}%`,
                width: `${(1 / BIN_COUNT) * 100}%`,
                top: 4,
                bottom: 4,
                background: `rgba(142,203,255,${alpha})`,
                borderRadius: 2,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/device-section.tsx
git commit -m "feat: add DeviceSection (accordion per-device with ordered lanes + collapsed summary)"
```

---

## Task 14: Create `HoverCard` component

**Files:**
- Create: `src/components/timeline/hover-card.tsx`

- [ ] **Step 1: Write the file**

Create `src/components/timeline/hover-card.tsx`:

```typescript
"use client";

import type { NoteSpan, RecordedEvent } from "@/lib/types";
import { formatTime } from "@/lib/timeline-util";

interface HoverCardProps {
  payload:
    | { kind: "event"; event: RecordedEvent }
    | { kind: "span"; span: NoteSpan }
    | null;
  clientX: number;
  clientY: number;
}

export function HoverCard({ payload, clientX, clientY }: HoverCardProps) {
  if (!payload) return null;
  const left = Math.min(clientX + 12, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240);
  const top = clientY + 12;

  return (
    <div
      className="fixed z-50 text-[10px] font-mono bg-surface-lighter border border-accent/30 rounded px-2 py-1.5 shadow-lg pointer-events-none"
      style={{ left, top, minWidth: 200 }}
    >
      {payload.kind === "event" && <EventBody evt={payload.event} />}
      {payload.kind === "span" && <SpanBody span={payload.span} />}
    </div>
  );
}

function EventBody({ evt }: { evt: RecordedEvent }) {
  const { midi, osc, tRel } = evt;
  const oscArgs = osc.args.map((a) => (typeof a.value === "number" ? a.value.toFixed(3) : String(a.value))).join(" ");
  return (
    <>
      <Row label="time"   value={formatTime(tRel)} />
      <Row label="device" value={midi.deviceName} />
      <Row label="midi"   value={formatMidiLine(evt)} />
      <Row label="osc"    value={`${osc.address} ${oscArgs}`} color="#ffaed7" />
    </>
  );
}

function SpanBody({ span }: { span: NoteSpan }) {
  return (
    <>
      <Row label="time"   value={`${formatTime(span.tStart)} – ${formatTime(span.tEnd)}`} />
      <Row label="device" value={span.device} />
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

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/hover-card.tsx
git commit -m "feat: add HoverCard for timeline tooltip (event + note-span variants)"
```

---

## Task 15: Create `TimelineCanvas` component

**Files:**
- Create: `src/components/timeline/timeline-canvas.tsx`

`TimelineCanvas` owns the viewport (`viewStartMs`, `viewEndMs`), runs the playhead rAF loop, and renders all device sections + audio lane + time ruler.

- [ ] **Step 1: Write the file**

Create `src/components/timeline/timeline-canvas.tsx`:

```typescript
"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { LaneMap, MidiMappingRule, NoteSpan, RecordedEvent, Recording } from "@/lib/types";
import { TimeRuler } from "./time-ruler";
import { AudioLane } from "./audio-lane";
import { DeviceSection } from "./device-section";
import { HoverCard } from "./hover-card";

const LEFT_GUTTER = 140;

interface Viewport { startMs: number; endMs: number; }
type ViewAction =
  | { type: "set"; startMs: number; endMs: number }
  | { type: "scrollBy"; deltaMs: number }
  | { type: "zoom"; anchorMs: number; factor: number }
  | { type: "fit"; durationMs: number };

function viewReducer(v: Viewport, a: ViewAction): Viewport {
  switch (a.type) {
    case "set": return { startMs: a.startMs, endMs: a.endMs };
    case "scrollBy": {
      const d = a.deltaMs;
      return { startMs: v.startMs + d, endMs: v.endMs + d };
    }
    case "zoom": {
      const span = (v.endMs - v.startMs) * a.factor;
      const minSpan = 50;  // can't zoom below 50ms visible
      const maxSpan = 60 * 60 * 1000; // 1h visible max
      const clampedSpan = Math.max(minSpan, Math.min(maxSpan, span));
      const leftFrac = (a.anchorMs - v.startMs) / (v.endMs - v.startMs);
      return {
        startMs: a.anchorMs - leftFrac * clampedSpan,
        endMs: a.anchorMs + (1 - leftFrac) * clampedSpan,
      };
    }
    case "fit":
      return { startMs: 0, endMs: Math.max(1000, a.durationMs) };
  }
}

interface TimelineCanvasProps {
  recording: Recording | null;
  events: RecordedEvent[];          // bufferRef.current passed by orchestrator
  bufferVersion: number;
  isRecording: boolean;
  laneMap: LaneMap;
  noteSpans: NoteSpan[];
  mappingRules: MidiMappingRule[];
  playheadMsRef: React.MutableRefObject<number>;
  onSeek: (ms: number) => void;
  audioPeaks: Array<{ min: number; max: number }> | null;
  audioLabel?: string;
  onAudioOffsetDelta?: (deltaPx: number, modifier: "none" | "shift" | "alt") => void;
}

export function TimelineCanvas(props: TimelineCanvasProps) {
  const {
    recording, events, bufferVersion, isRecording, laneMap, noteSpans, mappingRules,
    playheadMsRef, onSeek, audioPeaks, audioLabel, onAudioOffsetDelta,
  } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Hover state — kept outside of per-lane props so the card renders once globally.
  const [hover, setHover] = useState<{ payload: Parameters<typeof HoverCard>[0]["payload"]; x: number; y: number }>({
    payload: null, x: 0, y: 0,
  });

  const duration = Math.max(1000, recording?.durationMs ?? (isRecording ? Math.max(...events.map((e) => e.tRel), 1000) + 500 : 1000));

  const [view, dispatch] = useReducer(viewReducer, { startMs: 0, endMs: duration });

  // When duration grows during recording, keep the right edge anchored to "now" if tail-following.
  const tailFollowRef = useRef(true);
  useEffect(() => {
    if (!isRecording) return;
    if (!tailFollowRef.current) return;
    const latest = events.length > 0 ? events[events.length - 1].tRel : 0;
    const span = view.endMs - view.startMs;
    if (latest + 500 > view.endMs) {
      dispatch({ type: "set", startMs: latest + 500 - span, endMs: latest + 500 });
    }
  }, [bufferVersion, isRecording, events, view.endMs, view.startMs]);

  // On new recording loaded (id change), fit the view.
  const priorIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (recording && recording.id !== priorIdRef.current) {
      priorIdRef.current = recording.id;
      dispatch({ type: "fit", durationMs: recording.durationMs });
      tailFollowRef.current = true;
    }
  }, [recording]);

  // rAF: update playhead position.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = playheadElRef.current;
      const wrap = wrapRef.current;
      if (el && wrap) {
        const rect = wrap.getBoundingClientRect();
        const trackWidth = rect.width - LEFT_GUTTER;
        const span = view.endMs - view.startMs;
        const pct = (playheadMsRef.current - view.startMs) / span;
        el.style.left = `${LEFT_GUTTER + pct * trackWidth}px`;
        el.style.display = pct < 0 || pct > 1 ? "none" : "block";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view.startMs, view.endMs, playheadMsRef]);

  // Wheel: scroll / zoom
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left - LEFT_GUTTER;
      const trackWidth = rect.width - LEFT_GUTTER;
      if (trackWidth <= 0) return;
      const anchorMs = view.startMs + (x / trackWidth) * (view.endMs - view.startMs);
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      dispatch({ type: "zoom", anchorMs, factor });
      tailFollowRef.current = false;
    } else {
      const span = view.endMs - view.startMs;
      const delta = (e.deltaX || e.deltaY) / 500 * span;
      dispatch({ type: "scrollBy", deltaMs: delta });
      tailFollowRef.current = false;
    }
  };

  const toggleCollapsed = (device: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(device)) next.delete(device); else next.add(device);
      return next;
    });
  };

  const devices = recording?.devices ?? [];

  const jumpLive = () => {
    tailFollowRef.current = true;
    const latest = events.length > 0 ? events[events.length - 1].tRel : 0;
    const span = view.endMs - view.startMs;
    dispatch({ type: "set", startMs: latest + 500 - span, endMs: latest + 500 });
  };

  return (
    <div
      ref={wrapRef}
      onWheel={handleWheel}
      className="relative flex-1 min-h-0 bg-surface rounded-lg border border-white/5 overflow-y-auto"
    >
      <TimeRuler
        viewStartMs={view.startMs}
        viewEndMs={view.endMs}
        leftGutterPx={LEFT_GUTTER}
        onSeek={(ms) => { tailFollowRef.current = false; onSeek(ms); }}
      />

      <AudioLane
        peaks={audioPeaks}
        heightPx={38}
        label={audioLabel}
        leftGutterPx={LEFT_GUTTER}
        onOffsetDragDelta={onAudioOffsetDelta}
      />

      {devices.length === 0 && !isRecording && (
        <div className="p-6 text-xs text-gray-600 italic">
          {recording ? "No events in this recording." : "No recording loaded. Hit Record, or load an .oscrec file."}
        </div>
      )}

      {devices.map((device) => (
        <DeviceSection
          key={device}
          device={device}
          laneMap={laneMap}
          events={events}
          noteSpans={noteSpans}
          mappingRules={mappingRules}
          viewStartMs={view.startMs}
          viewEndMs={view.endMs}
          leftGutterPx={LEFT_GUTTER}
          collapsed={collapsed.has(device)}
          onToggleCollapsed={() => toggleCollapsed(device)}
          bufferVersion={bufferVersion}
          onHoverEvent={(evt, x, y) => setHover({ payload: evt ? { kind: "event", event: evt } : null, x, y })}
          onHoverSpan={(span, x, y) => setHover({ payload: span ? { kind: "span", span } : null, x, y })}
        />
      ))}

      {/* Playhead — position-absolute over the whole scrollable stack */}
      <div
        ref={playheadElRef}
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-orange-400/80"
        style={{ left: LEFT_GUTTER, zIndex: 10 }}
      >
        <div
          className="absolute -top-0.5 -left-1 w-2 h-1.5 bg-orange-400"
          style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
        />
      </div>

      {!tailFollowRef.current && isRecording && (
        <button
          onClick={jumpLive}
          className="absolute top-2 right-3 z-20 text-[10px] px-2 py-1 bg-accent/20 text-accent border border-accent/30 rounded"
        >
          Jump to live ↴
        </button>
      )}

      <HoverCard payload={hover.payload} clientX={hover.x} clientY={hover.y} />
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors. If you see "Set not iterable" type warnings, ensure `tsconfig.json` has `"target": "ES2020"` or higher (existing project uses a modern target; this shouldn't arise).

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/timeline-canvas.tsx
git commit -m "feat: add TimelineCanvas (viewport, scroll/zoom, playhead, hover, tail-follow)"
```

---

## Task 16: Create `TimelineToolbar` component

**Files:**
- Create: `src/components/timeline/timeline-toolbar.tsx`

- [ ] **Step 1: Write the file**

Create `src/components/timeline/timeline-toolbar.tsx`:

```typescript
"use client";

import { motion } from "framer-motion";
import type { RecorderState } from "@/lib/types";
import { formatTime } from "@/lib/timeline-util";

interface TimelineToolbarProps {
  recorderState: RecorderState;
  hasRecording: boolean;
  isPlaying: boolean;
  playheadMs: number;
  durationMs: number;
  audioOffsetMs: number;
  audioLoaded: boolean;
  onRecord: () => void;
  onStop: () => void;
  onPlay: () => void;
  onPause: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onLoad: () => void;
  onLoadAudio: () => void;
  onUnloadAudio: () => void;
  onOffsetChange: (ms: number) => void;
}

export function TimelineToolbar(props: TimelineToolbarProps) {
  const {
    recorderState, hasRecording, isPlaying, playheadMs, durationMs,
    audioOffsetMs, audioLoaded,
    onRecord, onStop, onPlay, onPause,
    onSave, onSaveAs, onLoad, onLoadAudio, onUnloadAudio, onOffsetChange,
  } = props;

  const canPlay = hasRecording || audioLoaded;
  const recording = recorderState === "recording";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={recording ? onStop : onRecord}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
          recording
            ? "bg-red-500/30 text-red-200 border-red-500/50"
            : "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
        }`}
      >
        {recording ? "■ Stop" : "● Record"}
      </motion.button>

      <button
        onClick={isPlaying ? onPause : onPlay}
        disabled={!canPlay || recording}
        className="px-3 py-1.5 rounded-lg text-sm bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {isPlaying ? "⏸ Pause" : "▶ Play"}
      </button>

      <span className="text-xs font-mono text-gray-400 px-2">
        {formatTime(playheadMs)} / {formatTime(durationMs)}
      </span>

      <div className="w-px h-5 bg-white/10 mx-1" />

      <button
        onClick={onSave}
        disabled={!hasRecording}
        className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:text-white hover:border-accent/40 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Save
      </button>
      <button
        onClick={onSaveAs}
        disabled={!hasRecording}
        className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:text-white hover:border-accent/40 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Save As…
      </button>
      <button
        onClick={onLoad}
        className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:text-white hover:border-accent/40"
      >
        Load…
      </button>

      <div className="w-px h-5 bg-white/10 mx-1" />

      {audioLoaded ? (
        <>
          <button
            onClick={onUnloadAudio}
            className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-400 hover:text-white hover:border-accent/40"
          >
            ♪ Remove audio
          </button>
          <span className="text-[10px] text-gray-500 font-mono">offset</span>
          <input
            type="number"
            step={0.001}
            value={(audioOffsetMs / 1000).toFixed(3)}
            onChange={(e) => {
              const s = parseFloat(e.target.value);
              if (!Number.isNaN(s)) onOffsetChange(Math.round(s * 1000));
            }}
            className="w-20 text-xs px-2 py-1 bg-surface-lighter border border-white/10 rounded focus:outline-none focus:border-accent/50 font-mono"
          />
          <span className="text-[10px] text-gray-500">s</span>
        </>
      ) : (
        <button
          onClick={onLoadAudio}
          className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-400 hover:text-white hover:border-accent/40"
        >
          ♪ Load audio…
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/timeline-toolbar.tsx
git commit -m "feat: add TimelineToolbar (record/play/save/load/audio/offset controls)"
```

---

## Task 17: Create `RecordingInfoPanel` component

**Files:**
- Create: `src/components/timeline/recording-info.tsx`

- [ ] **Step 1: Write the file**

Create `src/components/timeline/recording-info.tsx`:

```typescript
"use client";

import type { Recording, RecorderState } from "@/lib/types";
import { formatTime } from "@/lib/timeline-util";

interface RecordingInfoProps {
  recording: Recording | null;
  recorderState: RecorderState;
  hasUnsaved: boolean;
  onRename: (name: string) => void;
}

export function RecordingInfoPanel({ recording, recorderState, hasUnsaved, onRename }: RecordingInfoProps) {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <input
        type="text"
        value={recording?.name ?? ""}
        disabled={!recording}
        onChange={(e) => onRename(e.target.value)}
        placeholder={recording ? "" : "(no recording)"}
        className="bg-transparent border-b border-white/10 focus:border-accent/50 focus:outline-none text-sm text-gray-200 px-1 py-0.5 w-48 disabled:opacity-50"
      />
      <span>·</span>
      <span>
        {recording ? formatTime(recording.durationMs) : "–"}
      </span>
      <span>·</span>
      <span>
        {recording ? `${recording.events.length.toLocaleString()} events` : "–"}
      </span>
      <span>·</span>
      <span>
        {recorderState === "recording"
          ? "recording…"
          : hasUnsaved
          ? <span className="text-orange-400">● unsaved</span>
          : recording
          ? "saved"
          : "idle"}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/recording-info.tsx
git commit -m "feat: add RecordingInfoPanel (name/duration/event-count/status)"
```

---

## Task 18: Create `/timeline/page.tsx` orchestrator

**Files:**
- Create: `src/app/timeline/page.tsx`

This file wires all hooks and components together. It owns the confirm dialog for discard-on-new-record, orchestrates save/load flows, and passes the audio peaks + offset handlers down.

- [ ] **Step 1: Write the file**

Create `src/app/timeline/page.tsx`:

```typescript
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecorder } from "@/hooks/use-recorder";
import { useRecordingIO } from "@/hooks/use-recording-io";
import { useAudioSync } from "@/hooks/use-audio-sync";
import { useMidiConfig, useMidiControl } from "@/hooks/use-midi";
import { TimelineToolbar } from "@/components/timeline/timeline-toolbar";
import { TimelineCanvas } from "@/components/timeline/timeline-canvas";
import { RecordingInfoPanel } from "@/components/timeline/recording-info";
import { buildLaneMap, pairNoteSpans } from "@/lib/timeline-util";
import type { LaneMap, MidiMappingRule, NoteSpan } from "@/lib/types";

const LEFT_GUTTER = 140;

export default function TimelinePage() {
  const { running: bridgeRunning } = useMidiControl();
  const { rules } = useMidiConfig();
  const rulesRef = useRef<MidiMappingRule[]>(rules);
  rulesRef.current = rules;

  const recorder = useRecorder({
    getMappingRulesSnapshot: () => rulesRef.current,
  });

  const io = useRecordingIO();

  const durationMs = recorder.recording?.durationMs ?? (recorder.state === "recording"
    ? Math.max(
        ...(recorder.bufferRef.current.length > 0
          ? [recorder.bufferRef.current[recorder.bufferRef.current.length - 1].tRel + 500]
          : [1000])
      )
    : 1000);

  const [playheadDisplayMs, setPlayheadDisplayMs] = useState(0);

  const audio = useAudioSync({
    durationMs,
    onPlayheadChange: setPlayheadDisplayMs,
  });

  const [confirmDiscard, setConfirmDiscard] = useState<null | (() => void)>(null);
  const [saveSuggestedPath, setSaveSuggestedPath] = useState<string | null>(null);
  const [canvasWidthPx, setCanvasWidthPx] = useState(800);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 800;
      setCanvasWidthPx(Math.max(300, Math.floor(w) - LEFT_GUTTER));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Recompute lane map + note spans when buffer changes or the recording changes.
  // During recording, rebuild incrementally by re-running over fresh indices (cheap because
  // pushing indices to Map.get(key).eventIndices is O(1); we re-run the whole walk for simplicity).
  const laneMap: LaneMap = useMemo(
    () => buildLaneMap(recorder.bufferRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recorder.bufferVersion, recorder.recording?.id]
  );

  const noteSpans: NoteSpan[] = useMemo(
    () => {
      const fallback = recorder.recording?.durationMs ?? (
        recorder.bufferRef.current.length > 0
          ? recorder.bufferRef.current[recorder.bufferRef.current.length - 1].tRel
          : 0
      );
      return pairNoteSpans(recorder.bufferRef.current, fallback);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recorder.bufferVersion, recorder.recording?.id]
  );

  const audioPeaks = audio.getPeaks(canvasWidthPx);

  const startRecording = useCallback(() => {
    if (!bridgeRunning) {
      alert("Start the MIDI bridge first (MIDI tab).");
      return;
    }
    if (recorder.hasUnsaved && recorder.recording) {
      setConfirmDiscard(() => () => {
        recorder.start();
        setConfirmDiscard(null);
      });
      return;
    }
    recorder.start();
  }, [bridgeRunning, recorder]);

  const stopRecording = useCallback(() => {
    recorder.stop();
  }, [recorder]);

  const handleSave = useCallback(async () => {
    if (!recorder.recording) return;
    const savedPath = await io.save(recorder.recording, saveSuggestedPath ?? undefined);
    if (savedPath) {
      setSaveSuggestedPath(savedPath);
      recorder.markSaved();
    }
  }, [io, recorder, saveSuggestedPath]);

  const handleSaveAs = useCallback(async () => {
    if (!recorder.recording) return;
    const savedPath = await io.saveAs(recorder.recording);
    if (savedPath) {
      setSaveSuggestedPath(savedPath);
      recorder.markSaved();
    }
  }, [io, recorder]);

  const handleLoad = useCallback(async () => {
    const applyLoad = async () => {
      const res = await io.load();
      if (!res) return;
      recorder.setLoaded(res.recording);
      setSaveSuggestedPath(res.path);
      audio.unloadAudio();

      if (res.recording.audio) {
        const bytes = await io.readAudioBytes(res.recording.audio.filePath);
        if (bytes) {
          await audio.loadBytes(res.recording.audio.filePath, bytes.bytes, bytes.mimeType, res.recording.audio.offsetMs);
        } else {
          alert(`Audio file not found at:\n${res.recording.audio.filePath}\n\nYou can attach a new audio file after loading.`);
        }
      }
    };
    if (recorder.hasUnsaved && recorder.recording) {
      setConfirmDiscard(() => () => {
        applyLoad();
        setConfirmDiscard(null);
      });
      return;
    }
    applyLoad();
  }, [io, recorder, audio]);

  const handleLoadAudio = useCallback(async () => {
    const path = await io.pickAudio();
    if (!path) return;
    const bytes = await io.readAudioBytes(path);
    if (!bytes) return;
    await audio.loadBytes(path, bytes.bytes, bytes.mimeType, audio.audio.offsetMs);
    if (recorder.recording) {
      recorder.patchRecording({ audio: { filePath: path, offsetMs: audio.audio.offsetMs } });
    }
  }, [io, audio, recorder]);

  const handleUnloadAudio = useCallback(() => {
    audio.unloadAudio();
    if (recorder.recording) recorder.patchRecording({ audio: undefined });
  }, [audio, recorder]);

  const handleOffsetChange = useCallback(
    (ms: number) => {
      audio.setOffset(ms);
      if (recorder.recording?.audio) {
        recorder.patchRecording({
          audio: { filePath: recorder.recording.audio.filePath, offsetMs: ms },
        });
      }
    },
    [audio, recorder]
  );

  const handleOffsetDragDelta = useCallback(
    (deltaPx: number, modifier: "none" | "shift" | "alt") => {
      // Convert pixel delta to ms delta using current viewport span and track width.
      const canvas = canvasWidthPx;
      // We don't have a direct viewport ref here; approximate with recording duration.
      const span = Math.max(1000, durationMs);
      let msDelta = (deltaPx / canvas) * span;
      if (modifier === "shift") msDelta = Math.round(msDelta / 10) * 10;
      if (modifier === "alt") msDelta = Math.round(msDelta / 100) * 100;
      handleOffsetChange(audio.audio.offsetMs + msDelta);
    },
    [canvasWidthPx, durationMs, audio.audio.offsetMs, handleOffsetChange]
  );

  const handleSeek = useCallback((ms: number) => {
    audio.seek(ms);
    setPlayheadDisplayMs(ms);
  }, [audio]);

  const handleRename = useCallback(
    (name: string) => {
      if (recorder.recording) recorder.patchRecording({ name });
    },
    [recorder]
  );

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold">Timeline</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {bridgeRunning ? "Bridge is running — ready to record." : "Bridge is stopped — start it on the MIDI tab to record."}
          </p>
        </div>
        <RecordingInfoPanel
          recording={recorder.recording}
          recorderState={recorder.state}
          hasUnsaved={recorder.hasUnsaved}
          onRename={handleRename}
        />
      </div>

      {/* Toolbar */}
      <TimelineToolbar
        recorderState={recorder.state}
        hasRecording={!!recorder.recording || recorder.state === "recording"}
        isPlaying={audio.isPlaying}
        playheadMs={playheadDisplayMs}
        durationMs={durationMs}
        audioOffsetMs={audio.audio.offsetMs}
        audioLoaded={!!audio.audio.src}
        onRecord={startRecording}
        onStop={stopRecording}
        onPlay={audio.play}
        onPause={audio.pause}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onLoad={handleLoad}
        onLoadAudio={handleLoadAudio}
        onUnloadAudio={handleUnloadAudio}
        onOffsetChange={handleOffsetChange}
      />

      {io.lastError && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-1.5">
          <span>{io.lastError}</span>
          <button onClick={io.clearError} className="ml-auto text-red-300 hover:text-white">✕</button>
        </div>
      )}

      {/* Canvas */}
      <div ref={canvasWrapRef} className="flex-1 min-h-0 flex flex-col">
        <TimelineCanvas
          recording={recorder.recording}
          events={recorder.bufferRef.current}
          bufferVersion={recorder.bufferVersion}
          isRecording={recorder.state === "recording"}
          laneMap={laneMap}
          noteSpans={noteSpans}
          mappingRules={rules}
          playheadMsRef={audio.playheadMsRef}
          onSeek={handleSeek}
          audioPeaks={audioPeaks}
          audioLabel={audio.audio.filePath?.split("/").pop()}
          onAudioOffsetDelta={handleOffsetDragDelta}
        />
      </div>

      {/* Confirm dialog */}
      {confirmDiscard && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-light border border-white/10 rounded-lg p-5 max-w-sm">
            <h3 className="text-sm font-semibold mb-2">Discard current take?</h3>
            <p className="text-xs text-gray-500 mb-4">You have unsaved MIDI captured in the current take. Continuing will replace it.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDiscard(null)}
                className="px-3 py-1.5 text-xs border border-white/10 text-gray-300 hover:text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDiscard()}
                className="px-3 py-1.5 text-xs bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 rounded"
              >
                Discard & continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "feat: add /timeline route wiring recorder, audio-sync, and canvas"
```

---

## Task 19: Add Timeline to sidebar

**Files:**
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Insert the Timeline nav item**

In `src/components/sidebar.tsx`, the `navItems` array currently reads:

```typescript
const navItems = [
  { href: "/listener", label: "Listener", icon: "📡" },
  { href: "/sender", label: "Sender", icon: "📤" },
  { href: "/deck", label: "Deck", icon: "🎛" },
  { href: "/midi", label: "MIDI", icon: "🎹" },
  { href: "/diagnostics", label: "Diagnostics", icon: "🔬" },
];
```

Change it to:

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

- [ ] **Step 2: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat: add Timeline nav item to sidebar"
```

---

## Task 20: End-to-end manual verification

**Files:** none (verification only)

This task validates the full feature. Work through every check. If anything fails, open a new branch task to fix and don't mark this complete until all pass.

- [ ] **Step 1: Start the app**

```bash
pnpm electron:dev
```

Expected: app opens, Timeline appears in sidebar between MIDI and Diagnostics.

- [ ] **Step 2: Basic recording flow (without audio)**

1. Connect a MIDI controller with at least notes + one CC.
2. Go to `/midi`, start the bridge.
3. Switch to `/timeline`.
4. Click **● Record**. The button should flip to "■ Stop" (red highlight).
5. Play some notes, twist a CC. Verify the timeline populates in real time: notes appear as blue bars in the notes lane, CC movement appears as a green curve.
6. Click **■ Stop**. Button flips back. Status indicator reads "● unsaved" (orange).
7. Verify: the device shown in the header matches the controller's name; `event count` > 0; duration matches roughly how long you recorded.

- [ ] **Step 3: Scrub and hover**

1. Click anywhere on the time ruler. Playhead jumps there.
2. Click **▶ Play**. Playhead moves across the timeline.
3. Hover a note bar. A tooltip appears showing time, device, `ch/#/vel`.
4. Hover a CC curve. Tooltip shows `CC ch/# → <value>` and the OSC output.
5. Click **⏸ Pause**. Playhead stops.

- [ ] **Step 4: Accordion behavior**

1. Click the device header. Device lanes collapse to a summary bar showing event density.
2. Click again to expand.
3. If you have multiple devices connected, repeat with both — each collapses independently.

- [ ] **Step 5: Zoom and scroll**

1. Hold **Cmd** (macOS) or **Ctrl** (Windows/Linux) and scroll the mouse wheel over the timeline. The view zooms around the cursor.
2. Scroll without the modifier. The view pans horizontally.
3. Start a new recording (confirm the discard dialog) and while it's recording, scroll left — verify "Jump to live ↴" button appears at the top right. Click it to resume tail-follow.

- [ ] **Step 6: Save and reload**

1. Rename the take via the name input ("Test 1").
2. Click **Save**. A save dialog opens; accept the suggested path.
3. Status changes to "saved" (no orange dot).
4. Close the app entirely.
5. Re-open: `pnpm electron:dev`, go to `/timeline`.
6. Click **Load…**, pick the saved file.
7. Verify: same device list, same event count, same duration. Hover a few events to confirm fidelity.

- [ ] **Step 7: Audio load + sync**

1. Prepare a short audio file (~30–60s) in each supported format: WAV, MP3, OGG, FLAC, M4A. (You can transcode a single WAV with `ffmpeg` if needed.)
2. With a recording loaded, click **♪ Load audio…**. Pick the WAV.
3. Waveform renders in the audio lane. File name shown as label.
4. Click Play. Audio plays; playhead moves in sync.
5. Change the offset via the numeric input: `1.000` seconds. Verify the waveform shifts and playback timing adjusts (audio starts ~1s later relative to MIDI).
6. Drag the audio lane horizontally to adjust offset. Repeat with Shift held (10ms steps) and Alt held (100ms steps).
7. Repeat Step 2 with MP3, OGG, FLAC, M4A. Each should render a waveform and play back.

- [ ] **Step 8: Audio persistence in saved file**

1. With audio loaded and offset set to e.g. 0.500s, Save As to a new file.
2. Reload the app. Open the file.
3. Verify: audio auto-loads at the same offset. If you moved the audio file on disk, a toast says "Audio file not found" — re-load via the toolbar.

- [ ] **Step 9: Corrupt file handling**

1. Make a copy of a saved `.oscrec` file.
2. Edit the JSON: change `"version": 1` to `"version": 2`. Load it — expect a toast: `Unsupported recording version: 2 (expected 1)`.
3. Break the JSON (delete a closing brace). Load — expect `Could not parse recording file: ...`.
4. Remove the `events` field. Load — expect `Recording.events must be an array`.

- [ ] **Step 10: Bridge stopped during recording**

1. Start bridge on `/midi`.
2. Start Record on `/timeline`.
3. Play a few notes.
4. Switch to `/midi`, stop the bridge. Wait 5 seconds.
5. Switch back to `/timeline` — recording is still active, no new events coming in.
6. Start bridge again, play more notes.
7. Stop recording. Save.
8. Verify the saved file has both sequences with a ~5s gap between them.

- [ ] **Step 11: Discard-on-new-record**

1. With an unsaved take, click Record. Verify the "Discard current take?" dialog appears.
2. Cancel — existing take preserved.
3. Record again — this time confirm. New empty take begins.

- [ ] **Step 12: Long-recording smoke test**

1. Start Record. Wiggle a CC continuously for 5 minutes.
2. Stop. The take should have thousands of events but remain responsive:
   - Scrubbing with the ruler is smooth.
   - Zoom is smooth.
   - CC curve renders as a dense waveform-like curve (not individual visible events).
   - Save to disk; file loads back cleanly.

If any of the above is visibly janky (frames dropped during zoom), open a follow-up task to investigate rendering cost before shipping.

- [ ] **Step 13: Commit the verification log**

If all checks pass, no code changes are needed. If you made fixes during verification, commit them with descriptive messages as you go, then commit a final note:

```bash
git commit --allow-empty -m "chore: timeline feature passed end-to-end manual verification"
```

---

## Notes

**Known v1 limitations (by design, from spec):**

- Recording is discarded if the app closes mid-take. No auto-save.
- Multiple takes can't be held in memory simultaneously — new Record replaces the current take.
- Playback is visual only; no MIDI/OSC re-emit.
- No `.mid` import/export.
- No time-signature grid; timeline is seconds-based.
- Performance target is up to ~1 hour of busy MIDI. Longer recordings aren't blocked but aren't verified.

**If `AudioContext.decodeAudioData` rejects on some file:** Chromium/Electron supports WAV, MP3, OGG, FLAC, and M4A/AAC out of the box, but some exotic variants (e.g. ADPCM WAV) may fail. Surface the decode error to the user and move on — no silent fallback.

**Pitch lane value mapping:** pitch wheel is a 14-bit signed value. `eventValue()` returns -1..+1. `ContinuousLane` receives a `valueMapper` of `(v) => (v + 1) / 2` for pitch lanes. If you add another signed MIDI value in the future, use the same pattern.

**Channel vs poly aftertouch disambiguation:** the `MidiEvent` shape doesn't preserve the raw status byte, so `buildLaneMap` uses `m.data2 === 0` as a heuristic to distinguish channel aftertouch (one lane per channel) from poly aftertouch (one lane per note per channel). This matches what `MidiManager.parseMessage` produces: channel aftertouch sets `data2 = 0` because only `data1` carries pressure.

**esbuild electron entry list:** every new file under `electron/` must be added to the `electron:compile` script in `package.json`. If you forget, you'll see `Cannot find module` when the app starts.
