# Timeline Trigger Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Trigger Analyzer to the Timeline tab that scores every lane by rhythm / dynamic / melody metrics, surfaces redundant lane pairs, lets users tag lanes with persistent badges, and ranks everything in a right-hand sidebar.

**Architecture:** Analysis runs entirely in the renderer via a `useTriggerAnalysis` hook that chunks work in `requestIdleCallback` and memoizes on `(recording.id, bufferVersion)`. Results feed two surfaces: inline lane badges (auto + user) and a `<TriggersSidebar>` panel ranked by score. User badges persist on `Recording.badges` (optional field) and save with `.oscrec` files; the main-process validator accepts the new field without a version bump.

**Tech Stack:** Existing — React 19, Next.js, TypeScript, Electron, Tailwind 4, Framer Motion. No new runtime dependencies. Project convention is manual verification per task (no test framework); each task ends with `pnpm exec tsc --noEmit` and a commit.

---

## File Map

**Create:**
- `src/lib/trigger-analysis.ts` — pure analysis helpers (rhythm, dynamic, melody, redundancy)
- `src/hooks/use-trigger-analysis.ts` — memoized analysis runner with idle-callback chunking
- `src/components/timeline/pitch-sparkline.tsx` — 32-point SVG sparkline for notes lanes
- `src/components/timeline/badge-editor-modal.tsx` — create/edit user badge
- `src/components/timeline/lane-badges.tsx` — auto + user badges in lane gutter
- `src/components/timeline/triggers-sidebar.tsx` — right-hand panel with 5 ranked sections

**Modify:**
- `src/lib/types.ts` — add `LaneBadge`, `LaneAnalysis`, `RedundancyPair`, optional `badges?` on `Recording`
- `electron/recording-store.ts` — validator accepts optional `badges` array
- `src/components/timeline/notes-lane.tsx` — accept analysis, badges, spans; render `LaneBadges` + sparkline
- `src/components/timeline/continuous-lane.tsx` — accept analysis, badges; render `LaneBadges`
- `src/components/timeline/program-lane.tsx` — accept analysis, badges; render `LaneBadges`
- `src/components/timeline/device-section.tsx` — thread analysis + badges + flash key to each lane
- `src/components/timeline/timeline-canvas.tsx` — sidebar open/close state, lane-flash state, layout
- `src/components/timeline/timeline-toolbar.tsx` — "📊 Triggers" toggle
- `src/app/timeline/page.tsx` — wire `useTriggerAnalysis` + badge CRUD

---

## Task 1: Add shared types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Append new types to the bottom of `src/lib/types.ts`**

```typescript
// --- Trigger Analyzer types ---

/** A user-applied tag on a single lane within a recording. */
export interface LaneBadge {
  id: string;        // uuid
  laneKey: string;   // matches laneKeyString output
  label: string;     // free text, ≤24 chars (clamped on save)
  color?: string;    // optional CSS color; hash-based fallback at render time
}

/** Computed analysis output for one lane. */
export interface LaneAnalysis {
  laneKey: string;
  eventCount: number;
  eventsPerSec: number;
  rhythmScore: number;                 // 0..1
  dynamicScore: number;                // 0..1
  valueRange: [number, number] | null;
  ioiHistogram: number[];              // 20 log-spaced buckets (20ms..10s)
  isDead: boolean;

  // Notes-lane only (undefined for CC/pitch/AT/program)
  melodyScore?: number;                // 0..1
  pitchRange?: [number, number];
  pitchContour?: number[];             // 32-bucket mean pitch per chunk
}

/** A pair of lanes flagged as redundant. */
export interface RedundancyPair {
  laneKeyA: string;
  laneKeyB: string;
  similarity: number;                  // 0..1
  kind: "onset" | "value";
}
```

- [ ] **Step 2: Extend the `Recording` interface with an optional `badges` field**

Find the existing `Recording` interface in the same file. Add `badges?: LaneBadge[];` at the end of its fields, directly before the closing brace:

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
  badges?: LaneBadge[];
}
```

Leave every other field untouched.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: no output (zero errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add LaneBadge, LaneAnalysis, RedundancyPair, and optional Recording.badges"
```

---

## Task 2: Extend recording validator for badges

**Files:**
- Modify: `electron/recording-store.ts`

- [ ] **Step 1: Extend `validateRecording` to accept the optional `badges` array**

Locate `function validateRecording(v: unknown): Recording` near the bottom of `electron/recording-store.ts`. Before the final `return r as Recording;`, add badge validation:

```typescript
  if (r.badges !== undefined) {
    if (!Array.isArray(r.badges)) throw new Error("Recording.badges must be an array");
    for (let i = 0; i < r.badges.length; i++) {
      const b = r.badges[i] as Partial<{ id: string; laneKey: string; label: string; color: string }>;
      if (typeof b.id !== "string") throw new Error(`Recording.badges[${i}].id must be a string`);
      if (typeof b.laneKey !== "string") throw new Error(`Recording.badges[${i}].laneKey must be a string`);
      if (typeof b.label !== "string") throw new Error(`Recording.badges[${i}].label must be a string`);
      if (b.color !== undefined && typeof b.color !== "string") {
        throw new Error(`Recording.badges[${i}].color must be a string when present`);
      }
    }
  }
```

Do not touch anything else in the file. `writeStreamed` already serializes `{ ...rest, events: [...] }`, so `badges` travels with `rest` automatically.

- [ ] **Step 2: Recompile electron main**

```bash
pnpm electron:compile
```

Expected: clean output, no errors.

- [ ] **Step 3: Typecheck the renderer**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add electron/recording-store.ts
git commit -m "feat: validator accepts optional Recording.badges array"
```

---

## Task 3: Create `trigger-analysis.ts` pure module

**Files:**
- Create: `src/lib/trigger-analysis.ts`

- [ ] **Step 1: Write the file**

Create `src/lib/trigger-analysis.ts`:

```typescript
import type {
  LaneAnalysis,
  LaneKey,
  LaneMap,
  NoteSpan,
  RecordedEvent,
  Recording,
  RedundancyPair,
} from "@/lib/types";
import { laneKeyString } from "@/lib/types";
import { eventValue } from "@/lib/timeline-util";

const IOI_BUCKET_COUNT = 20;
const IOI_MIN_MS = 20;
const IOI_MAX_MS = 10_000;
const REDUNDANCY_BIN_MS = 50;
const REDUNDANCY_THRESHOLD = 0.8;
const REDUNDANCY_CAP = 20;
const PITCH_CONTOUR_BUCKETS = 32;

/** Main entry point. Runs the whole analysis synchronously. Chunking is caller's job. */
export function analyzeRecording(
  rec: Recording,
  laneMap: LaneMap,
  noteSpans: NoteSpan[]
): { analyses: LaneAnalysis[]; pairs: RedundancyPair[] } {
  const durationMs = Math.max(1, rec.durationMs);
  const analyses: LaneAnalysis[] = [];

  for (const entry of laneMap.values()) {
    analyses.push(analyzeLane(entry.key, entry.eventIndices, rec.events, noteSpans, durationMs));
  }

  const pairs = durationMs >= 1000
    ? findRedundantPairs(analyses, laneMap, rec.events, durationMs)
    : [];

  return { analyses, pairs };
}

