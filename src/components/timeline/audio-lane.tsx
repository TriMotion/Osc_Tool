"use client";

import { useEffect, useRef } from "react";

interface AudioLaneProps {
  /** Peaks normalized to [-1, 1]; null = no audio loaded. */
  peaks: Array<{ min: number; max: number }> | null;
  heightPx: number;
  /** Optional filename shown as label. */
  label?: string;
  /** Drag callback: receives pixel delta (positive = audio shifted right). */
  onOffsetDragDelta?: (deltaPx: number, modifier: "none" | "shift" | "alt") => void;
  leftGutterPx: number;
}

export function AudioLane({ peaks, heightPx, label, onOffsetDragDelta, leftGutterPx }: AudioLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const dragModifierRef = useRef<"none" | "shift" | "alt">("none");

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
    if (!peaks || peaks.length === 0) return;

    ctx.strokeStyle = "rgba(142,203,255,0.55)";
    ctx.lineWidth = 1;
    const mid = height / 2;
    ctx.beginPath();
    for (let i = 0; i < peaks.length; i++) {
      const p = peaks[i];
      const x = (i / peaks.length) * width;
      ctx.moveTo(x, mid - p.max * mid);
      ctx.lineTo(x, mid - p.min * mid);
    }
    ctx.stroke();
  }, [peaks, heightPx]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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

  return (
    <div
      ref={wrapRef}
      className="relative border-b border-white/5"
      style={{ height: heightPx, background: "linear-gradient(180deg, rgba(142,203,255,0.05), rgba(142,203,255,0.01))" }}
    >
      <div
        className="absolute left-0 top-0 h-full text-[10px] text-accent font-mono px-3 flex items-center border-r border-white/5 z-[2]"
        style={{ width: leftGutterPx }}
      >
        ♪ {label ?? (peaks ? "audio" : "no audio")}
      </div>
      <div
        className="absolute top-0 bottom-0"
        style={{ left: leftGutterPx, right: 0, cursor: onOffsetDragDelta ? "ew-resize" : "default" }}
        onPointerDown={onOffsetDragDelta ? handlePointerDown : undefined}
        onPointerMove={onOffsetDragDelta ? handlePointerMove : undefined}
        onPointerUp={onOffsetDragDelta ? handlePointerUp : undefined}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
}
