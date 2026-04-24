"use client";

import type { DmxSegment, CurveDefinition } from "@/lib/dmx-types";

interface SegmentStripProps {
  segments: DmxSegment[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
}

function segmentLabel(seg: DmxSegment): string {
  if (seg.curve.type === "snap" && seg.durationMs === 0) return "Snap";
  if (seg.holdMs > 0 && seg.durationMs === 0) return "Hold";
  const curve = seg.curve.type.charAt(0).toUpperCase() + seg.curve.type.slice(1);
  return `${curve} ${seg.startValue}→${seg.endValue}`;
}

function totalDuration(seg: DmxSegment): number {
  return seg.durationMs + seg.holdMs;
}

export function SegmentStrip({ segments, selectedIndex, onSelect, onAdd, onDelete }: SegmentStripProps) {
  const total = segments.reduce((s, seg) => s + Math.max(1, totalDuration(seg)), 0);

  return (
    <div>
      <div className="text-[10px] uppercase text-gray-500 mb-1">Segments</div>
      <div className="flex gap-0.5 bg-[#0a0a1a] rounded p-1 border border-white/5">
        {segments.map((seg, i) => {
          const flex = Math.max(1, totalDuration(seg)) / Math.max(1, total);
          const selected = i === selectedIndex;
          return (
            <button
              key={i}
              className="rounded px-2 py-1.5 text-left border min-w-0"
              style={{
                flex,
                background: selected ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.02)",
                borderColor: selected ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.05)",
              }}
              onClick={() => onSelect(i)}
            >
              <div className="text-[10px] font-bold truncate" style={{ color: selected ? "#fcd34d" : "#9ca3af" }}>
                {segmentLabel(seg)}
              </div>
              <div className="text-[9px] text-gray-600 truncate">
                {seg.durationMs}ms{seg.holdMs > 0 ? ` + ${seg.holdMs}ms hold` : ""}
              </div>
            </button>
          );
        })}
        <button
          className="flex items-center justify-center rounded border border-dashed border-white/10 px-2 shrink-0"
          onClick={onAdd}
        >
          <span className="text-gray-500 text-sm">+</span>
        </button>
      </div>
      {segments.length > 1 && (
        <button
          className="text-[9px] text-red-400/60 hover:text-red-400 mt-1"
          onClick={() => onDelete(selectedIndex)}
        >
          Delete segment {selectedIndex + 1}
        </button>
      )}
    </div>
  );
}