function analyzeLane(
  key: LaneKey,
  eventIndices: number[],
  events: RecordedEvent[],
  noteSpans: NoteSpan[],
  durationMs: number
): LaneAnalysis {
  const laneKey = laneKeyString(key);
  const eventCount = eventIndices.length;
  const durationSec = durationMs / 1000;
  const eventsPerSec = eventCount / durationSec;
  const isDead = eventCount < 3 || eventsPerSec < 0.05;

  // Onset times: for notes lane, use note-on events only (from noteSpans); for others, all events.
  let onsets: number[];
  if (key.kind === "notes") {
    onsets = noteSpans
      .filter((s) => s.device === key.device)
      .map((s) => s.tStart)
      .sort((a, b) => a - b);
  } else {
    onsets = eventIndices.map((i) => events[i].tRel);
  }

  const iois = computeIOIs(onsets);
  const ioiHistogram = bucketIOIs(iois);
  const rhythmScore = onsets.length < 4 ? 0 : rhythmScoreFromHistogram(ioiHistogram);

  const values = eventIndices.map((i) => {
    const v = eventValue(events[i]);
    // eventValue returns -1..1 for pitch; normalize to 0..1 here.
    return events[i].midi.type === "pitch" ? (v + 1) / 2 : v;
  });

  const { stdDev, min, max } = values.length > 0
    ? stats(values)
    : { stdDev: 0, min: 0, max: 0 };

  const dynamicScore = Math.max(0, Math.min(1, stdDev / 0.25));
  const valueRange: [number, number] | null = values.length > 0 ? [min, max] : null;

  const result: LaneAnalysis = {
    laneKey,
    eventCount,
    eventsPerSec,
    rhythmScore,
    dynamicScore,
    valueRange,
    ioiHistogram,
    isDead,
  };

  if (key.kind === "notes") {
    const deviceSpans = noteSpans.filter((s) => s.device === key.device);
    if (deviceSpans.length > 0) {
      const { score, pitchRange, pitchContour } = analyzeMelody(deviceSpans, durationMs);
      result.melodyScore = score;
      result.pitchRange = pitchRange;
      result.pitchContour = pitchContour;
    } else {
      result.melodyScore = 0;
    }
  }

  return result;
}

function computeIOIs(onsets: number[]): number[] {
  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i++) iois.push(onsets[i] - onsets[i - 1]);
  return iois;
}

function bucketIOIs(iois: number[]): number[] {
  const buckets = new Array<number>(IOI_BUCKET_COUNT).fill(0);
  if (iois.length === 0) return buckets;
  const logMin = Math.log(IOI_MIN_MS);
  const logMax = Math.log(IOI_MAX_MS);
  for (const ioi of iois) {
    const clamped = Math.max(IOI_MIN_MS, Math.min(IOI_MAX_MS, ioi));
    const pos = (Math.log(clamped) - logMin) / (logMax - logMin);
    const idx = Math.min(IOI_BUCKET_COUNT - 1, Math.floor(pos * IOI_BUCKET_COUNT));
    buckets[idx]++;
  }
  return buckets;
}

function rhythmScoreFromHistogram(hist: number[]): number {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let entropy = 0;
  for (const c of hist) {
    if (c === 0) continue;
    const p = c / total;
    entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(hist.length);
  return Math.max(0, Math.min(1, 1 - entropy / maxEntropy));
}

function stats(values: number[]): { stdDev: number; min: number; max: number } {
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / values.length;
  let variance = 0;
  for (const v of values) variance += (v - mean) ** 2;
  variance /= values.length;
  return { stdDev: Math.sqrt(variance), min, max };
}

function analyzeMelody(
  deviceSpans: NoteSpan[],
  durationMs: number
): { score: number; pitchRange: [number, number]; pitchContour: number[] } {
  const events: Array<{ t: number; delta: 1 | -1 }> = [];
  for (const s of deviceSpans) {
    events.push({ t: s.tStart, delta: 1 });
    events.push({ t: s.tEnd, delta: -1 });
  }
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);

  let active = 0;
  let lastT = events.length > 0 ? events[0].t : 0;
  let monoTime = 0;
  let activeSpan = 0;
  for (const e of events) {
    const dt = e.t - lastT;
    if (active > 0) activeSpan += dt;
    if (active <= 1) monoTime += dt;
    active += e.delta;
    lastT = e.t;
  }

  const monophonyRatio = activeSpan > 0 ? monoTime / activeSpan : 0;

  // Pitch variability
  const pitches = deviceSpans.map((s) => s.pitch);
  const { stdDev } = stats(pitches);
  const pitchVariability = Math.min(1, stdDev / 12);

  const score = Math.max(0, Math.min(1, monophonyRatio * pitchVariability));

  let pitchMin = Infinity, pitchMax = -Infinity;
  for (const p of pitches) {
    if (p < pitchMin) pitchMin = p;
    if (p > pitchMax) pitchMax = p;
  }
  const pitchRange: [number, number] = [pitchMin, pitchMax];

  const pitchContour = buildPitchContour(deviceSpans, durationMs, PITCH_CONTOUR_BUCKETS);

  return { score, pitchRange, pitchContour };
}

function buildPitchContour(
  spans: NoteSpan[],
  durationMs: number,
  bucketCount: number
): number[] {
  const out = new Array<number>(bucketCount).fill(NaN);
  const bucketDur = durationMs / bucketCount;
  for (let i = 0; i < bucketCount; i++) {
    const t0 = i * bucketDur;
    const t1 = t0 + bucketDur;
    let sum = 0, count = 0;
    for (const s of spans) {
      if (s.tEnd < t0 || s.tStart >= t1) continue;
      sum += s.pitch;
      count++;
    }
    if (count > 0) out[i] = sum / count;
  }
  // Forward-fill NaN buckets from the last known value, then back-fill from the first.
  let lastKnown = NaN;
  for (let i = 0; i < bucketCount; i++) {
    if (!Number.isNaN(out[i])) lastKnown = out[i];
    else out[i] = lastKnown;
  }
  let firstKnown = NaN;
  for (let i = bucketCount - 1; i >= 0; i--) {
    if (!Number.isNaN(out[i])) firstKnown = out[i];
    else out[i] = firstKnown;
  }
  for (let i = 0; i < bucketCount; i++) {
    if (Number.isNaN(out[i])) out[i] = 0;
  }
  return out;
}

// --- Redundancy ---

function findRedundantPairs(
  analyses: LaneAnalysis[],
  laneMap: LaneMap,
  events: RecordedEvent[],
  durationMs: number
): RedundancyPair[] {
  const binCount = Math.ceil(durationMs / REDUNDANCY_BIN_MS);
  if (binCount < 4) return [];

  // Build onset + value vectors per lane, keyed by laneKey.
  type LaneVectors = { onsets: Uint8Array; values: Float32Array | null; kind: LaneKey["kind"]; laneKey: string };
  const vecs: LaneVectors[] = [];

  for (const entry of laneMap.values()) {
    if (entry.eventIndices.length === 0) continue;
    const laneKey = laneKeyString(entry.key);
    const onsets = new Uint8Array(binCount);
    let values: Float32Array | null = null;
    const valueBearing = entry.key.kind === "cc" || entry.key.kind === "pitch" || entry.key.kind === "aftertouch";
    if (valueBearing) values = new Float32Array(binCount);

    let lastValue = 0;
    let vi = 0;
    for (let b = 0; b < binCount; b++) {
      const t0 = b * REDUNDANCY_BIN_MS;
      const t1 = t0 + REDUNDANCY_BIN_MS;
      let hit = 0;
      while (vi < entry.eventIndices.length && events[entry.eventIndices[vi]].tRel < t1) {
        if (events[entry.eventIndices[vi]].tRel >= t0) hit = 1;
        if (values) {
          let v = eventValue(events[entry.eventIndices[vi]]);
          if (entry.key.kind === "pitch") v = (v + 1) / 2;
          lastValue = v;
        }
        vi++;
      }
      onsets[b] = hit;
      if (values) values[b] = lastValue;
    }

    vecs.push({ onsets, values, kind: entry.key.kind, laneKey });
  }

  const pairs: RedundancyPair[] = [];

  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      if (vecs[i].kind !== vecs[j].kind) continue;
      const onsetR = pearsonBinary(vecs[i].onsets, vecs[j].onsets);
      let best = onsetR;
      let bestKind: "onset" | "value" = "onset";
      if (vecs[i].values && vecs[j].values) {
        const valueR = pearsonFloat(vecs[i].values!, vecs[j].values!);
        if (valueR > best) { best = valueR; bestKind = "value"; }
      }
      if (best >= REDUNDANCY_THRESHOLD) {
        pairs.push({ laneKeyA: vecs[i].laneKey, laneKeyB: vecs[j].laneKey, similarity: best, kind: bestKind });
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity);
  return pairs.slice(0, REDUNDANCY_CAP);
}

