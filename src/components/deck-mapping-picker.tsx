"use client";

import { useState, useMemo } from "react";
import type { OscMapping, NoteGroupTag, LaneBadge } from "@/lib/types";
import { resolveOscAddress } from "@/lib/osc-mapping";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiNoteToName(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

interface DeckMappingPickerProps {
  mappings: OscMapping[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  noteTags?: NoteGroupTag[];
  laneBadges?: LaneBadge[];
  aliases?: Record<string, string>;
}

export function DeckMappingPicker({
  mappings,
  selectedIds,
  onChange,
  noteTags,
  laneBadges,
  aliases,
}: DeckMappingPickerProps) {
  const [noteFilter, setNoteFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [addressFilter, setAddressFilter] = useState("");

  const filtered = useMemo(() => {
    return mappings.filter((m) => {
      if (noteFilter) {
        const lower = noteFilter.toLowerCase();
        if (m.targetType === "noteGroup") {
          const [pitchStr] = m.targetId.split("|");
          const pitch = parseInt(pitchStr, 10);
          const name = midiNoteToName(pitch).toLowerCase();
          if (!name.includes(lower) && !pitchStr.includes(lower)) return false;
        } else {
          return false;
        }
      }
      if (tagFilter) {
        const lower = tagFilter.toLowerCase();
        const matchesNoteTag = noteTags?.some(
          (t) => t.label.toLowerCase().includes(lower) && m.targetType === "noteGroup" && m.targetId.startsWith(`${t.pitch}|`),
        );
        const matchesLaneBadge = laneBadges?.some(
          (b) => b.label.toLowerCase().includes(lower) && m.targetType === "lane" && m.targetId === b.laneKey,
        );
        if (!matchesNoteTag && !matchesLaneBadge) return false;
      }
      if (addressFilter) {
        const address = resolveOscAddress(m, aliases) ?? "";
        if (!address.toLowerCase().includes(addressFilter.toLowerCase())) return false;
      }
      return true;
    });
  }, [mappings, noteFilter, tagFilter, addressFilter, noteTags, laneBadges, aliases]);

  const selectedSet = new Set(selectedIds);

  const toggleMapping = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectAll = () => {
    const allFilteredIds = filtered.map((m) => m.id);
    const merged = new Set([...selectedIds, ...allFilteredIds]);
    onChange(Array.from(merged));
  };

  const deselectAll = () => {
    const filteredSet = new Set(filtered.map((m) => m.id));
    onChange(selectedIds.filter((id) => !filteredSet.has(id)));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="Note..."
          value={noteFilter}
          onChange={(e) => setNoteFilter(e.target.value)}
          className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-deck/40"
        />
        <input
          type="text"
          placeholder="Tag..."
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-deck/40"
        />
        <input
          type="text"
          placeholder="Address..."
          value={addressFilter}
          onChange={(e) => setAddressFilter(e.target.value)}
          className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-deck/40"
        />
      </div>

      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <span>{filtered.length} mapping{filtered.length !== 1 ? "s" : ""}</span>
        <div className="flex gap-2">
          <button onClick={selectAll} className="hover:text-gray-300 transition-colors">Select all</button>
          <button onClick={deselectAll} className="hover:text-gray-300 transition-colors">Deselect all</button>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto border border-white/5 rounded">
        {filtered.map((m) => {
          const checked = selectedSet.has(m.id);
          const device = aliases?.[m.deviceId] ?? m.deviceId;
          const address = resolveOscAddress(m, aliases) ?? "(no address)";
          let target = m.targetId;
          if (m.targetType === "noteGroup") {
            const [pitchStr, velStr] = m.targetId.split("|");
            target = `${midiNoteToName(parseInt(pitchStr, 10))} v${velStr}`;
          }
          return (
            <label
              key={m.id}
              className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-white/5 transition-colors ${
                checked ? "text-gray-200" : "text-gray-500"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleMapping(m.id)}
                className="accent-deck"
              />
              <span className="truncate flex-1">
                <span className="text-gray-400">{device}</span>
                {" "}
                <span>{target}</span>
                {" "}
                <span className="text-gray-600">&rarr; {address}</span>
              </span>
            </label>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-xs text-gray-600 text-center py-3">No mappings match filters</div>
        )}
      </div>
    </div>
  );
}
