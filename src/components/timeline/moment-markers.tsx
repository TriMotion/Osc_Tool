"use client";

import type { Moment } from "@/lib/types";
import { momentColor } from "@/lib/moment-detection";

interface MomentMarkersProps {
  moments: Moment[];
  viewStartMs: number;
  viewEndMs: number;
  leftGutterPx: number;
  onSelect: (m: Moment) => void;
  heightPx?: number;
}

/**
 * Renders a horizontal strip of colored ticks (or shaded bands for range moments)
 * positioned by each moment's time. Sits directly under the TimeRuler.
 */
export function MomentMarkers({
  moments, viewStartMs, viewEndMs, leftGutterPx, onSelect, heightPx = 18,
}: MomentMarkersProps) {
  const viewSpan = Math.max(1, viewEndMs - viewStartMs);

  return (
    <div
      className="relative border-b border-white/5 bg-black/20 flex-shrink-0"
      style={{ height: heightPx }}
    >
      <div
        className="absolute left-0 top-0 h-full text-[9px] text-gray-600 px-3 flex items-center border-r border-white/5"
        style={{ width: leftGutterPx }}
      >
        Moments
      </div>
      <div className="absolute top-0 bottom-0" style={{ left: leftGutterPx, right: 0 }}>
        {moments.map((m) => {
          const x = ((m.tMs - viewStartMs) / viewSpan) * 100;
          if (x < -2 || x > 102) return null;
          const color = m.color ?? momentColor(m.kind);
          if (m.durationMs) {
            const widthPct = (m.durationMs / viewSpan) * 100;
            return (
              <button
                key={m.id}
                onClick={() => onSelect(m)}
                title={`${m.label} @ ${fmt(m.tMs)}`}
                className="absolute rounded-sm hover:brightness-125"
                style={{
                  left: `${x}%`,
                  width: `${Math.max(0.5, widthPct)}%`,
                  top: 3,
                  bottom: 3,
                  background: `${color}33`,
                  border: `1px solid ${color}`,
                }}
              >
                <span className="text-[8px] text-white/90 font-medium px-1 whitespace-nowrap">
                  {m.label}
                </span>
              </button>
            );
          }
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m)}
              title={`${m.label} @ ${fmt(m.tMs)}`}
              className="absolute group"
              style={{
                left: `${x}%`,
                top: 0,
                bottom: 0,
                transform: "translateX(-50%)",
              }}
            >
              <div
                className="w-2 h-2 rounded-full mt-1 hover:scale-150 transition-transform"
                style={{ background: color }}
              />
              <span
                className="hidden group-hover:inline-block absolute left-3 top-0 text-[9px] text-white/90 font-medium whitespace-nowrap pointer-events-none"
                style={{ background: "#0f1117", padding: "1px 4px", borderRadius: 2 }}
              >
                {m.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}
