export interface OscMessage {
  address: string;
  args: OscArg[];
  timestamp: number;
  sourceIp?: string;
  sourcePort?: number;
}

export interface OscArg {
  type: "f" | "i" | "s" | "T" | "F";
  value: number | string | boolean;
}

export interface DiagnosticsResult {
  messagesSent: number;
  messagesReceived: number;
  dropRate: number;
  latencyMin: number;
  latencyAvg: number;
  latencyMax: number;
  throughput: number;
}

export interface ListenerConfig {
  port: number;
  bindAddress: string;
}

export interface SenderConfig {
  host: string;
  port: number;
}

export interface SavedEndpoint {
  id: string;
  name: string;
  host: string;
  port: number;
  type: "listener" | "sender";
}

// --- Deck types ---

export interface Deck {
  id: string;
  name: string;
  gridColumns: number;
  gridRows: number;
  pages: DeckPage[];
}

export interface DeckPage {
  id: string;
  name: string;
  items: DeckItem[];
  groups: DeckGroup[];
}

export interface DeckGroup {
  id: string;
  name: string;
  color: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  items: DeckItem[];
}

export interface DeckItem {
  id: string;
  name: string;
  type: "button" | "slider" | "xy-pad";
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  oscAddress: string;
  oscTarget: { host: string; port: number };
  oscTargetEndpointId?: string;
  color: string;
  config: ButtonConfig | SliderConfig | XYPadConfig;
}

export interface ButtonConfig {
  mode: "trigger" | "toggle";
  triggerValue: OscArg;
  toggleOnValue: OscArg;
  toggleOffValue: OscArg;
}

export interface SliderConfig {
  orientation: "horizontal" | "vertical";
  min: number;
  max: number;
  valueType: "f" | "i";
}

export interface XYPadConfig {
  xAddress: string;
  yAddress: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

// --- MIDI types ---

export interface MidiEvent {
  midi: {
    type: "noteon" | "noteoff" | "cc" | "pitch" | "aftertouch" | "program";
    channel: number;     // 1–16
    data1: number;       // note number, CC number, or program number
    data2: number;       // velocity, value, or pressure (0 for 2-byte messages)
    timestamp: number;   // Date.now()
    deviceName: string;
  };
  osc: OscMessage;       // the converted OSC output
}

export interface MidiMappingRule {
  id: string;
  type: "noteon" | "noteoff" | "cc" | "pitch" | "aftertouch" | "program";
  channel?: number;            // 1–16; undefined = any
  data1?: number;              // note or CC number; undefined = any
  address: string;             // OSC address override, e.g. "/fader/master"
  argType: "f" | "i";         // float or int output
  scale?: [number, number];    // output range; default [0, 1]
}

// --- Recording / Timeline types ---

export type RecorderState = "idle" | "recording" | "stopped";

export interface AudioRef {
  filePath: string;
  offsetMs: number;
}

export interface AudioTrack {
  id: string;
  filePath: string;
  offsetMs: number;
  label?: string;
}

export interface RecordedEvent {
  tRel: number;            // ms since Recording.startedAt (not wall-clock)
  midi: MidiEvent["midi"]; // reuses MIDI shape
  osc: OscMessage;         // reuses OSC shape
}

export interface TimelineSection {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  color?: string;
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
  audio?: AudioRef;           // kept for loading old recordings; prefer audioTracks
  audioTracks?: AudioTrack[];
  badges?: LaneBadge[];
  moments?: Moment[];           // user-created; auto-detected moments are not persisted
  sections?: TimelineSection[];
  noteTags?: NoteGroupTag[];
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
    default: {
      const _exhaustive: never = k;
      throw new Error(`Unknown LaneKey kind: ${String(_exhaustive)}`);
    }
  }
}

export interface RecentRecordingEntry {
  path: string;
  name: string;
  savedAt: number;
}

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

/** A point or range of interest in the timeline. */
export interface Moment {
  id: string;
  tMs: number;                  // anchor time
  durationMs?: number;          // if set, this is a range (t..t+duration)
  kind: "drop" | "build" | "peak" | "silence" | "start" | "end" | "user";
  label: string;                // display text
  color?: string;               // user-chosen color for "user" kind; auto ones use kind-based color
  score?: number;               // 0..1 "interestingness" for auto kinds
}

/** A user-applied label on a note group (pitch + optional velocity) within a recording. */
export interface NoteGroupTag {
  id: string;
  device: string;
  pitch: number;
  velocity: number | null;  // null = match all velocities of this pitch
  label: string;
  color?: string;            // CSS color; hash-based fallback at render time
}
