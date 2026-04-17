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
      // Replace the trailing `  "events": []` with an opening `  "events": [\n`.
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
