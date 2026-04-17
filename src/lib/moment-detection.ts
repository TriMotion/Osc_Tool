import type { Moment, NoteSpan, RecordedEvent, Recording } from "@/lib/types";

/**
 * Moment detection — finds interesting points in a recording:
 *
 * - "start": first note-on
 * - "end": last note-off
 * - "silence": >= 2s gap in note activity
 * - "drop": density crashes (current window < 40% of rolling average)
 * - "build": density ramps up over 4+ consecutive windows, ending >= 2× start
 * - "peak": local maximum of density > 150% of global average
 *
 * All detection works on a 500ms density grid over ALL note-on events across all devices.
 * Tempo-agnostic by design.
 */

const WINDOW_MS = 500;
const SILENCE_GAP_MS = 2000;
const DROP_FACTOR = 0.4;       // current must drop below 40% of rolling avg
const DROP_LOOKBACK = 4;       // windows (= 2s)
const DROP_MIN_PRIOR = 3;      // rolling avg must be ≥ 3 events/window to matter
const BUILD_MIN_WINDOWS = 4;   // 2s of monotonic rise
const BUILD_END_RATIO = 2.0;   // end density ≥ 2× start
const PEAK_FACTOR = 1.5;       // peak must be ≥ 150% of global mean
const PEAK_MIN_ABS = 4;        // and ≥ 4 events/window absolutely

export function detectMoments(rec: Recording, noteSpans: NoteSpan[]): Moment[] {
  const moments: Moment[] = [];
  const durationMs = Math.max(1, rec.durationMs);

  if (noteSpans.length === 0) return moments;

  const sortedStarts = noteSpans.map((s) => s.tStart).sort((a, b) => a - b);
  const sortedEnds = noteSpans.map((s) => s.tEnd).sort((a, b) => a - b);

  // Start and end markers.
  moments.push({
    id: `auto-start`,
    tMs: sortedStarts[0],
    kind: "start",
    label: "first note",
  });
  moments.push({
    id: `auto-end`,
    tMs: sortedEnds[sortedEnds.length - 1],
    kind: "end",
    label: "last note",
  });

  // Build density curve.
  const binCount = Math.ceil(durationMs / WINDOW_MS);
  const density = new Array<number>(binCount).fill(0);
  for (const s of noteSpans) {
    const idx = Math.min(binCount - 1, Math.floor(s.tStart / WINDOW_MS));
    density[idx]++;
  }

  const globalMean = density.reduce((a, b) => a + b, 0) / binCount;

  // Silence gaps (between consecutive note-ons).
  for (let i = 1; i < sortedStarts.length; i++) {
    const gap = sortedStarts[i] - sortedStarts[i - 1];
    if (gap >= SILENCE_GAP_MS) {
      moments.push({
        id: `auto-silence-${i}`,
        tMs: sortedStarts[i - 1],
        durationMs: gap,
        kind: "silence",
        label: `silence ${(gap / 1000).toFixed(1)}s`,
        score: Math.min(1, gap / 10_000),
      });
    }
  }

  // Drop detection.
  for (let i = DROP_LOOKBACK; i < binCount; i++) {
    let priorSum = 0;
    for (let k = i - DROP_LOOKBACK; k < i; k++) priorSum += density[k];
    const priorAvg = priorSum / DROP_LOOKBACK;
    if (priorAvg < DROP_MIN_PRIOR) continue;
    if (density[i] < priorAvg * DROP_FACTOR) {
      // Only report the first drop in a run.
      if (i > 0 && density[i - 1] < priorAvg * DROP_FACTOR) continue;
      moments.push({
        id: `auto-drop-${i}`,
        tMs: i * WINDOW_MS,
        kind: "drop",
        label: "drop",
        score: Math.min(1, (priorAvg - density[i]) / (priorAvg + 1)),
      });
    }
  }

  // Build detection.
  let runStart = -1;
  for (let i = 1; i < binCount; i++) {
    if (density[i] > density[i - 1]) {
      if (runStart < 0) runStart = i - 1;
    } else {
      if (runStart >= 0 && i - runStart >= BUILD_MIN_WINDOWS) {
        const startVal = density[runStart];
        const endVal = density[i - 1];
        if (endVal >= startVal * BUILD_END_RATIO && endVal >= 3) {
          moments.push({
            id: `auto-build-${runStart}`,
            tMs: runStart * WINDOW_MS,
            durationMs: (i - runStart) * WINDOW_MS,
            kind: "build",
            label: "build",
            score: Math.min(1, (endVal - startVal) / (startVal + 5)),
          });
        }
      }
      runStart = -1;
    }
  }

  // Peaks (local maxima above threshold).
  if (globalMean > 0) {
    for (let i = 1; i < binCount - 1; i++) {
      if (
        density[i] >= PEAK_MIN_ABS &&
        density[i] >= globalMean * PEAK_FACTOR &&
        density[i] > density[i - 1] &&
        density[i] > density[i + 1]
      ) {
        moments.push({
          id: `auto-peak-${i}`,
          tMs: i * WINDOW_MS,
          kind: "peak",
          label: "peak",
          score: Math.min(1, density[i] / (globalMean * 3 + 1)),
        });
      }
    }
  }

  // Sort by time.
  moments.sort((a, b) => a.tMs - b.tMs);
  return moments;
}

export function mergeMoments(auto: Moment[], user: Moment[] | undefined): Moment[] {
  return [...auto, ...(user ?? [])].sort((a, b) => a.tMs - b.tMs);
}

export function momentColor(kind: Moment["kind"]): string {
  switch (kind) {
    case "drop":    return "#ff6fa3";
    case "build":   return "#ffb84d";
    case "peak":    return "#ffd84a";
    case "silence": return "#4a7bff";
    case "start":   return "#7dd87d";
    case "end":     return "#888";
    case "user":    return "#b48bff";
  }
}
