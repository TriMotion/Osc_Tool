"use client";

import { useMemo } from "react";
import type { NoteSpan } from "@/lib/types";
import { ResizeHandle } from "./resize-handle";

interface NotesLaneProps {
  spans: NoteSpan[];
  viewStartMs: number;
  viewEndMs: number;
  heightPx: number;
  leftGutterPx: number;
  onHover?: (span: NoteSpan | null, clientX: number, clientY: number) => void;
  onResize?: (newHeight: number) => void;
}

/**
 * Piano-roll mini. Notes are positioned by pitch (y) and time (x).
 * Pitch range is auto-fit to the recording's active pitches (for compactness),
 * computed on the full span set.
 */
export function NotesLane({ spans, viewStartMs, viewEndMs, heightPx, leftGutterPx, onHover, onResize }: NotesLaneProps) {
  const { minPitch, maxPitch } = useMemo(() => {
    if (spans.length === 0) return { minPitch: 36, maxPitch: 84 };
    let mn = Infinity, mx = -Infinity;
    for (const s of spans) {
      if (s.pitch < mn) mn = s.pitch;
      if (s.pitch > mx) mx = s.pitch;
    }
    if (mn === mx) { mn = Math.max(0, mn - 6); mx = Math.min(127, mx + 6); }
    return { minPitch: mn, maxPitch: mx };
  }, [spans]);

  const visibleSpans = useMemo(() => {
    // A span is visible if it overlaps [viewStart, viewEnd).
    return spans.filter((s) => s.tEnd >= viewStartMs && s.tStart < viewEndMs);
  }, [spans, viewStartMs, viewEndMs]);

  const viewSpan = viewEndMs - viewStartMs;
  const pitchSpan = Math.max(1, maxPitch - minPitch);

  return (
    <div
      className="relative border-t border-white/5"
      style={{ height: heightPx }}
    >
      <div
        className="absolute left-0 top-0 h-full text-[10px] text-gray-500 px-3 flex items-center border-r border-white/5 z-[2] bg-black/0"
        style={{ width: leftGutterPx }}
      >
        Notes
      </div>
      <div className="absolute top-0 bottom-0" style={{ left: leftGutterPx, right: 0 }}>
        {visibleSpans.map((s, i) => {
          const xStartPct = ((Math.max(s.tStart, viewStartMs) - viewStartMs) / viewSpan) * 100;
          const xEndPct = ((Math.min(s.tEnd, viewEndMs) - viewStartMs) / viewSpan) * 100;
          const widthPct = Math.max(0.15, xEndPct - xStartPct);
          const yPct = (1 - (s.pitch - minPitch) / pitchSpan) * 100;
          return (
            <div
              key={`${s.device}|${s.channel}|${s.pitch}|${s.tStart}|${i}`}
              onMouseEnter={(e) => onHover?.(s, e.clientX, e.clientY)}
              onMouseLeave={() => onHover?.(null, 0, 0)}
              onMouseMove={(e) => onHover?.(s, e.clientX, e.clientY)}
              style={{
                position: "absolute",
                left: `${xStartPct}%`,
                width: `${widthPct}%`,
                top: `calc(${yPct}% - 2px)`,
                height: 3,
                background: velocityColor(s.velocity),
                borderRadius: 1,
              }}
            />
          );
        })}
      </div>
      {onResize && <ResizeHandle currentHeight={heightPx} onResize={onResize} />}
    </div>
  );
}

// Blue (soft) → cyan → green → yellow → red (hard). Hue sweep 210° → 0° over velocity 0..127.
function velocityColor(velocity: number): string {
  const v = Math.max(0, Math.min(127, velocity)) / 127;
  const hue = 210 - v * 210;
  const sat = 80;
  const light = 55 + v * 10; // slightly brighter at higher velocity
  const alpha = 0.55 + v * 0.4;
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
}
