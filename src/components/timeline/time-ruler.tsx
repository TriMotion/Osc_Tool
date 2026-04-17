"use client";

import { useMemo, useRef } from "react";
import { formatTime } from "@/lib/timeline-util";

interface TimeRulerProps {
  viewStartMs: number;
  viewEndMs: number;
  leftGutterPx: number;
  onSeek: (ms: number) => void;
}

export function TimeRuler({ viewStartMs, viewEndMs, leftGutterPx, onSeek }: TimeRulerProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  const ticks = useMemo(() => {
    const span = viewEndMs - viewStartMs;
    if (span <= 0) return [];
    // Pick a nice tick spacing: 100ms, 500ms, 1s, 5s, 10s, 30s, 60s, 300s.
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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - leftGutterPx;
    const trackWidth = rect.width - leftGutterPx;
    if (x < 0 || trackWidth <= 0) return;
    const ms = viewStartMs + (x / trackWidth) * (viewEndMs - viewStartMs);
    onSeek(ms);
    el.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - leftGutterPx;
    const trackWidth = rect.width - leftGutterPx;
    if (trackWidth <= 0) return;
    const ms = viewStartMs + (x / trackWidth) * (viewEndMs - viewStartMs);
    onSeek(ms);
  };

  return (
    <div
      ref={ref}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      className="relative h-6 border-b border-white/5 text-[10px] text-gray-500 font-mono cursor-ew-resize select-none"
    >
      <div style={{ position: "absolute", left: 0, top: 0, width: leftGutterPx, height: "100%" }} />
      {ticks.map((t) => {
        const pct = ((t - viewStartMs) / (viewEndMs - viewStartMs)) * 100;
        const leftCss = `calc(${leftGutterPx}px + ${pct}% - ${leftGutterPx * pct / 100}px)`;
        return (
          <div key={t} style={{ position: "absolute", left: leftCss, top: 2 }}>
            <span className="opacity-70">{formatTime(t)}</span>
          </div>
        );
      })}
    </div>
  );
}
