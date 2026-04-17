"use client";

import { useMemo } from "react";
import type { LaneAnalysis, LaneBadge, NoteSpan } from "@/lib/types";
import { ResizeHandle } from "./resize-handle";
import { LaneBadges } from "./lane-badges";
import { PitchSparkline } from "./pitch-sparkline";

interface NotesLaneProps {
  laneKey: string;
  spans: NoteSpan[];
  viewStartMs: number;
  viewEndMs: number;
  heightPx: number;
  leftGutterPx: number;
  onHover?: (span: NoteSpan | null, clientX: number, clientY: number) => void;
  onResize?: (newHeight: number) => void;
  analysis?: LaneAnalysis;
  userBadges?: LaneBadge[];
  onRequestAddBadge?: (laneKey: string) => void;
  onEditBadge?: (badge: LaneBadge) => void;
  isFlashing?: boolean;
}

export function NotesLane(props: NotesLaneProps) {
  const {
    laneKey, spans, viewStartMs, viewEndMs, heightPx, leftGutterPx,
    onHover, onResize, analysis, userBadges, onRequestAddBadge, onEditBadge, isFlashing,
  } = props;

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
    return spans.filter((s) => s.tEnd >= viewStartMs && s.tStart < viewEndMs);
  }, [spans, viewStartMs, viewEndMs]);

  const viewSpan = viewEndMs - viewStartMs;
  const pitchSpan = Math.max(1, maxPitch - minPitch);

  return (
    <div
      className={`relative border-t border-white/5 ${isFlashing ? "ring-1 ring-accent/60" : ""}`}
      style={{ height: heightPx }}
    >
      <div
        className="absolute left-0 top-0 h-full text-[10px] text-gray-500 px-3 flex flex-col justify-center gap-0.5 border-r border-white/5 z-[2] bg-black/0 overflow-hidden"
        style={{ width: leftGutterPx }}
      >
        <div className="flex items-center gap-2">
          <span>Notes</span>
          {analysis?.pitchContour && analysis.pitchRange && (
            <PitchSparkline contour={analysis.pitchContour} pitchRange={analysis.pitchRange} width={60} height={12} />
          )}
        </div>
        <LaneBadges
          analysis={analysis}
          userBadges={userBadges}
          onAddClick={() => onRequestAddBadge?.(laneKey)}
          onBadgeClick={(b) => onEditBadge?.(b)}
        />
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
                height: 4,
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

// Discrete velocity bands — distinct saturated colors.
function velocityColor(velocity: number): string {
  const v = Math.max(0, Math.min(127, velocity));
  if (v <= 20)  return "rgba(74, 123, 255, 0.75)";
  if (v <= 50)  return "rgba(0, 212, 255, 0.80)";
  if (v <= 80)  return "rgba(125, 216, 125, 0.85)";
  if (v <= 110) return "rgba(255, 184, 77, 0.90)";
  return "rgba(255, 74, 74, 0.95)";
}