function pearsonBinary(a: Uint8Array, b: Uint8Array): number {
  const n = a.length;
  if (n === 0) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

function pearsonFloat(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  if (n === 0) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit` — expect zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trigger-analysis.ts
git commit -m "feat: add trigger-analysis pure module (rhythm, dynamic, melody, redundancy)"
```

---

## Task 4: Create `use-trigger-analysis` hook

**Files:**
- Create: `src/hooks/use-trigger-analysis.ts`

- [ ] **Step 1: Write the file**

Create `src/hooks/use-trigger-analysis.ts`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import type { LaneAnalysis, LaneMap, NoteSpan, Recording, RedundancyPair } from "@/lib/types";
import { analyzeRecording } from "@/lib/trigger-analysis";

interface Result {
  analyses: LaneAnalysis[] | null;
  pairs: RedundancyPair[] | null;
  ready: boolean;
  error: string | null;
}

interface Args {
  recording: Recording | null;
  bufferVersion: number;
  laneMap: LaneMap;
  noteSpans: NoteSpan[];
}

/**
 * Runs trigger analysis in the background, memoized on (recording.id, bufferVersion).
 * Yields between outer-loop iterations so the main thread stays responsive even on long takes.
 */
export function useTriggerAnalysis({ recording, bufferVersion, laneMap, noteSpans }: Args): Result {
  const [result, setResult] = useState<Result>({ analyses: null, pairs: null, ready: false, error: null });
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    if (!recording || recording.events.length === 0) {
      setResult({ analyses: [], pairs: [], ready: true, error: null });
      return;
    }

    setResult((prev) => ({ ...prev, ready: false, error: null }));
    const token = { cancelled: false };
    cancelRef.current = token;

    const run = async () => {
      try {
        await idleYield();
        if (token.cancelled) return;
        const { analyses, pairs } = analyzeRecording(recording, laneMap, noteSpans);
        if (token.cancelled) return;
        setResult({ analyses, pairs, ready: true, error: null });
      } catch (err) {
        if (token.cancelled) return;
        setResult({ analyses: null, pairs: null, ready: true, error: (err as Error).message });
      }
    };
    run();

    return () => { token.cancelled = true; };
  }, [recording, bufferVersion, laneMap, noteSpans]);

  return result;
}

