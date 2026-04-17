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

/** Main entry point. Runs the whole analysis synchronously. */
export function analyzeRecording(
  rec: Recording,
  laneMap: LaneMap,
  noteSpans: NoteSpan[]
): { analyses: LaneAnalysis[]; pairs: RedundancyPair[] } {
  const durationMs = Math.max(1, rec.durationMs);
  const analyses: LaneAnalysis[] = [];

  for (const entry of laneMap.values()) {
    analyses.push(analyzeLane(entry.key, entry.eventIndices, rec.events, noteSpans, durationMs));

    // For each notes lane, emit virtual per-pitch sub-lanes so each drum pad /
    // specific note gets its own rhythm + dynamic score.
    if (entry.key.kind === "notes") {
      const parent = entry.key;
      const channelSpans = noteSpans.filter(
        (s) => s.device === parent.device && s.channel === parent.channel
      );
      analyses.push(...analyzeNoteSubunits(parent, channelSpans, durationMs));
    }
  }

  const pairs = durationMs >= 1000
    ? findRedundantPairs(laneMap, rec.events, durationMs)
    : [];

  return { analyses, pairs };
}

/** One LaneAnalysis per unique pitch within a notes lane. */
function analyzeNoteSubunits(
  parent: LaneKey & { kind: "notes" },
  spans: NoteSpan[],
  durationMs: number
): LaneAnalysis[] {
  const byPitch = new Map<number, NoteSpan[]>();
  for (const s of spans) {
    const list = byPitch.get(s.pitch) ?? [];
    list.push(s);
    byPitch.set(s.pitch, list);
  }

  const durationSec = durationMs / 1000;
  const out: LaneAnalysis[] = [];

  for (const [pitch, pitchSpans] of byPitch) {
    const eventCount = pitchSpans.length;
    if (eventCount < 3) continue; // skip one-offs; they clutter the sidebar
    const eventsPerSec = eventCount / durationSec;

    const onsets = pitchSpans.map((s) => s.tStart).sort((a, b) => a - b);
    const iois = computeIOIs(onsets);
    const ioiHistogram = bucketIOIs(iois);
    const rhythmScore = onsets.length < 4 ? 0 : rhythmScoreFromHistogram(ioiHistogram);

    const velocities = pitchSpans.map((s) => s.velocity / 127);
    const { stdDev, min, max } = stats(velocities);
    const dynamicScore = Math.max(0, Math.min(1, stdDev / 0.25));

    const key: LaneKey = {
      kind: "noteOnPitch",
      device: parent.device,
      channel: parent.channel,
      pitch,
    };

    out.push({
      laneKey: laneKeyString(key),
      eventCount,
      eventsPerSec,
      rhythmScore,
      dynamicScore,
      valueRange: [min, max],
      ioiHistogram,
      isDead: eventCount < 3 || eventsPerSec < 0.05,
    });
  }

  return out;
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

function findRedundantPairs(
  laneMap: LaneMap,
  events: RecordedEvent[],
  durationMs: number
): RedundancyPair[] {
  const binCount = Math.ceil(durationMs / REDUNDANCY_BIN_MS);
  if (binCount < 4) return [];

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
