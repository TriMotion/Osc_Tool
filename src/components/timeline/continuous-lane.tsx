"use client";

import { useEffect, useRef } from "react";
import type { LaneAnalysis, LaneBadge, OscMapping, RecordedEvent } from "@/lib/types";
import { bucketContinuous, eventValue } from "@/lib/timeline-util";
import { ResizeHandle } from "./resize-handle";
import { LaneBadges } from "./lane-badges";

interface ContinuousLaneProps {
  label: string;              // e.g. "CC 7 · ch1"
  sublabel?: string;          // e.g. "/fader/master"
  events: RecordedEvent[];    // full buffer
  eventIndices: number[];     // indices into events belonging to this lane
  viewStartMs: number;
  viewEndMs: number;
  heightPx: number;
  leftGutterPx: number;
  /** Map raw value into 0..1 lane space. Default: identity (clamped) for 0..1 values; pitch is -1..1 → 0..1. */
  valueMapper?: (v: number) => number;
  color?: string;             // stroke color
  fill?: string;              // fill under curve
  bufferVersion?: number;     // triggers redraw during recording
  onHover?: (evt: RecordedEvent | null, clientX: number, clientY: number) => void;
  onResize?: (newHeight: number) => void;
  laneKey: string;
  analysis?: LaneAnalysis;
  userBadges?: LaneBadge[];
  onRequestAddBadge?: (laneKey: string) => void;
  onEditBadge?: (badge: LaneBadge) => void;
  onDeleteBadge?: (id: string) => void;
  suppressedAnalysisTypes?: Set<"rhythm" | "dynamic" | "melody">;
  onSuppressAnalysisBadge?: (type: "rhythm" | "dynamic" | "melody") => void;
  isFlashing?: boolean;
  onHide?: () => void;
  onRequestOscEditor?: (targetId: string, anchorRect: DOMRect) => void;
  mapping?: OscMapping | null;
  onOpenMapping?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export function ContinuousLane({
  label,
  sublabel,
  events,
  eventIndices,
  viewStartMs,
  viewEndMs,
  heightPx,
  leftGutterPx,
  valueMapper,
  color = "#c7f168",
  fill = "rgba(199,241,104,0.10)",
  bufferVersion,
  onHover,
  onResize,
  laneKey,
  analysis,
  userBadges,
  onRequestAddBadge,
  onEditBadge,
  onDeleteBadge,
  suppressedAnalysisTypes,
  onSuppressAnalysisBadge,
  isFlashing,
  onHide,
  onRequestOscEditor,
  mapping,
  onOpenMapping,
}: ContinuousLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const map = valueMapper ?? ((v: number) => Math.max(0, Math.min(1, v)));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const pixelCount = width;
    const buckets = bucketContinuous(
      events,
      eventIndices,
      viewStartMs,
      viewEndMs,
      pixelCount,
      (e) => map(eventValue(e))
    );

    // Fill under curve — one closed path per contiguous data segment to avoid bridging gaps
    ctx.fillStyle = fill;
    let inSeg = false;
    for (let i = 0; i < pixelCount; i++) {
      const b = buckets[i];
      if (!b) {
        if (inSeg) {
          ctx.lineTo(i - 1, height);
          ctx.closePath();
          ctx.fill();
          inSeg = false;
        }
        continue;
      }
      if (!inSeg) {
        ctx.beginPath();
        ctx.moveTo(i, height);
        inSeg = true;
      }
      ctx.lineTo(i, height - b.max * height);
    }
    if (inSeg) {
      ctx.lineTo(pixelCount - 1, height);
      ctx.closePath();
      ctx.fill();
    }

    // Stroke — restart path on every gap so segments never connect across empty regions
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let prevHadData = false;
    for (let i = 0; i < pixelCount; i++) {
      const b = buckets[i];
      if (!b) { prevHadData = false; continue; }
      const yMax = height - b.max * height;
      const yMin = height - b.min * height;
      if (!prevHadData) ctx.moveTo(i, yMax);
      else ctx.lineTo(i, yMax);
      if (yMin !== yMax) {
        ctx.moveTo(i, yMin);
        ctx.lineTo(i, yMax);
        ctx.moveTo(i, yMax);
      }
      prevHadData = true;
    }
    ctx.stroke();
  }, [events, eventIndices, viewStartMs, viewEndMs, heightPx, color, fill, map, bufferVersion]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap || !onHover) return;
    const rect = wrap.getBoundingClientRect();
    const xIn = e.clientX - rect.left - leftGutterPx;
    const trackWidth = rect.width - leftGutterPx;
    if (xIn < 0 || trackWidth <= 0) { onHover(null, 0, 0); return; }
    const pct = xIn / trackWidth;
    const tMs = viewStartMs + pct * (viewEndMs - viewStartMs);
    // Find nearest event index (in this lane) to tMs.
    if (eventIndices.length === 0) { onHover(null, 0, 0); return; }
    let lo = 0, hi = eventIndices.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[eventIndices[mid]].tRel < tMs) lo = mid + 1;
      else hi = mid;
    }
    const candA = eventIndices[Math.max(0, lo - 1)];
    const candB = eventIndices[Math.min(eventIndices.length - 1, lo)];
    const picked =
      Math.abs(events[candA].tRel - tMs) < Math.abs(events[candB].tRel - tMs) ? candA : candB;
    onHover(events[picked], e.clientX, e.clientY);
  };

  const handleMouseLeave = () => onHover?.(null, 0, 0);

  return (
    <div
      ref={wrapRef}
      className={`relative border-t border-white/5 flex ${isFlashing ? "ring-1 ring-accent/60" : ""}`}
      style={{ height: heightPx }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="group/gutter text-[10px] text-gray-500 px-3 border-r border-white/5 flex items-center gap-1.5 overflow-hidden"
        style={{ width: leftGutterPx, flexShrink: 0 }}
      >
        <div className="flex flex-col justify-center min-w-0 flex-1 overflow-hidden">
          <span className="truncate">{label}</span>
          {sublabel && <span className="text-gray-700 text-[9px] truncate">{sublabel}</span>}
          <LaneBadges
            analysis={analysis}
            userBadges={userBadges}
            onAddClick={() => onRequestAddBadge?.(laneKey)}
            onBadgeClick={(b) => onEditBadge?.(b)}
            onDeleteBadge={onDeleteBadge}
            suppressedTypes={suppressedAnalysisTypes}
            onSuppressBadge={onSuppressAnalysisBadge}
          />
        </div>
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/gutter:opacity-100 transition-opacity">
          {onHide && (
            <button
              onClick={(e) => { e.stopPropagation(); onHide(); }}
              className="text-[9px] text-gray-600 hover:text-red-400 leading-none transition-colors"
              title="Hide lane"
            >⊘</button>
          )}
          {mapping ? (
            <button
              onClick={(e) => onOpenMapping?.(e)}
              title={`Edit OSC mapping → ${mapping.address ?? "(preset)"}`}
              className="ml-1 max-w-[140px] truncate px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent/15 text-accent border border-accent/40 hover:bg-accent/25"
            >
              → {mapping.address ?? mapping.preset}
            </button>
          ) : (
            <button
              onClick={(e) => onOpenMapping?.(e)}
              title="Map this CC to OSC"
              className="ml-1 px-1.5 py-0.5 rounded text-[10px] border border-white/10 text-gray-500 hover:text-white hover:border-accent/40"
            >
              ＋ Map
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 relative">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
      {onResize && <ResizeHandle currentHeight={heightPx} onResize={onResize} />}
    </div>
  );
}
