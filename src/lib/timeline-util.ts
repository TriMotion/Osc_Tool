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
        push({ kind: "notes", device, channel: m.channel }, i);
        break;
      case "cc":
        push({ kind: "cc", device, channel: m.channel, cc: m.data1 }, i);
        break;
      case "pitch":
        push({ kind: "pitch", device, channel: m.channel }, i);
        break;
      case "aftertouch":
        // MidiManager.parseMessage sets data2 === 0 for channel aftertouch
        // (data1 carries the pressure). Poly aftertouch has data1=note, data2=pressure.
        // Edge case: poly AT at pressure=0 is misclassified as channel AT here.
        // Documented v1 limitation — see design spec.
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
 * Normalize a MIDI event's value. For most types, 0..127 → 0..1.
 * For pitch, (data1+data2) 14-bit signed → -1..+1.
 * For channel aftertouch (data2 === 0), data1 is the pressure.
 *
 * Known limitation: poly aftertouch where pressure is exactly 0 is
 * indistinguishable from channel aftertouch at this level (both have
 * data2 === 0 as emitted by MidiManager.parseMessage). Such events are
 * treated as channel aftertouch. This is a v1 simplification documented
 * in the design spec.
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
 * producing (minY, maxY) per column. Columns with no events return null.
 *
 * Caller supplies a valueFn that returns the value to bucket (typically
 * in 0..1 space; pitch lanes rescale -1..+1 → 0..1 before passing here).
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
    const end = Math.min(samples.length, Math.ceil((col + 1) * samplesPerPx));
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
  if (!isFinite(ms)) return "--:--.---";
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  const mmm = Math.floor(abs % 1000).toString().padStart(3, "0");
  return `${sign}${mm}:${ss}.${mmm}`;
}
