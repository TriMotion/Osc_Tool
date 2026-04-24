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
    <div className="fixed inset-0 bg-black flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-panel border border-white/[0.06] rounded-lg p-4 w-72 shadow-xl"
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
          className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-sm focus:outline-none focus:border-timeline/18"
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
              className="px-3 py-1 text-xs bg-timeline/20 text-timeline border border-timeline/30 hover:bg-timeline/30 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
