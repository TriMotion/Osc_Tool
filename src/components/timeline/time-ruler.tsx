"use client";

import { useMemo, useRef } from "react";

interface TimeRulerProps {
  viewStartMs: number;
  viewEndMs: number;
  leftGutterPx: number;
  onSeek: (ms: number) => void;
  originOffsetMs: number;
  onOriginChange: (ms: number) => void;
}

function formatDisplayTime(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const frac = Math.floor((abs % 1000) / 10);
  return `${sign}${min}:${String(sec).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

export function TimeRuler({ viewStartMs, viewEndMs, leftGutterPx, onSeek, originOffsetMs, onOriginChange }: TimeRulerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const draggingOriginRef = useRef(false);

  const ticks = useMemo(() => {
    const span = viewEndMs - viewStartMs;
    if (span <= 0) return [];
    const candidates = [100, 500, 1000, 5000, 10000, 30000, 60000, 300000];
    const targetCount = 8;
    let step = candidates[candidates.length - 1];
    for (const c of candidates) {
      if (span / c <= targetCount) { step = c; break; }
    }
    const first = Math.ceil(viewStartMs / step) * step;
    const arr: number[] = [];
    for (let t = first; t <= viewEndMs; t += step) arr.push(t);
    return arr;
  }, [viewStartMs, viewEndMs]);

  const viewSpan = Math.max(1, viewEndMs - viewStartMs);

  const xToMs = (clientX: number): number => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = clientX - rect.left - leftGutterPx;
    const trackWidth = rect.width - leftGutterPx;
    if (trackWidth <= 0) return 0;
    return viewStartMs + (x / trackWidth) * viewSpan;
  };

  // Outer div always captures — child sets the draggingOriginRef flag first via bubble order.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const x = e.clientX - el.getBoundingClientRect().left - leftGutterPx;
    if (x < 0) return;
    el.setPointerCapture(e.pointerId);
    if (!draggingOriginRef.current) {
      onSeek(xToMs(e.clientX));
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) { draggingOriginRef.current = false; return; }
    const ms = xToMs(e.clientX);
    if (draggingOriginRef.current) {
      onOriginChange(Math.max(0, ms));
    } else {
      onSeek(ms);
    }
  };

  const handlePointerUp = () => { draggingOriginRef.current = false; };

  // Sets the flag before the event bubbles to handlePointerDown — no stopPropagation
  // so the outer div can still setPointerCapture (required for reliable drag tracking).
  const handleOriginPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingOriginRef.current = true;
  };

  // Origin is always at view.startMs (view is clamped to origin), so it sits at the left edge.
  const originPct = ((originOffsetMs - viewStartMs) / viewSpan) * 100;

  return (
    <div
      ref={ref}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="relative h-6 border-b border-white/5 text-[10px] text-gray-500 font-mono select-none"
      style={{ cursor: "ew-resize" }}
    >
      {/* Gutter — reset origin button when origin is set */}
      <div
        style={{ position: "absolute", left: 0, top: 0, width: leftGutterPx, height: "100%" }}
        className="flex items-center justify-end pr-2"
      >
        {originOffsetMs > 0 && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOriginChange(0); }}
            className="text-[9px] text-gray-600 hover:text-accent transition-colors leading-none"
            title="Reset origin to start"
          >
            ↺
          </button>
        )}
      </div>

      {/* Tick labels */}
      {ticks.map((t) => {
        const pct = ((t - viewStartMs) / viewSpan) * 100;
        const leftCss = `calc(${leftGutterPx}px + ${pct}% - ${leftGutterPx * pct / 100}px)`;
        const displayMs = t - originOffsetMs;
        return (
          <div key={t} style={{ position: "absolute", left: leftCss, top: 2 }}>
            <span className="opacity-70">{formatDisplayTime(displayMs)}</span>
          </div>
        );
      })}

      {/* Origin handle — at the left edge of the track (origin = view floor) */}
      {originPct >= -1 && originPct <= 101 && (
        <div
          style={{
            position: "absolute",
            left: `calc(${leftGutterPx}px + ${originPct}% - ${leftGutterPx * originPct / 100}px)`,
            top: 0,
            bottom: 0,
            width: 12,
            transform: "translateX(-50%)",
            cursor: "ew-resize",
            zIndex: 10,
          }}
          onPointerDown={handleOriginPointerDown}
          title="Drag right to advance origin · click ↺ to reset"
        >
          <div
            className="absolute inset-y-0 pointer-events-none"
            style={{ left: "50%", width: 1, background: "rgba(199,241,104,0.7)" }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              left: "50%",
              top: 2,
              transform: "translateX(-50%)",
              width: 0, height: 0,
              borderLeft: "4px solid transparent",
              borderRight: "4px solid transparent",
              borderTop: "6px solid rgba(199,241,104,0.9)",
            }}
          />
        </div>
      )}
    </div>
  );
}
