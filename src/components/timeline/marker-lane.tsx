"use client";

import { useEffect, useRef, useState } from "react";
import type { Moment } from "@/lib/types";

export const MARKER_DEFAULT_COLOR = "#c7f168";

const MARKER_COLORS = [
  "#c7f168", // lime
  "#f16868", // red
  "#f1a068", // orange
  "#f1e068", // yellow
  "#68f1c7", // mint
  "#68c7f1", // sky
  "#a868f1", // violet
  "#f168c7", // pink
  "#ffffff", // white
];

interface MarkerLaneProps {
  markers: Moment[];
  viewStartMs: number;
  viewEndMs: number;
  leftGutterPx: number;
  onAdd: (tMs: number) => void;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onColorChange: (id: string, color: string) => void;
  onSeek: (ms: number) => void;
  onClearSystem?: () => void;
}

export function MarkerLane({
  markers, viewStartMs, viewEndMs, leftGutterPx,
  onAdd, onRename, onDelete, onColorChange, onSeek, onClearSystem,
}: MarkerLaneProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editColor, setEditColor] = useState(MARKER_DEFAULT_COLOR);

  const viewSpan = Math.max(1, viewEndMs - viewStartMs);

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (editingId) { setEditingId(null); return; }
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const tMs = viewStartMs + ((e.clientX - rect.left) / rect.width) * viewSpan;
    onAdd(tMs);
  };

  const startEdit = (m: Moment, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(m.id);
    setEditValue(m.label);
    setEditColor(m.color ?? MARKER_DEFAULT_COLOR);
    onSeek(m.tMs);
  };

  const commitEdit = () => {
    if (editingId) {
      onRename(editingId, editValue.trim() || "Marker");
      setEditingId(null);
    }
  };

  const handleColorChange = (id: string, color: string) => {
    setEditColor(color);
    onColorChange(id, color);
  };

  const systemCount = markers.filter((m) => m.kind !== "user").length;

  return (
    <div className="relative flex border-b border-white/5 select-none" style={{ height: 24 }}>
      {/* Gutter */}
      <div
        className="group/gutter text-[10px] text-gray-600 px-3 flex items-center gap-2 border-r border-white/5 shrink-0"
        style={{ width: leftGutterPx }}
      >
        <span>Markers</span>
        {onClearSystem && systemCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onClearSystem(); }}
            className="opacity-0 group-hover/gutter:opacity-100 transition-opacity text-[9px] text-gray-600 hover:text-red-400"
            title={`Remove ${systemCount} system-generated marker${systemCount === 1 ? "" : "s"}`}
          >
            ✕ {systemCount}
          </button>
        )}
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative flex-1 overflow-visible cursor-crosshair"
        onClick={handleTrackClick}
      >
        {markers.map((m) => {
          const leftPct = ((m.tMs - viewStartMs) / viewSpan) * 100;
          if (leftPct < -2 || leftPct > 102) return null;
          const color = editingId === m.id ? editColor : (m.color ?? MARKER_DEFAULT_COLOR);
          const isEditing = editingId === m.id;

          return (
            <div
              key={m.id}
              className="absolute top-0 bottom-0 group"
              style={{ left: `${leftPct}%`, zIndex: isEditing ? 50 : 1 }}
            >
              {/* Triangle head + label row */}
              <div
                className="absolute top-0 flex items-center gap-1 pl-1"
                style={{ transform: "translateX(-4px)" }}
              >
                {/* Downward triangle */}
                <div
                  className="shrink-0"
                  style={{
                    width: 0, height: 0,
                    borderLeft: "4px solid transparent",
                    borderRight: "4px solid transparent",
                    borderTop: `7px solid ${color}`,
                    cursor: "pointer",
                  }}
                  onClick={(e) => startEdit(m, e)}
                />

                {/* X button on hover */}
                {!isEditing && (
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-gray-600 hover:text-red-400 leading-none"
                    onClick={(e) => { e.stopPropagation(); onDelete(m.id); }}
                    title="Delete marker"
                  >
                    ✕
                  </button>
                )}

                {/* Label or inline rename */}
                {isEditing ? (
                  <InlineInput
                    value={editValue}
                    onChange={setEditValue}
                    onCommit={commitEdit}
                    onCancel={() => setEditingId(null)}
                    color={color}
                    onDelete={() => { onDelete(m.id); setEditingId(null); }}
                    onColorChange={(c) => handleColorChange(m.id, c)}
                  />
                ) : (
                  <button
                    className="text-[10px] font-medium whitespace-nowrap leading-none opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                    style={{ color }}
                    onClick={(e) => startEdit(m, e)}
                  >
                    {m.label}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface InlineInputProps {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
  color: string;
}

function InlineInput({ value, onChange, onCommit, onCancel, onDelete, onColorChange, color }: InlineInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      className="relative flex flex-col gap-1.5 border border-white/15 rounded px-1.5 py-1"
      style={{ zIndex: 50, background: "#0f0f1e", boxShadow: "0 8px 24px rgba(0,0,0,0.85)" }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onCancel();
          }}
          className="bg-transparent border-none outline-none text-[10px] font-medium w-24"
          style={{ color }}
        />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-[9px] text-gray-600 hover:text-red-400 transition-colors leading-none shrink-0"
        >
          ✕
        </button>
      </div>
      <div className="flex gap-1">
        {MARKER_COLORS.map((c) => (
          <button
            key={c}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onColorChange(c); }}
            className="rounded-full shrink-0 transition-transform hover:scale-125"
            style={{
              width: 10, height: 10,
              background: c,
              outline: c === color ? `2px solid ${c}` : "none",
              outlineOffset: 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}
