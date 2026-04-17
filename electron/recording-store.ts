import { app, dialog, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { parseMidi } from "midi-file";
import { Recording, RecentRecordingEntry, RecordedEvent, MidiEvent, OscArg, OscMessage } from "../src/lib/types";

const RECENT_LIMIT = 10;
const STREAM_SERIALIZE_THRESHOLD = 50 * 1024 * 1024; // 50 MB
const AUDIO_FILTERS = [
  { name: "Audio", extensions: ["wav", "mp3", "ogg", "flac", "m4a", "aac"] },
];
const OSCREC_FILTERS = [
  { name: "Oscilot Recording", extensions: ["oscrec"] },
];
const MIDI_FILTERS = [
  { name: "Standard MIDI File", extensions: ["mid", "midi"] },
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
    const options = {
      title: "Save Recording",
      defaultPath: suggested,
      filters: OSCREC_FILTERS,
    };
    const result = await (win
      ? dialog.showSaveDialog(win, options)
      : dialog.showSaveDialog(options));
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
    // Serialize everything except events, then append events manually as the last field.
    const fd = fs.openSync(filePath, "w");
    try {
      const { events, ...rest } = rec;
      const restJson = JSON.stringify(rest, null, 2);
      // restJson ends with "\n}". Strip the closing "\n}" so we can append more fields.
      const base = restJson.endsWith("\n}")
        ? restJson.slice(0, -2)
        : restJson.slice(0, restJson.lastIndexOf("}"));
      fs.writeSync(fd, base + ',\n  "events": [\n');
      for (let i = 0; i < events.length; i++) {
        const sep = i === events.length - 1 ? "\n" : ",\n";
        fs.writeSync(fd, "    " + JSON.stringify(events[i]) + sep);
      }
      fs.writeSync(fd, "  ]\n}\n");
    } finally {
      fs.closeSync(fd);
    }
  }

  async loadDialog(win: BrowserWindow | null): Promise<
    { recording: Recording; path: string } | { cancelled: true }
  > {
    const options = {
      title: "Open Recording",
      filters: OSCREC_FILTERS,
      properties: ["openFile"],
    };
    const result = await (win
      ? dialog.showOpenDialog(win, options)
      : dialog.showOpenDialog(options));
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
    const options = {
      title: "Load Audio File",
      filters: AUDIO_FILTERS,
      properties: ["openFile"],
    };
    const result = await (win
      ? dialog.showOpenDialog(win, options)
      : dialog.showOpenDialog(options));
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    return { path: result.filePaths[0] };
  }

  readAudioBytes(filePath: string): { bytes: ArrayBuffer; mimeType: string } {
    const buf = fs.readFileSync(filePath);
    // Transferring Buffer over IPC serializes to a Uint8Array; callers convert to ArrayBuffer.
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return { bytes: ab, mimeType: mimeFor(filePath) };
  }

  async importMidiDialog(win: BrowserWindow | null): Promise<
    { recording: Recording; path: string } | { cancelled: true }
  > {
    const options = {
      title: "Import MIDI File",
      filters: MIDI_FILTERS,
      properties: ["openFile"],
    };
    const result = await (win
      ? dialog.showOpenDialog(win, options)
      : dialog.showOpenDialog(options));
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    const filePath = result.filePaths[0];
    const recording = this.importSmf(filePath);
    return { recording, path: filePath };
  }

  importSmf(filePath: string): Recording {
    const bytes = fs.readFileSync(filePath);
    const parsed = parseMidi(bytes);
    const division = (parsed.header as { ticksPerBeat?: number }).ticksPerBeat ?? 480;

    // First pass: build a global tempo map keyed by absolute tick.
    type TempoPoint = { tick: number; microsPerQuarter: number };
    const tempoMap: TempoPoint[] = [{ tick: 0, microsPerQuarter: 500_000 }]; // 120 BPM default
    for (const track of parsed.tracks) {
      let tick = 0;
      for (const e of track) {
        tick += e.deltaTime;
        if (e.type === "setTempo" && typeof (e as { microsecondsPerBeat?: number }).microsecondsPerBeat === "number") {
          tempoMap.push({ tick, microsPerQuarter: (e as { microsecondsPerBeat: number }).microsecondsPerBeat });
        }
      }
    }
    tempoMap.sort((a, b) => a.tick - b.tick);
    // Collapse duplicates (keep latest at each tick).
    for (let i = tempoMap.length - 2; i >= 0; i--) {
      if (tempoMap[i].tick === tempoMap[i + 1].tick) tempoMap.splice(i, 1);
    }

    const tickToMs = buildTickToMs(tempoMap, division);

    const deviceName = path.basename(filePath);
    const recordedEvents: RecordedEvent[] = [];

    for (const track of parsed.tracks) {
      let tick = 0;
      for (const e of track) {
        tick += e.deltaTime;
        const converted = convertSmfEvent(e, tick, tickToMs, deviceName);
        if (converted) recordedEvents.push(converted);
      }
    }

    recordedEvents.sort((a, b) => a.tRel - b.tRel);
    const durationMs = recordedEvents.length > 0
      ? recordedEvents[recordedEvents.length - 1].tRel
      : 0;

    const rec: Recording = {
      version: 1,
      id: crypto.randomUUID(),
      name: path.basename(filePath, path.extname(filePath)),
      startedAt: Date.now(),
      durationMs,
      events: recordedEvents,
      devices: recordedEvents.length > 0 ? [deviceName] : [],
      mappingRulesSnapshot: [],
      audio: undefined,
    };
    return rec;
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

/**
 * Build a tick→ms converter from an ordered tempo map.
 * Each tempo segment contributes (ticks × microsPerQuarter / division) microseconds.
 */
function buildTickToMs(
  tempoMap: Array<{ tick: number; microsPerQuarter: number }>,
  division: number
): (tick: number) => number {
  return (absTick: number): number => {
    let ms = 0;
    for (let i = 0; i < tempoMap.length; i++) {
      const seg = tempoMap[i];
      const next = tempoMap[i + 1];
      const segStart = seg.tick;
      const segEnd = next ? next.tick : Infinity;
      if (absTick <= segStart) break;
      const ticksInSeg = Math.min(absTick, segEnd) - segStart;
      ms += (ticksInSeg * seg.microsPerQuarter) / division / 1000;
      if (absTick <= segEnd) break;
    }
    return ms;
  };
}

/**
 * Convert a single parsed SMF event into a RecordedEvent, synthesizing the OSC
 * output via the same auto-map scheme used by MidiManager (so imported takes
 * render in the same lanes as recorded ones).
 * Returns null for events we don't surface on the timeline (meta, sysex, tempo, etc.).
 */
function convertSmfEvent(
  e: { type: string; deltaTime: number; [k: string]: unknown },
  absTick: number,
  tickToMs: (t: number) => number,
  deviceName: string
): RecordedEvent | null {
  const tRel = tickToMs(absTick);
  const ts = Date.now(); // informational only — relative timing is what matters
  const channel1 = typeof e.channel === "number" ? (e.channel + 1) : 1;

  const make = (
    midiType: MidiEvent["midi"]["type"],
    data1: number,
    data2: number,
    oscAddress: string,
    oscArg: OscArg
  ): RecordedEvent => {
    const osc: OscMessage = { address: oscAddress, args: [oscArg], timestamp: ts };
    return {
      tRel,
      midi: { type: midiType, channel: channel1, data1, data2, timestamp: ts, deviceName },
      osc,
    };
  };

  switch (e.type) {
    case "noteOn": {
      const note = e.noteNumber as number;
      const vel = e.velocity as number;
      if (vel === 0) {
        return make("noteoff", note, 0, `/midi/ch${channel1}/note/${note}/off`, { type: "f", value: 0 });
      }
      return make("noteon", note, vel, `/midi/ch${channel1}/note/${note}/on`, { type: "f", value: vel / 127 });
    }
    case "noteOff": {
      const note = e.noteNumber as number;
      const vel = (e.velocity as number) ?? 0;
      return make("noteoff", note, vel, `/midi/ch${channel1}/note/${note}/off`, { type: "f", value: vel / 127 });
    }
    case "controller": {
      const num = e.controllerType as number;
      const val = e.value as number;
      return make("cc", num, val, `/midi/ch${channel1}/cc/${num}`, { type: "f", value: val / 127 });
    }
    case "pitchBend": {
      // midi-file gives `value` in range [-8192, 8191].
      const raw = (e.value as number) ?? 0;
      const unsigned = raw + 8192; // 0..16383
      const lsb = unsigned & 0x7f;
      const msb = (unsigned >> 7) & 0x7f;
      return make("pitch", lsb, msb, `/midi/ch${channel1}/pitch`, { type: "f", value: raw / 8192 });
    }
    case "programChange": {
      const prog = e.programNumber as number;
      return make("program", prog, 0, `/midi/ch${channel1}/program`, { type: "i", value: prog });
    }
    case "channelAftertouch": {
      const pressure = e.amount as number;
      return make("aftertouch", pressure, 0, `/midi/ch${channel1}/aftertouch`, { type: "f", value: pressure / 127 });
    }
    case "noteAftertouch": {
      const note = e.noteNumber as number;
      const pressure = e.amount as number;
      return make("aftertouch", note, pressure, `/midi/ch${channel1}/aftertouch/${note}`, { type: "f", value: pressure / 127 });
    }
    default:
      return null;
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
  if ((r as { moments?: unknown }).moments !== undefined) {
    const mm = (r as { moments?: unknown[] }).moments;
    if (!Array.isArray(mm)) throw new Error("Recording.moments must be an array");
    for (let i = 0; i < mm.length; i++) {
      const m = mm[i] as Partial<{ id: string; tMs: number; kind: string; label: string }>;
      if (typeof m.id !== "string") throw new Error(`Recording.moments[${i}].id must be a string`);
      if (typeof m.tMs !== "number") throw new Error(`Recording.moments[${i}].tMs must be a number`);
      if (typeof m.kind !== "string") throw new Error(`Recording.moments[${i}].kind must be a string`);
      if (typeof m.label !== "string") throw new Error(`Recording.moments[${i}].label must be a string`);
    }
  }
  return r as Recording;
}