function idleYield(): Promise<void> {
  return new Promise<void>((resolve) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === "function") {
      ric(() => resolve(), { timeout: 3000 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit` — expect zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-trigger-analysis.ts
git commit -m "feat: add useTriggerAnalysis hook with idle-callback scheduling"
```

---

## Task 5: Create `pitch-sparkline` component

**Files:**
- Create: `src/components/timeline/pitch-sparkline.tsx`

- [ ] **Step 1: Write the file**

```typescript
"use client";

interface PitchSparklineProps {
  contour: number[];           // 32 values; pitch means per bucket
  pitchRange: [number, number]; // MIDI note min/max
  width?: number;
  height?: number;
}

export function PitchSparkline({ contour, pitchRange, width = 80, height = 16 }: PitchSparklineProps) {
  if (contour.length < 2) return null;
  const [pMin, pMax] = pitchRange;
  const span = Math.max(1, pMax - pMin);
  const n = contour.length;

  const points: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * width;
    const y = (1 - (contour[i] - pMin) / span) * height;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="rgba(255, 174, 215, 0.7)"
        strokeWidth={1}
      />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit` — expect zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/pitch-sparkline.tsx
git commit -m "feat: add PitchSparkline for melody contour in notes lane gutter"
```

---

## Task 6: Create `badge-editor-modal` component

**Files:**
- Create: `src/components/timeline/badge-editor-modal.tsx`

- [ ] **Step 1: Write the file**

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import type { LaneBadge } from "@/lib/types";

const SWATCHES: Array<{ name: string; value: string | undefined }> = [
  { name: "auto", value: undefined },
  { name: "blue", value: "#4a7bff" },
  { name: "green", value: "#7dd87d" },
  { name: "pink", value: "#ff6fa3" },
  { name: "orange", value: "#ffb84d" },
  { name: "purple", value: "#b48bff" },
  { name: "gray", value: "#888" },
];

interface BadgeEditorModalProps {
  /** null = create new; existing LaneBadge = edit */
  badge: LaneBadge | null;
  laneKey: string;
  existingLabels: string[];  // for autocomplete
  onSave: (next: LaneBadge) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function BadgeEditorModal({ badge, laneKey, existingLabels, onSave, onDelete, onClose }: BadgeEditorModalProps) {
  const [label, setLabel] = useState(badge?.label ?? "");
  const [color, setColor] = useState<string | undefined>(badge?.color);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const suggestions = existingLabels
    .filter((l) => l.toLowerCase().startsWith(label.toLowerCase()) && l !== label)
    .slice(0, 5);

  const handleSave = () => {
    const trimmed = label.trim().slice(0, 24);
    if (!trimmed) return;
    onSave({
      id: badge?.id ?? crypto.randomUUID(),
      laneKey,
      label: trimmed,
      color,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface-light border border-white/10 rounded-lg p-4 w-72 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-3">{badge ? "Edit badge" : "Tag this lane"}</h3>

        <label className="block text-[10px] text-gray-500 mb-1">Label</label>
        <input
          ref={inputRef}
          type="text"
          value={label}
          maxLength={24}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") onClose();
          }}
          placeholder="kick, main fader, etc."
          className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-sm focus:outline-none focus:border-accent/50"
        />

        {suggestions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => setLabel(s)}
                className="text-[10px] px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded text-gray-400"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <label className="block text-[10px] text-gray-500 mt-3 mb-1">Color</label>
        <div className="flex gap-1.5">
          {SWATCHES.map((s) => (
            <button
              key={s.name}
              onClick={() => setColor(s.value)}
              className={`w-6 h-6 rounded border transition-transform ${
                (s.value ?? null) === (color ?? null) ? "border-white scale-110" : "border-white/20"
              }`}
              style={{ background: s.value ?? "transparent" }}
              title={s.name}
            >
              {s.value === undefined && <span className="text-[10px] text-gray-500">a</span>}
            </button>
          ))}
        </div>

        <div className="flex justify-between items-center mt-4">
          {onDelete ? (
            <button
              onClick={onDelete}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Delete
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-xs border border-white/10 text-gray-300 hover:text-white rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!label.trim()}
              className="px-3 py-1 text-xs bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit` — expect zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/badge-editor-modal.tsx
git commit -m "feat: add BadgeEditorModal for creating/editing lane badges"
```

---

## Task 7: Create `lane-badges` component

**Files:**
- Create: `src/components/timeline/lane-badges.tsx`

- [ ] **Step 1: Write the file**

```typescript
"use client";

import type { LaneAnalysis, LaneBadge } from "@/lib/types";

interface LaneBadgesProps {
  analysis?: LaneAnalysis;
  userBadges?: LaneBadge[];
  onAddClick: () => void;
  onBadgeClick: (badge: LaneBadge) => void;
}

export function LaneBadges({ analysis, userBadges, onAddClick, onBadgeClick }: LaneBadgesProps) {
  const items: React.ReactNode[] = [];

  if (analysis?.isDead) {
    items.push(
      <span key="dead" title="Dead lane (very few events)" className="inline-block w-1.5 h-1.5 rounded-full bg-gray-600" />
    );
  }
  if (analysis && !analysis.isDead && analysis.rhythmScore >= 0.5) {
    items.push(
      <span key="rhythm" title={`Rhythm ${analysis.rhythmScore.toFixed(2)}`} className="inline-block text-[9px] px-1.5 py-[1px] rounded-full bg-accent/20 text-accent border border-accent/30">
        ♻ {analysis.rhythmScore.toFixed(2)}
      </span>
    );
  }
  if (analysis && !analysis.isDead && analysis.dynamicScore >= 0.5) {
    items.push(
      <span key="dyn" title={`Dynamic ${analysis.dynamicScore.toFixed(2)}`} className="inline-block text-[9px] px-1.5 py-[1px] rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
        〜 wide
      </span>
    );
  }
  if (analysis && analysis.melodyScore !== undefined && analysis.melodyScore >= 0.5) {
    items.push(
      <span key="mel" title={`Melody ${analysis.melodyScore.toFixed(2)}`} className="inline-block text-[9px] px-1.5 py-[1px] rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30">
        🎵 {analysis.melodyScore.toFixed(2)}
      </span>
    );
  }

  for (const b of userBadges ?? []) {
    const color = b.color ?? hashColor(b.label);
    items.push(
      <button
        key={b.id}
        onClick={(e) => { e.stopPropagation(); onBadgeClick(b); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="inline-block text-[9px] px-1.5 py-[1px] rounded-full border"
        style={{ background: `${color}33`, color, borderColor: `${color}55` }}
        title="Click to edit"
      >
        ⭐ {b.label}
      </button>
    );
  }

  items.push(
    <button
      key="add"
      onClick={(e) => { e.stopPropagation(); onAddClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      className="inline-block text-[9px] w-4 h-4 rounded-full border border-white/10 text-gray-500 hover:text-white hover:border-accent/40 leading-none"
      title="Tag this lane"
    >
      +
    </button>
  );

  return <div className="flex items-center gap-1 flex-wrap mt-0.5">{items}</div>;
}

function hashColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 60%, 65%)`;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit` — expect zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/lane-badges.tsx
git commit -m "feat: add LaneBadges (auto + user badges with edit/add buttons)"
```

---

## Task 8: Extend the three lane components

**Files:**
- Modify: `src/components/timeline/notes-lane.tsx`
- Modify: `src/components/timeline/continuous-lane.tsx`
- Modify: `src/components/timeline/program-lane.tsx`

All three gain the same shape: `analysis?`, `userBadges?`, `onRequestAddBadge`, `onEditBadge`, `flashKey` (for highlight). Notes lane additionally renders the pitch sparkline when `analysis.pitchContour` is defined.

- [ ] **Step 1: Update `notes-lane.tsx`**

Replace the contents of `src/components/timeline/notes-lane.tsx` with:

```typescript
"use client";

import { useMemo } from "react";
import type { LaneAnalysis, LaneBadge, NoteSpan } from "@/lib/types";
import { ResizeHandle } from "./resize-handle";
import { LaneBadges } from "./lane-badges";
import { PitchSparkline } from "./pitch-sparkline";

interface NotesLaneProps {
  laneKey: string;
  spans: NoteSpan[];
  viewStartMs: number;
  viewEndMs: number;
  heightPx: number;
  leftGutterPx: number;
  onHover?: (span: NoteSpan | null, clientX: number, clientY: number) => void;
  onResize?: (newHeight: number) => void;
  analysis?: LaneAnalysis;
  userBadges?: LaneBadge[];
  onRequestAddBadge?: (laneKey: string) => void;
  onEditBadge?: (badge: LaneBadge) => void;
  isFlashing?: boolean;
}

export function NotesLane(props: NotesLaneProps) {
  const {
    laneKey, spans, viewStartMs, viewEndMs, heightPx, leftGutterPx,
    onHover, onResize, analysis, userBadges, onRequestAddBadge, onEditBadge, isFlashing,
  } = props;

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
    return spans.filter((s) => s.tEnd >= viewStartMs && s.tStart < viewEndMs);
  }, [spans, viewStartMs, viewEndMs]);

  const viewSpan = viewEndMs - viewStartMs;
  const pitchSpan = Math.max(1, maxPitch - minPitch);

  return (
    <div
      className={`relative border-t border-white/5 ${isFlashing ? "ring-1 ring-accent/60" : ""}`}
      style={{ height: heightPx }}
    >
      <div
        className="absolute left-0 top-0 h-full text-[10px] text-gray-500 px-3 flex flex-col justify-center gap-0.5 border-r border-white/5 z-[2] bg-black/0 overflow-hidden"
        style={{ width: leftGutterPx }}
      >
        <div className="flex items-center gap-2">
          <span>Notes</span>
          {analysis?.pitchContour && analysis.pitchRange && (
            <PitchSparkline contour={analysis.pitchContour} pitchRange={analysis.pitchRange} width={60} height={12} />
          )}
        </div>
        <LaneBadges
          analysis={analysis}
          userBadges={userBadges}
          onAddClick={() => onRequestAddBadge?.(laneKey)}
          onBadgeClick={(b) => onEditBadge?.(b)}
        />
      </div>
      <div className="absolute top-0 bottom-0" style={{ left: leftGutterPx, right: 0 }}>
        {visibleSpans.map((s, i) => {
          const xStartPct = ((Math.max(s.tStart, viewStartMs) - viewStartMs) / viewSpan) * 100;
          const xEndPct = ((Math.min(s.tEnd, viewEndMs) - viewStartMs) / viewSpan) * 100;
          const widthPct = Math.max(0.15, xEndPct - xStartPct);
          const yPct = (1 - (s.pitch - minPitch) / pitchSpan) * 100;
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
                height: 4,
                background: velocityColor(s.velocity),
                borderRadius: 1,
              }}
            />
          );
        })}
      </div>
      {onResize && <ResizeHandle currentHeight={heightPx} onResize={onResize} />}
    </div>
  );
}

// Discrete velocity bands — distinct saturated colors.
function velocityColor(velocity: number): string {
  const v = Math.max(0, Math.min(127, velocity));
  if (v <= 20)  return "rgba(74, 123, 255, 0.75)";
  if (v <= 50)  return "rgba(0, 212, 255, 0.80)";
  if (v <= 80)  return "rgba(125, 216, 125, 0.85)";
  if (v <= 110) return "rgba(255, 184, 77, 0.90)";
  return "rgba(255, 74, 74, 0.95)";
}
```

- [ ] **Step 2: Update `continuous-lane.tsx`**

Add imports and new props. Locate the existing imports at the top:

```typescript
import { useEffect, useRef } from "react";
import type { RecordedEvent } from "@/lib/types";
import { bucketContinuous, eventValue } from "@/lib/timeline-util";
import { ResizeHandle } from "./resize-handle";
```

Replace with:

```typescript
import { useEffect, useRef } from "react";
import type { LaneAnalysis, LaneBadge, RecordedEvent } from "@/lib/types";
import { bucketContinuous, eventValue } from "@/lib/timeline-util";
import { ResizeHandle } from "./resize-handle";
import { LaneBadges } from "./lane-badges";
```

Then find the `ContinuousLaneProps` interface. Add five new optional props at the end:

```typescript
interface ContinuousLaneProps {
  label: string;
  sublabel?: string;
  events: RecordedEvent[];
  eventIndices: number[];
  viewStartMs: number;
  viewEndMs: number;
  heightPx: number;
  leftGutterPx: number;
  valueMapper?: (v: number) => number;
  color?: string;
  fill?: string;
  bufferVersion?: number;
  onHover?: (evt: RecordedEvent | null, clientX: number, clientY: number) => void;
  onResize?: (newHeight: number) => void;
  laneKey: string;
  analysis?: LaneAnalysis;
  userBadges?: LaneBadge[];
  onRequestAddBadge?: (laneKey: string) => void;
  onEditBadge?: (badge: LaneBadge) => void;
  isFlashing?: boolean;
}
```

Update the destructuring at the top of the function to include the new props:

```typescript
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
  onResize,
  laneKey,
  analysis,
  userBadges,
  onRequestAddBadge,
  onEditBadge,
  isFlashing,
}: ContinuousLaneProps) {
```

Find the outer wrapper `<div>` (the one with `ref={wrapRef}`). Change:

```typescript
    <div
      ref={wrapRef}
      className="relative border-t border-white/5 flex"
      style={{ height: heightPx }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
```

to:

```typescript
    <div
      ref={wrapRef}
      className={`relative border-t border-white/5 flex ${isFlashing ? "ring-1 ring-accent/60" : ""}`}
      style={{ height: heightPx }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
```

Find the inner gutter `<div>` (the one with `className="text-[10px] text-gray-500 px-3 py-1 border-r border-white/5 flex flex-col justify-center overflow-hidden"`). Replace it with:

```typescript
      <div
        className="text-[10px] text-gray-500 px-3 py-1 border-r border-white/5 flex flex-col justify-center overflow-hidden"
        style={{ width: leftGutterPx, flexShrink: 0 }}
      >
        <span className="truncate">{label}</span>
        {sublabel && <span className="text-gray-700 text-[9px] truncate">{sublabel}</span>}
        <LaneBadges
          analysis={analysis}
          userBadges={userBadges}
          onAddClick={() => onRequestAddBadge?.(laneKey)}
          onBadgeClick={(b) => onEditBadge?.(b)}
        />
      </div>
```

(Only the closing tag is gaining a sibling `<LaneBadges>`.)

- [ ] **Step 3: Update `program-lane.tsx`**

Same pattern. Replace the full file with:

```typescript
"use client";

import { useMemo } from "react";
import type { LaneAnalysis, LaneBadge, RecordedEvent } from "@/lib/types";
import { ResizeHandle } from "./resize-handle";
import { LaneBadges } from "./lane-badges";

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
  onResize?: (newHeight: number) => void;
  laneKey: string;
  analysis?: LaneAnalysis;
  userBadges?: LaneBadge[];
  onRequestAddBadge?: (laneKey: string) => void;
  onEditBadge?: (badge: LaneBadge) => void;
  isFlashing?: boolean;
}

export function ProgramLane(props: ProgramLaneProps) {
  const {
    label, sublabel, events, eventIndices,
    viewStartMs, viewEndMs, heightPx, leftGutterPx,
    onHover, onResize, laneKey, analysis, userBadges,
    onRequestAddBadge, onEditBadge, isFlashing,
  } = props;

  const visible = useMemo(() => {
    if (eventIndices.length === 0) return [];
    const subset = eventIndices;
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
    <div
      className={`relative border-t border-white/5 flex ${isFlashing ? "ring-1 ring-accent/60" : ""}`}
      style={{ height: heightPx }}
    >
      <div
        className="text-[10px] text-gray-500 px-3 py-1 border-r border-white/5 flex flex-col justify-center overflow-hidden"
        style={{ width: leftGutterPx, flexShrink: 0 }}
      >
        <span className="truncate">{label}</span>
        {sublabel && <span className="text-gray-700 text-[9px] truncate">{sublabel}</span>}
        <LaneBadges
          analysis={analysis}
          userBadges={userBadges}
          onAddClick={() => onRequestAddBadge?.(laneKey)}
          onBadgeClick={(b) => onEditBadge?.(b)}
        />
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
      {onResize && <ResizeHandle currentHeight={heightPx} onResize={onResize} />}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit` — expect **errors** in `device-section.tsx` (it still invokes the lanes without the new required `laneKey` prop). That's expected; we fix it in the next task. As long as the three lane files themselves compile (the errors should all be in `device-section.tsx`), proceed.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/notes-lane.tsx src/components/timeline/continuous-lane.tsx src/components/timeline/program-lane.tsx
git commit -m "feat: lane components accept analysis/badges/flash props and render LaneBadges"
```

---

## Task 9: Thread analysis + badges through DeviceSection

**Files:**
- Modify: `src/components/timeline/device-section.tsx`

- [ ] **Step 1: Add to the imports**

The file currently imports from `@/lib/types`:

```typescript
import type { LaneKey, LaneMap, NoteSpan, RecordedEvent, MidiMappingRule } from "@/lib/types";
import { laneKeyString } from "@/lib/types";
```

Change to:

```typescript
import type { LaneAnalysis, LaneBadge, LaneKey, LaneMap, NoteSpan, RecordedEvent, MidiMappingRule } from "@/lib/types";
import { laneKeyString } from "@/lib/types";
```

- [ ] **Step 2: Extend `DeviceSectionProps`**

Find the `interface DeviceSectionProps` block. Add these props at the end, before the closing brace:

```typescript
  getAnalysisFor?: (key: string) => LaneAnalysis | undefined;
  getBadgesFor?: (key: string) => LaneBadge[] | undefined;
  onRequestAddBadge?: (laneKey: string) => void;
  onEditBadge?: (badge: LaneBadge) => void;
  flashLaneKey?: string | null;
```

- [ ] **Step 3: Destructure the new props**

Find the destructuring inside `export function DeviceSection(props: DeviceSectionProps) {`:

```typescript
  const {
    device, laneMap, events, noteSpans, mappingRules,
    viewStartMs, viewEndMs, leftGutterPx, collapsed, onToggleCollapsed,
    bufferVersion, onHoverEvent, onHoverSpan,
    getLaneHeight, onLaneResize,
  } = props;
```

Change to:

```typescript
  const {
    device, laneMap, events, noteSpans, mappingRules,
    viewStartMs, viewEndMs, leftGutterPx, collapsed, onToggleCollapsed,
    bufferVersion, onHoverEvent, onHoverSpan,
    getLaneHeight, onLaneResize,
    getAnalysisFor, getBadgesFor, onRequestAddBadge, onEditBadge, flashLaneKey,
  } = props;
```

- [ ] **Step 4: Pass analysis + badges + flash to each lane**

In the `laneEntries.map(...)` block, the existing code calls the 4 lane components (`NotesLane`, `ContinuousLane` for CC, pitch, AT, and `ProgramLane`). For each component invocation, add the following props at the end of its props (before the self-closing `/>`):

```typescript
                    laneKey={keyStr}
                    analysis={getAnalysisFor?.(keyStr)}
                    userBadges={getBadgesFor?.(keyStr)}
                    onRequestAddBadge={onRequestAddBadge}
                    onEditBadge={onEditBadge}
                    isFlashing={flashLaneKey === keyStr}
```

There are five invocations total: one `NotesLane`, three `ContinuousLane` (cc, pitch, aftertouch), one `ProgramLane`. Add the five props to each of them.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: errors shift to `timeline-canvas.tsx` (it still calls `DeviceSection` without the new optional props, but those are optional so it actually shouldn't error — verify). The lane components and device-section should be clean now.

- [ ] **Step 6: Commit**

```bash
git add src/components/timeline/device-section.tsx
git commit -m "feat: thread analysis, badges, and flash key through DeviceSection"
```

---

## Task 10: Create `triggers-sidebar` component

**Files:**
- Create: `src/components/timeline/triggers-sidebar.tsx`

- [ ] **Step 1: Write the file**

```typescript
"use client";

import { useMemo, useState } from "react";
import type { LaneAnalysis, LaneBadge, RedundancyPair } from "@/lib/types";

interface TriggersSidebarProps {
  analyses: LaneAnalysis[] | null;
  pairs: RedundancyPair[] | null;
  ready: boolean;
  error: string | null;
  userBadges: LaneBadge[];
  laneLabelFor: (laneKey: string) => string; // human-friendly label, e.g. "Push 2 · CC 7"
  onSelectLane: (laneKey: string) => void;    // scroll + flash
  onSelectPair: (a: string, b: string) => void;
  onTagCurrentLane: () => void;
}

type SectionKey = "rhythm" | "melody" | "dynamic" | "redundant" | "tagged";

export function TriggersSidebar(props: TriggersSidebarProps) {
  const { analyses, pairs, ready, error, userBadges, laneLabelFor, onSelectLane, onSelectPair, onTagCurrentLane } = props;

  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    rhythm: true, melody: true, dynamic: true, redundant: true, tagged: true,
  });

  const rhythmic = useMemo(() => {
    if (!analyses) return [];
    return [...analyses]
      .filter((a) => !a.isDead && a.rhythmScore >= 0.5)
      .sort((a, b) => b.rhythmScore - a.rhythmScore)
      .slice(0, 10);
  }, [analyses]);

  const melodic = useMemo(() => {
    if (!analyses) return [];
    return [...analyses]
      .filter((a) => !a.isDead && a.melodyScore !== undefined && a.melodyScore >= 0.5)
      .sort((a, b) => (b.melodyScore ?? 0) - (a.melodyScore ?? 0))
      .slice(0, 5);
  }, [analyses]);

  const dynamicLanes = useMemo(() => {
    if (!analyses) return [];
    return [...analyses]
      .filter((a) => !a.isDead && a.dynamicScore >= 0.5)
      .sort((a, b) => b.dynamicScore - a.dynamicScore)
      .slice(0, 10);
  }, [analyses]);

  const tagged = useMemo(() => {
    const byLabel = new Map<string, LaneBadge[]>();
    for (const b of userBadges) {
      const list = byLabel.get(b.label) ?? [];
      list.push(b);
      byLabel.set(b.label, list);
    }
    return Array.from(byLabel.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [userBadges]);

  const toggle = (k: SectionKey) => setOpen((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div className="w-72 flex-shrink-0 bg-surface-light border-l border-white/10 overflow-y-auto text-xs">
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
        <span className="font-semibold text-sm">📊 Triggers</span>
        {!ready && <span className="text-[10px] text-gray-500 italic">Analyzing…</span>}
      </div>

      {error && (
        <div className="px-3 py-2 text-red-400 text-[10px]">Analysis failed: {error}</div>
      )}

      {ready && !error && analyses && analyses.length === 0 && (
        <div className="px-3 py-2 text-gray-500 italic text-[10px]">No events to analyze.</div>
      )}

      {ready && !error && analyses && analyses.length > 0 && (
        <>
          <Section label="Most rhythmic" isOpen={open.rhythm} onToggle={() => toggle("rhythm")}>
            {rhythmic.length === 0 ? <Empty label="No rhythmic lanes" /> : rhythmic.map((a) => (
              <Row key={a.laneKey} onClick={() => onSelectLane(a.laneKey)} label={laneLabelFor(a.laneKey)} prefix={`♻ ${a.rhythmScore.toFixed(2)}`} />
            ))}
          </Section>

          <Section label="Most melodic" isOpen={open.melody} onToggle={() => toggle("melody")}>
            {melodic.length === 0 ? <Empty label="No melodic lanes" /> : melodic.map((a) => (
              <Row key={a.laneKey} onClick={() => onSelectLane(a.laneKey)} label={laneLabelFor(a.laneKey)} prefix={`🎵 ${(a.melodyScore ?? 0).toFixed(2)}`} />
            ))}
          </Section>

          <Section label="Most dynamic" isOpen={open.dynamic} onToggle={() => toggle("dynamic")}>
            {dynamicLanes.length === 0 ? <Empty label="No dynamic lanes" /> : dynamicLanes.map((a) => (
              <Row key={a.laneKey} onClick={() => onSelectLane(a.laneKey)} label={laneLabelFor(a.laneKey)} prefix={`〜 ${a.dynamicScore.toFixed(2)}`} />
            ))}
          </Section>

          <Section label="Redundant pairs" isOpen={open.redundant} onToggle={() => toggle("redundant")}>
            {!pairs || pairs.length === 0 ? <Empty label="No redundant pairs" /> : pairs.map((p, i) => (
              <Row key={i} onClick={() => onSelectPair(p.laneKeyA, p.laneKeyB)}
                label={`${laneLabelFor(p.laneKeyA)} ↔ ${laneLabelFor(p.laneKeyB)}`}
                prefix={`${Math.round(p.similarity * 100)}%`} />
            ))}
          </Section>

          <Section label="Your tagged" isOpen={open.tagged} onToggle={() => toggle("tagged")}>
            {tagged.length === 0 ? <Empty label="No tagged lanes" /> : tagged.map(([lbl, list]) => (
              <div key={lbl}>
                <div className="px-3 py-1 text-[10px] text-gray-400">⭐ {lbl} ({list.length})</div>
                {list.map((b) => (
                  <Row key={b.id} onClick={() => onSelectLane(b.laneKey)} label={laneLabelFor(b.laneKey)} prefix="" indent />
                ))}
              </div>
            ))}
          </Section>

          <div className="p-3 border-t border-white/10">
            <button
              onClick={onTagCurrentLane}
              className="w-full text-[10px] px-2 py-1.5 border border-white/10 text-gray-300 hover:text-white hover:border-accent/40 rounded"
            >
              + Tag current lane
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ label, isOpen, onToggle, children }: { label: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/5">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold hover:bg-white/5"
      >
        <span className="text-gray-600">{isOpen ? "▾" : "▸"}</span>
        <span>{label}</span>
      </button>
      {isOpen && <div className="pb-1">{children}</div>}
    </div>
  );
}

function Row({ onClick, label, prefix, indent }: { onClick: () => void; label: string; prefix: string; indent?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1 text-left hover:bg-white/5 ${indent ? "pl-8" : ""}`}
    >
      {prefix && <span className="text-accent text-[10px] font-mono shrink-0">{prefix}</span>}
      <span className="truncate text-gray-300 text-[10px]">{label}</span>
    </button>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-3 py-1 text-[10px] text-gray-600 italic">{label}</div>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit` — expect zero new errors in this file (pre-existing errors in `timeline-canvas.tsx` / `page.tsx` are fine; we wire those next).

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/triggers-sidebar.tsx
git commit -m "feat: add TriggersSidebar with 5 ranked sections"
```

---

## Task 11: Update `TimelineCanvas` (sidebar + flash + layout)

**Files:**
- Modify: `src/components/timeline/timeline-canvas.tsx`

- [ ] **Step 1: Extend imports**

Add imports at the top of the file, after the existing ones:

```typescript
import { TriggersSidebar } from "./triggers-sidebar";
import type { LaneAnalysis, LaneBadge, RedundancyPair } from "@/lib/types";
```

- [ ] **Step 2: Extend `TimelineCanvasProps`**

Add these fields at the end of the interface, before its closing brace:

```typescript
  analyses: LaneAnalysis[] | null;
  redundantPairs: RedundancyPair[] | null;
  analysisReady: boolean;
  analysisError: string | null;
  badges: LaneBadge[];
  triggersSidebarOpen: boolean;
  onToggleTriggersSidebar: () => void;
  onRequestAddBadge: (laneKey: string) => void;
  onEditBadge: (badge: LaneBadge) => void;
  onTagCurrentLane: () => void;
```

- [ ] **Step 3: Destructure the new props**

Find the top of `TimelineCanvas`'s function body:

```typescript
  const {
    recording, events, bufferVersion, isRecording, laneMap, noteSpans, mappingRules,
    playheadMsRef, onSeek, audioPeaks, audioLabel, onAudioOffsetDelta,
  } = props;
```

Change to:

```typescript
  const {
    recording, events, bufferVersion, isRecording, laneMap, noteSpans, mappingRules,
    playheadMsRef, onSeek, audioPeaks, audioLabel, onAudioOffsetDelta,
    analyses, redundantPairs, analysisReady, analysisError, badges,
    triggersSidebarOpen, onToggleTriggersSidebar, onRequestAddBadge, onEditBadge, onTagCurrentLane,
  } = props;
```

- [ ] **Step 4: Add helper functions and flash state near the top of the component**

Immediately after the `const [laneHeights, setLaneHeights] = useState<Map<string, number>>(new Map());` block, add:

```typescript
  const [flashLaneKey, setFlashLaneKey] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const analysisByKey = useMemo(() => {
    const m = new Map<string, LaneAnalysis>();
    for (const a of analyses ?? []) m.set(a.laneKey, a);
    return m;
  }, [analyses]);

  const badgesByKey = useMemo(() => {
    const m = new Map<string, LaneBadge[]>();
    for (const b of badges ?? []) {
      const list = m.get(b.laneKey) ?? [];
      list.push(b);
      m.set(b.laneKey, list);
    }
    return m;
  }, [badges]);

  const flashLane = useCallback((laneKey: string) => {
    setFlashLaneKey(laneKey);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashLaneKey(null), 900);
  }, []);

  const laneLabelFor = useCallback((laneKey: string): string => {
    for (const entry of laneMap.values()) {
      if (laneKeyString(entry.key) !== laneKey) continue;
      const k = entry.key;
      switch (k.kind) {
        case "notes":       return `${k.device} · Notes`;
        case "cc":          return `${k.device} · CC ${k.cc} ch${k.channel}`;
        case "pitch":       return `${k.device} · Pitch ch${k.channel}`;
        case "aftertouch":  return `${k.device} · AT ch${k.channel}${k.note !== undefined ? ` #${k.note}` : ""}`;
        case "program":     return `${k.device} · Program ch${k.channel}`;
      }
    }
    return laneKey;
  }, [laneMap]);
```

Also, at the top of the file, update the import of React to include `useMemo` and `useCallback` if they aren't already imported. Ensure the existing import reads:

```typescript
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
```

Import `laneKeyString`:

```typescript
import { laneKeyString } from "@/lib/types";
```

(Add this to the existing `@/lib/types` import line if more convenient.)

- [ ] **Step 5: Wrap the main return in a horizontal flex container with the sidebar**

The existing `TimelineCanvas` returns a single scrollable `<div ref={wrapRef} ...>`. Wrap it with a flex container that adds the sidebar when open.

Change the existing `return ( <div ref={wrapRef} onWheel={handleWheel} className="relative flex-1 min-h-0 bg-surface rounded-lg border border-white/5 overflow-y-auto" >` opener to:

```typescript
  return (
    <div className="flex-1 min-h-0 flex">
      <div
        ref={wrapRef}
        onWheel={handleWheel}
        className="relative flex-1 min-h-0 bg-surface rounded-lg border border-white/5 overflow-y-auto"
      >
```

Find the closing `</div>` that matches that outer `<div>` (at the very bottom of the JSX, just before the function's closing `);`). Add the sidebar and a closing flex wrapper around it:

```typescript
      </div>
      {triggersSidebarOpen && (
        <TriggersSidebar
          analyses={analyses}
          pairs={redundantPairs}
          ready={analysisReady}
          error={analysisError}
          userBadges={badges}
          laneLabelFor={laneLabelFor}
          onSelectLane={(k) => { flashLane(k); scrollLaneIntoView(k); }}
          onSelectPair={(a, b) => { flashLane(a); flashLane(b); scrollLaneIntoView(a); }}
          onTagCurrentLane={onTagCurrentLane}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Add a `scrollLaneIntoView` helper**

Inside `TimelineCanvas`, add this function just above the `return` statement:

```typescript
  const scrollLaneIntoView = useCallback((laneKey: string) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const target = wrap.querySelector(`[data-lane-key="${CSS.escape(laneKey)}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);
```

- [ ] **Step 7: Pass new props to `DeviceSection`**

Find the `<DeviceSection ... />` inside the `devices.map(...)` loop. Add these props at the end:

```typescript
          getAnalysisFor={(k) => analysisByKey.get(k)}
          getBadgesFor={(k) => badgesByKey.get(k)}
          onRequestAddBadge={onRequestAddBadge}
          onEditBadge={onEditBadge}
          flashLaneKey={flashLaneKey}
```

- [ ] **Step 8: Mark each lane wrapper with a `data-lane-key` so scroll-into-view can find it**

This requires tagging each rendered lane element. Rather than changing every lane component, tag them at the `DeviceSection` level. Open `src/components/timeline/device-section.tsx`.

Find the `laneEntries.map(...)` block. Wrap each returned lane in a `<div data-lane-key={keyStr} key={...}>` wrapper. Example for the CC branch:

Before:

```typescript
              case "cc":
                return (
                  <ContinuousLane
                    key={`cc|${entry.key.channel}|${entry.key.cc}`}
                    ...
                  />
                );
```

After:

```typescript
              case "cc":
                return (
                  <div data-lane-key={keyStr} key={`cc|${entry.key.channel}|${entry.key.cc}`}>
                    <ContinuousLane
                      ...
                    />
                  </div>
                );
```

Do this for all five lane branches (notes, cc, pitch, aftertouch, program). Move the `key` prop from the inner component to the outer `<div>` (React needs the key on the returned element, which is now the `<div>`). Keep all other props on the inner component.

- [ ] **Step 9: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: errors only in `src/app/timeline/page.tsx` (it doesn't pass the new required props yet). The canvas and device-section should be clean.

- [ ] **Step 10: Commit**

```bash
git add src/components/timeline/timeline-canvas.tsx src/components/timeline/device-section.tsx
git commit -m "feat: TimelineCanvas sidebar + flash helper + lane-key data attribute"
```

---

## Task 12: Add the Triggers toggle to `TimelineToolbar`

**Files:**
- Modify: `src/components/timeline/timeline-toolbar.tsx`

- [ ] **Step 1: Extend the props**

Find `TimelineToolbarProps` and add two fields at the end:

```typescript
  triggersSidebarOpen: boolean;
  onToggleTriggersSidebar: () => void;
```

- [ ] **Step 2: Destructure and render the button**

In the function body, update the destructuring to pull the two new props. Then find the block with the three "Save / Save As / Load" buttons. Just after the `Import .mid…` button, before the next divider `<div className="w-px h-5 bg-white/10 mx-1" />`, insert:

```typescript
      <button
        onClick={onToggleTriggersSidebar}
        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
          triggersSidebarOpen
            ? "bg-accent/20 text-accent border-accent/40"
            : "border-white/10 text-gray-300 hover:text-white hover:border-accent/40"
        }`}
      >
        📊 Triggers
      </button>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit` — expected error in `page.tsx` only; toolbar itself compiles.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/timeline-toolbar.tsx
git commit -m "feat: TimelineToolbar adds Triggers sidebar toggle button"
```

---

## Task 13: Wire everything up in `/timeline/page.tsx`

**Files:**
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: Extend imports**

At the top, add:

```typescript
import { useTriggerAnalysis } from "@/hooks/use-trigger-analysis";
import { BadgeEditorModal } from "@/components/timeline/badge-editor-modal";
import type { LaneBadge } from "@/lib/types";
```

(Merge `LaneBadge` into the existing `@/lib/types` import line if convenient.)

- [ ] **Step 2: Add badge + sidebar state near the top of the component**

After the existing state declarations (just below `const [canvasWidthPx, setCanvasWidthPx] = useState(800);` or equivalent), add:

```typescript
  const [triggersSidebarOpen, setTriggersSidebarOpen] = useState(false);
  const [badgeEditor, setBadgeEditor] = useState<{ laneKey: string; badge: LaneBadge | null } | null>(null);
  const lastHoveredLaneRef = useRef<string | null>(null);
```

- [ ] **Step 3: Call `useTriggerAnalysis`**

After `const noteSpans: NoteSpan[] = useMemo(...)` (or directly after the `laneMap` useMemo block), add:

```typescript
  const analysis = useTriggerAnalysis({
    recording: recorder.recording,
    bufferVersion: recorder.bufferVersion,
    laneMap,
    noteSpans,
  });
```

- [ ] **Step 4: Add badge CRUD helpers**

After `const handleRename = useCallback(...)` (or anywhere among the handlers), add:

```typescript
  const existingBadges = recorder.recording?.badges ?? [];

  const saveBadge = useCallback((next: LaneBadge) => {
    const rec = recorder.recording;
    if (!rec) return;
    const filtered = (rec.badges ?? []).filter((b) => b.id !== next.id);
    const deduped = filtered.filter((b) => !(b.laneKey === next.laneKey && b.label === next.label));
    recorder.patchRecording({ badges: [...deduped, next] });
    setBadgeEditor(null);
  }, [recorder]);

  const deleteBadge = useCallback((id: string) => {
    const rec = recorder.recording;
    if (!rec) return;
    recorder.patchRecording({ badges: (rec.badges ?? []).filter((b) => b.id !== id) });
    setBadgeEditor(null);
  }, [recorder]);

  const handleRequestAddBadge = useCallback((laneKey: string) => {
    lastHoveredLaneRef.current = laneKey;
    setBadgeEditor({ laneKey, badge: null });
  }, []);

  const handleEditBadge = useCallback((badge: LaneBadge) => {
    setBadgeEditor({ laneKey: badge.laneKey, badge });
  }, []);

  const handleTagCurrentLane = useCallback(() => {
    const key = lastHoveredLaneRef.current;
    if (!key) {
      alert("Hover a lane first to choose which one to tag.");
      return;
    }
    setBadgeEditor({ laneKey: key, badge: null });
  }, []);
```

- [ ] **Step 5: Pass new props to `TimelineToolbar` and `TimelineCanvas`**

Find the `<TimelineToolbar ... />` invocation. Add these two props at the end:

```typescript
        triggersSidebarOpen={triggersSidebarOpen}
        onToggleTriggersSidebar={() => setTriggersSidebarOpen((v) => !v)}
```

Find `<TimelineCanvas ... />`. Add these at the end:

```typescript
          analyses={analysis.analyses}
          redundantPairs={analysis.pairs}
          analysisReady={analysis.ready}
          analysisError={analysis.error}
          badges={existingBadges}
          triggersSidebarOpen={triggersSidebarOpen}
          onToggleTriggersSidebar={() => setTriggersSidebarOpen((v) => !v)}
          onRequestAddBadge={handleRequestAddBadge}
          onEditBadge={handleEditBadge}
          onTagCurrentLane={handleTagCurrentLane}
```

- [ ] **Step 6: Render the badge editor modal**

Just before the existing `{confirmDiscard && (...)}` block near the bottom of the page's return, add:

```typescript
      {badgeEditor && (
        <BadgeEditorModal
          badge={badgeEditor.badge}
          laneKey={badgeEditor.laneKey}
          existingLabels={Array.from(new Set((recorder.recording?.badges ?? []).map((b) => b.label)))}
          onSave={saveBadge}
          onDelete={badgeEditor.badge ? () => deleteBadge(badgeEditor.badge!.id) : undefined}
          onClose={() => setBadgeEditor(null)}
        />
      )}
```

- [ ] **Step 7: Track last-hovered lane for "Tag current lane"**

To know which lane the user means by "current", we use the `lastHoveredLaneRef`. Each lane has a `data-lane-key` attribute (added in Task 11). Subscribe to mouseover events at the canvas level.

Just after the `useEffect` that sets up `ResizeObserver` (or anywhere before the return), add:

```typescript
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const onMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-lane-key]");
      if (target) lastHoveredLaneRef.current = target.dataset.laneKey ?? null;
    };
    wrap.addEventListener("mousemove", onMove);
    return () => wrap.removeEventListener("mousemove", onMove);
  }, []);
```

- [ ] **Step 8: Typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 9: Recompile electron (no changes but safe)**

```bash
pnpm electron:compile
```

Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "feat: wire Trigger Analyzer — analysis hook, badge CRUD, sidebar toggle"
```

---

## Task 14: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Restart the dev server**

Kill any existing dev process and relaunch so the main-process validator change loads:

```bash
pkill -f "electron ." 2>/dev/null; pkill -f "next dev" 2>/dev/null; pkill -f "concurrently" 2>/dev/null; sleep 1
pnpm electron:dev
```

Expected: Electron opens, Timeline tab loads without errors.

- [ ] **Step 2: Load a take with at least 4 devices / ~20 active lanes**

Open a previously saved `.oscrec` file. Verify:
- Timeline renders all lanes.
- Click the "📊 Triggers" toolbar button. Sidebar slides in at 288px wide.
- Sidebar briefly says "Analyzing…", then populates 5 sections within ~2s.

- [ ] **Step 3: Validate per-section content**

- **Most rhythmic**: values look plausible. A steady kick or a quantized CC sweep scores >0.7; a free-form wiggle scores <0.4.
- **Most melodic**: a monophonic lead line shows up; a drum pattern or a single sustained drone does not.
- **Most dynamic**: CCs that sweep their full range appear; a stuck CC at 127 does not.
- **Redundant pairs**: if your recording has two controllers bound to the same target, they should appear here with similarity ≥80%.
- **Your tagged**: empty initially.

- [ ] **Step 4: Verify sidebar interactions**

- Click a row in "Most rhythmic" → the timeline scrolls to that lane; lane flashes briefly (~1s).
- Click a redundant pair → both referenced lanes flash together.

- [ ] **Step 5: Create a user badge**

- Find a CC lane. Click the `+` at the end of its badge row.
- Badge editor modal opens. Type `main fader`, pick blue.
- Click Save.
- Verify the badge appears on the lane (blue pill labeled `⭐ main fader`) and in "Your tagged" in the sidebar.

- [ ] **Step 6: Edit and delete the badge**

- Click the badge on the lane. Modal opens with existing values.
- Change color to green, change label to `main`. Click Save.
- Confirm live update (pill now green, label `main`).
- Click the badge again, click Delete. Confirm it disappears from both surfaces.

- [ ] **Step 7: Autocomplete**

- Add `kick` to a notes lane.
- Add another badge on a different CC; start typing `ki` — the autocomplete suggests `kick`. Click to apply.

- [ ] **Step 8: Persist across reload**

- Save the recording.
- Close the app.
- Relaunch (`pnpm electron:dev`), open the file.
- Badges reappear exactly where they were.

- [ ] **Step 9: Load a pre-feature `.oscrec`**

- Open a `.oscrec` saved before this feature (no `badges` field).
- Confirm: no error; sidebar works; badges empty.

- [ ] **Step 10: Corrupt `badges` field**

- Duplicate a saved `.oscrec` file. Open in a text editor; find `"badges": [...]` and corrupt one entry (e.g., change `"id": "..."` to `"id": 123`).
- Try to load. Confirm: clear validator error toast (e.g., `Recording.badges[0].id must be a string`). Timeline state is not corrupted — previous take still loaded.

- [ ] **Step 11: Long recording smoke test**

- Record or load a 30+ minute take.
- Open the Triggers sidebar. Confirm "Analyzing…" appears briefly, UI stays responsive during analysis.
- Once complete, all sections populate with sensible values.

- [ ] **Step 12: Commit the verification**

If all checks pass without code changes, commit an empty marker:

```bash
git commit --allow-empty -m "chore: trigger-discovery feature passed end-to-end manual verification"
```

If fixes were needed during verification, commit them with descriptive messages along the way.

---

## Notes

**`requestIdleCallback` in Electron:** Chromium-based Electron supports `requestIdleCallback`. The hook feature-detects and falls back to `setTimeout(0)` just in case.

**Memoization caveat:** `useTriggerAnalysis` runs whenever `recording`, `bufferVersion`, `laneMap`, or `noteSpans` change. The `recorder.setLoaded()` replaces `recording` whole; the `bufferVersion` bumps on each batch; `laneMap` / `noteSpans` are memoized upstream in `page.tsx`. Avoid inlining new object identities for those props — they are passed through the existing useMemo blocks.

**User-badge color:** the hash-based fallback uses `charCodeAt` sum modulo 360 to pick a hue. Unstable if label is later renamed — that's fine because the color field is explicitly stored once a swatch is picked.

**Flash timing:** 900ms flash via `ring-1 ring-accent/60` on the lane wrapper. Clears via a stored timer. Rapid successive clicks from the sidebar reset the timer; only the most recent flash stays visible.

**Out of scope (reminders from spec):**
- No live-while-recording analysis.
- No BPM estimation / beat-grid overlay.
- No cross-recording badges; badges live inside one take.
- No export of trigger addresses.
- No motif or sequence detection.
