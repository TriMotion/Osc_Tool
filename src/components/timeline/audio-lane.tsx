"use client";

import { useEffect, useRef, useState } from "react";
import { ResizeHandle } from "./resize-handle";

interface AudioLaneProps {
  /** Peaks normalized to [-1, 1]; null = no audio loaded. */
  peaks: Array<{ min: number; max: number }> | null;
  heightPx: number;
  /** Optional filename shown as label. */
  label?: string;
  /** Drag callback: receives pixel delta (positive = audio shifted right). */
  onOffsetDragDelta?: (deltaPx: number, modifier: "none" | "shift" | "alt") => void;
  leftGutterPx: number;
  onResize?: (newHeight: number) => void;
  viewStartMs: number;
  viewEndMs: number;
  audioOffsetMs: number;
  audioDurationMs: number;
  audioLoaded: boolean;
  onLoadAudio?: () => void;
  onUnloadAudio?: () => void;
  onOffsetChange?: (ms: number) => void;
}

export function AudioLane({
  peaks, heightPx, label, onOffsetDragDelta, leftGutterPx, onResize,
  viewStartMs, viewEndMs, audioOffsetMs, audioDurationMs,
  audioLoaded, onLoadAudio, onUnloadAudio, onOffsetChange,
}: AudioLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const dragModifierRef = useRef<"none" | "shift" | "alt">("none");
  const [locked, setLocked] = useState(false);

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

    if (!peaks || peaks.length === 0 || audioDurationMs <= 0) return;

    const viewSpan = viewEndMs - viewStartMs;
    if (viewSpan <= 0) return;

    const audioStartPx = ((audioOffsetMs - viewStartMs) / viewSpan) * width;
    const audioEndPx = ((audioOffsetMs + audioDurationMs - viewStartMs) / viewSpan) * width;
    const drawStartPx = Math.max(0, audioStartPx);
    const drawEndPx = Math.min(width, audioEndPx);
    if (drawEndPx <= drawStartPx) return;

    ctx.strokeStyle = "rgba(142,203,255,0.55)";
    ctx.lineWidth = 1;
    const mid = height / 2;
    ctx.beginPath();
    for (let x = Math.floor(drawStartPx); x <= Math.ceil(drawEndPx); x++) {
      const tMs = viewStartMs + (x / width) * viewSpan;
      const frac = (tMs - audioOffsetMs) / audioDurationMs;
      const peakIdx = Math.min(peaks.length - 1, Math.max(0, Math.round(frac * (peaks.length - 1))));
      const p = peaks[peakIdx];
      ctx.moveTo(x, mid - p.max * mid);
      ctx.lineTo(x, mid - p.min * mid);
    }
    ctx.stroke();
  }, [peaks, heightPx, viewStartMs, viewEndMs, audioOffsetMs, audioDurationMs]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    dragStartXRef.current = e.clientX;
    dragModifierRef.current = e.altKey ? "alt" : e.shiftKey ? "shift" : "none";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current === null) return;
    const delta = e.clientX - dragStartXRef.current;
    dragStartXRef.current = e.clientX;
    onOffsetDragDelta?.(delta, dragModifierRef.current);
  };

  const handlePointerUp = () => {
    dragStartXRef.current = null;
  };

  const isDraggable = !!onOffsetDragDelta && !locked;

  return (
    <div
      ref={wrapRef}
      className="relative border-b border-white/5"
      style={{ height: heightPx, background: "linear-gradient(180deg, rgba(142,203,255,0.05), rgba(142,203,255,0.01))" }}
    >
      {/* Gutter with audio controls */}
      <div
        className="absolute left-0 top-0 h-full flex flex-col justify-center px-3 gap-0.5 border-r border-white/5 z-[2] overflow-hidden"
        style={{ width: leftGutterPx }}
      >
        {audioLoaded ? (
          <>
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-accent text-[10px] shrink-0">♪</span>
              <span className="text-accent text-[10px] font-mono truncate flex-1">{label ?? "audio"}</span>
              <button
                onClick={() => setLocked((v) => !v)}
                className={`shrink-0 text-[10px] leading-none transition-colors ${locked ? "text-amber-400" : "text-gray-600 hover:text-gray-300"}`}
                title={locked ? "Unlock offset" : "Lock offset"}
              >
                {locked ? "🔒" : "🔓"}
              </button>
              {onUnloadAudio && (
                <button
                  onClick={onUnloadAudio}
                  className="shrink-0 text-gray-600 hover:text-red-400 text-[10px] leading-none transition-colors"
                  title="Remove audio"
                >
                  ✕
                </button>
              )}
            </div>
            {onOffsetChange && (
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-gray-600 shrink-0">↔</span>
                <input
                  type="number"
                  step={0.001}
                  value={(audioOffsetMs / 1000).toFixed(3)}
                  onChange={(e) => {
                    if (locked) return;
                    const s = parseFloat(e.target.value);
                    if (!Number.isNaN(s)) onOffsetChange(Math.round(s * 1000));
                  }}
                  disabled={locked}
                  className="flex-1 min-w-0 text-[10px] px-1 py-0.5 bg-black/20 border border-white/10 rounded focus:outline-none focus:border-accent/50 font-mono disabled:opacity-40"
                />
                <span className="text-[9px] text-gray-600 shrink-0">s</span>
              </div>
            )}
          </>
        ) : (
          <button
            onClick={onLoadAudio}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors text-left"
          >
            ♪ Load audio…
          </button>
        )}
      </div>

      {/* Waveform canvas */}
      <div
        className="absolute top-0 bottom-0"
        style={{ left: leftGutterPx, right: 0, cursor: isDraggable ? "ew-resize" : "default" }}
        onPointerDown={isDraggable ? handlePointerDown : undefined}
        onPointerMove={isDraggable ? handlePointerMove : undefined}
        onPointerUp={isDraggable ? handlePointerUp : undefined}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
        {locked && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] text-amber-400/40 font-mono">locked</span>
          </div>
        )}
      </div>
      {onResize && <ResizeHandle currentHeight={heightPx} onResize={onResize} />}
    </div>
  );
}
