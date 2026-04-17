"use client";

import { useEffect, useRef } from "react";
import type { RecordedEvent } from "@/lib/types";
import { bucketContinuous, eventValue } from "@/lib/timeline-util";
import { ResizeHandle } from "./resize-handle";

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

    // Fill under curve
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, height);
    let hadAny = false;
    for (let i = 0; i < pixelCount; i++) {
      const b = buckets[i];
      if (b) {
        const yTop = height - b.max * height;
        ctx.lineTo(i, yTop);
        hadAny = true;
      }
    }
    if (hadAny) {
      ctx.lineTo(pixelCount - 1, height);
      ctx.closePath();
      ctx.fill();
    }

    // Stroke (top of each bucket)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pixelCount; i++) {
      const b = buckets[i];
      if (!b) continue;
      const yMax = height - b.max * height;
      const yMin = height - b.min * height;
      if (!started) { ctx.moveTo(i, yMax); started = true; }
      else ctx.lineTo(i, yMax);
      if (yMin !== yMax) {
        ctx.moveTo(i, yMin);
        ctx.lineTo(i, yMax);
        ctx.moveTo(i, yMax);
      }
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
      className="relative border-t border-white/5 flex"
      style={{ height: heightPx }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="text-[10px] text-gray-500 px-3 py-1 border-r border-white/5 flex flex-col justify-center overflow-hidden"
        style={{ width: leftGutterPx, flexShrink: 0 }}
      >
        <span className="truncate">{label}</span>
        {sublabel && <span className="text-gray-700 text-[9px] truncate">{sublabel}</span>}
      </div>
      <div className="flex-1 relative">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
      {onResize && <ResizeHandle currentHeight={heightPx} onResize={onResize} />}
    </div>
  );
}
