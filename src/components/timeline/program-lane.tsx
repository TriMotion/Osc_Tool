"use client";

import { useMemo } from "react";
import type { LaneAnalysis, LaneBadge, RecordedEvent } from "@/lib/types";
import { ResizeHandle } from "./resize-handle";
import { LaneBadges } from "./lane-badges";

interface ProgramLaneProps {
  label: string;
  sublabel?: string;
  events: RecordedEvent[];
  eventIndices: number[];
  viewStartMs: number;
  viewEndMs: number;
  heightPx: number;
  leftGutterPx: number;
  onHover?: (evt: RecordedEvent | null, clientX: number, clientY: number) => void;
  onResize?: (newHeight: number) => void;
  laneKey: string;
  analysis?: LaneAnalysis;
  userBadges?: LaneBadge[];
  onRequestAddBadge?: (laneKey: string) => void;
  onEditBadge?: (badge: LaneBadge) => void;
  isFlashing?: boolean;
}

export function ProgramLane(props: ProgramLaneProps) {
  const {
    label, sublabel, events, eventIndices,
    viewStartMs, viewEndMs, heightPx, leftGutterPx,
    onHover, onResize, laneKey, analysis, userBadges,
    onRequestAddBadge, onEditBadge, isFlashing,
  } = props;

  const visible = useMemo(() => {
    if (eventIndices.length === 0) return [];
    const subset = eventIndices;
    let lo = 0, hi = subset.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[subset[mid]].tRel < viewStartMs) lo = mid + 1;
      else hi = mid;
    }
    const start = lo;
    lo = 0; hi = subset.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[subset[mid]].tRel < viewEndMs) lo = mid + 1;
      else hi = mid;
    }
    return subset.slice(start, lo);
  }, [eventIndices, events, viewStartMs, viewEndMs]);

  const viewSpan = Math.max(1, viewEndMs - viewStartMs);

  return (
    <div
      className={`relative border-t border-white/5 flex ${isFlashing ? "ring-1 ring-accent/60" : ""}`}
      style={{ height: heightPx }}
    >
      <div
        className="text-[10px] text-gray-500 px-3 py-1 border-r border-white/5 flex flex-col justify-center overflow-hidden"
        style={{ width: leftGutterPx, flexShrink: 0 }}
      >
        <span className="truncate">{label}</span>
        {sublabel && <span className="text-gray-700 text-[9px] truncate">{sublabel}</span>}
        <LaneBadges
          analysis={analysis}
          userBadges={userBadges}
          onAddClick={() => onRequestAddBadge?.(laneKey)}
          onBadgeClick={(b) => onEditBadge?.(b)}
        />
      </div>
      <div className="flex-1 relative">
        {visible.map((idx) => {
          const e = events[idx];
          const pct = ((e.tRel - viewStartMs) / viewSpan) * 100;
          return (
            <div
              key={idx}
              onMouseEnter={(ev) => onHover?.(e, ev.clientX, ev.clientY)}
              onMouseLeave={() => onHover?.(null, 0, 0)}
              style={{
                position: "absolute",
                left: `${pct}%`,
                top: "50%",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#ff9e57",
                transform: "translate(-50%, -50%)",
              }}
            />
          );
        })}
      </div>
      {onResize && <ResizeHandle currentHeight={heightPx} onResize={onResize} />}
    </div>
  );
}
