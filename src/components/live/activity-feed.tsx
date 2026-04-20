"use client";

import type { ActivityEntry, MidiEvent, SavedEndpoint } from "@/lib/types";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiNoteToName(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function formatEvent(eventType: MidiEvent["midi"]["type"], data1: number, data2: number): string {
  switch (eventType) {
    case "noteon":    return `Note On  ${midiNoteToName(data1)}  vel ${data2}`;
    case "noteoff":   return `Note Off ${midiNoteToName(data1)}`;
    case "cc":        return `CC ${data1}  val ${data2}`;
    case "pitch":     return `Pitch  ${data2}`;
    case "aftertouch": return `AT  ${data2}`;
    case "program":   return `Prog ${data1}`;
    default:          return `${eventType} ${data1}`;
  }
}

interface ActivityRowProps {
  entry: ActivityEntry;
  endpoints: SavedEndpoint[];
  aliases?: Record<string, string>;
}

function ActivityRow({ entry, endpoints, aliases }: ActivityRowProps) {
  const isMapped = entry.mapping !== null;
  const endpoint = isMapped ? endpoints.find((e) => e.id === entry.endpointId) : null;
  const displayDevice = aliases?.[entry.device] ?? entry.device;
  const time = new Date(entry.wallMs).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      className={`flex items-center gap-3 px-4 py-1.5 text-xs border-b border-white/5 font-mono ${
        isMapped ? "text-gray-200" : "text-gray-600"
      }`}
    >
      <span className="shrink-0 w-16 text-gray-600">{time}</span>
      <span className="shrink-0 w-32 truncate text-gray-400">{displayDevice}</span>
      <span className="shrink-0 w-40">{formatEvent(entry.eventType, entry.data1, entry.data2)}</span>
      {isMapped && entry.address && (
        <>
          <span className="text-white/20 shrink-0">→</span>
          <span className="text-accent shrink-0 truncate max-w-[200px]">{entry.address}</span>
          {endpoint && (
            <span className="text-gray-500 shrink-0">
              {endpoint.host}:{endpoint.port}
            </span>
          )}
          {entry.value !== null && (
            <span className="text-gray-500 shrink-0">
              {entry.argType === "f" ? entry.value.toFixed(3) : entry.value}
            </span>
          )}
        </>
      )}
    </div>
  );
}

interface ActivityFeedProps {
  entries: ActivityEntry[];
  showUnmapped: boolean;
  onToggleUnmapped: (v: boolean) => void;
  endpoints: SavedEndpoint[];
  aliases?: Record<string, string>;
}

export function ActivityFeed({
  entries,
  showUnmapped,
  onToggleUnmapped,
  endpoints,
  aliases,
}: ActivityFeedProps) {
  const visible = showUnmapped ? entries : entries.filter((e) => e.mapping !== null);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0">
        <span className="text-xs font-medium text-gray-400">Activity</span>
        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showUnmapped}
            onChange={(e) => onToggleUnmapped(e.target.checked)}
            className="accent-accent"
          />
          Show unmapped events
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-600">
            {entries.length === 0 ? "Waiting for MIDI input…" : "No mapped events yet"}
          </div>
        ) : (
          visible.map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              endpoints={endpoints}
              aliases={aliases}
            />
          ))
        )}
      </div>
    </div>
  );
}
