"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteGroupTag } from "@/lib/types";

const SWATCHES: Array<{ name: string; value: string | undefined }> = [
  { name: "auto", value: undefined },
  { name: "blue", value: "#4a7bff" },
  { name: "green", value: "#7dd87d" },
  { name: "pink", value: "#ff6fa3" },
  { name: "orange", value: "#ffb84d" },
  { name: "purple", value: "#b48bff" },
  { name: "gray", value: "#888" },
];

interface NoteTagEditorProps {
  tag: NoteGroupTag | null;
  device: string;
  pitch: number;
  velocity: number;
  existingLabels: string[];
  anchorRect: DOMRect;
  onSave: (tag: NoteGroupTag) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function NoteTagEditor({
  tag, device, pitch, velocity, existingLabels, anchorRect, onSave, onDelete, onClose,
}: NoteTagEditorProps) {
  const [label, setLabel] = useState(tag?.label ?? "");
  const [color, setColor] = useState<string | undefined>(tag?.color);
  const [allVelocities, setAllVelocities] = useState(tag ? tag.velocity === null : true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const suggestions = existingLabels
    .filter((l) => l.toLowerCase().startsWith(label.toLowerCase()) && l.toLowerCase() !== label.toLowerCase())
    .slice(0, 5);

  const handleSave = () => {
    const trimmed = label.trim().slice(0, 24);
    if (!trimmed) return;
    onSave({
      id: tag?.id ?? crypto.randomUUID(),
      device,
      pitch,
      velocity: allVelocities ? null : velocity,
      label: trimmed,
      color,
    });
  };

  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 320);
  const left = Math.min(anchorRect.left, window.innerWidth - 280);

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 bg-surface-light border border-white/10 rounded-lg p-4 shadow-xl"
      style={{ top, left, width: 272 }}
    >
      <h3 className="text-sm font-semibold mb-3">{tag ? "Edit tag" : "Tag this note group"}</h3>

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
        placeholder="Kick, Snare, Hi-hat…"
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

      <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allVelocities}
          onChange={(e) => setAllVelocities(e.target.checked)}
          className="accent-accent"
        />
        <span className="text-[11px] text-gray-400">All velocities of this pitch</span>
      </label>

      <div className="flex justify-between items-center mt-4">
        {onDelete ? (
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-300">
            Delete
          </button>
        ) : (
          <div />
        )}
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
  );
}
