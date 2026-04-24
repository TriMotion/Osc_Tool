"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CurveDefinition } from "@/lib/dmx-types";

interface CurveEditorProps {
  curve: CurveDefinition;
  onChange: (curve: CurveDefinition) => void;
}

const PRESETS: Array<{ label: string; curve: CurveDefinition }> = [
  { label: "Snap", curve: { type: "snap" } },
  { label: "Linear", curve: { type: "linear" } },
  { label: "Ease In", curve: { type: "ease-in" } },
  { label: "Ease Out", curve: { type: "ease-out" } },
  { label: "Ease InOut", curve: { type: "ease-in-out" } },
  { label: "Sine", curve: { type: "sine", hz: 2 } },
  { label: "Strobe", curve: { type: "strobe", hz: 10 } },
  { label: "Custom", curve: { type: "bezier", x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
];

function presetSvgPath(curve: CurveDefinition): string {
  switch (curve.type) {
    case "snap": return "M0,18 L4,18 L4,2 L32,2";
    case "linear": return "M0,18 L32,2";
    case "ease-in": return "M0,18 Q16,18 32,2";
    case "ease-out": return "M0,18 Q16,2 32,2";
    case "ease-in-out": return "M0,18 C8,18 24,2 32,2";
    case "sine": return "M0,10 Q8,2 16,10 Q24,18 32,10";
    case "strobe": return "M0,18 L0,2 L8,2 L8,18 L16,18 L16,2 L24,2 L24,18 L32,18 L32,2";
    case "bezier": return `M0,18 C${curve.x1 * 32},${18 - curve.y1 * 16} ${curve.x2 * 32},${18 - curve.y2 * 16} 32,2`;
  }
}

export function CurveEditor({ curve, onChange }: CurveEditorProps) {
  const isCustom = curve.type === "bezier";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dragging, setDragging] = useState<1 | 2 | null>(null);

  const bezier = curve.type === "bezier" ? curve : { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };

  const drawBezier = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      const y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const p0 = { x: 0, y: h };
    const p1 = { x: bezier.x1 * w, y: (1 - bezier.y1) * h };
    const p2 = { x: bezier.x2 * w, y: (1 - bezier.y2) * h };
    const p3 = { x: w, y: 0 };

    ctx.strokeStyle = "rgba(245,158,11,0.3)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "#fcd34d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.stroke();

    for (const p of [p1, p2]) {
      ctx.fillStyle = "#f59e0b";
      ctx.strokeStyle = "#0f0f1e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [bezier]);

  useEffect(() => {
    if (isCustom) drawBezier();
  }, [isCustom, drawBezier]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    const p1 = { x: bezier.x1 * w, y: (1 - bezier.y1) * h };
    const p2 = { x: bezier.x2 * w, y: (1 - bezier.y2) * h };

    const d1 = Math.hypot(mx - p1.x, my - p1.y);
    const d2 = Math.hypot(mx - p2.x, my - p2.y);

    if (d1 < 15) setDragging(1);
    else if (d2 < 15) setDragging(2);
  };

  useEffect(() => {
    if (!dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const onMove = (e: MouseEvent) => {
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
      if (dragging === 1) onChange({ type: "bezier", x1: x, y1: y, x2: bezier.x2, y2: bezier.y2 });
      else onChange({ type: "bezier", x1: bezier.x1, y1: bezier.y1, x2: x, y2: y });
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging, bezier, onChange]);

  return (
    <div>
      <div className="grid grid-cols-4 gap-1 mb-3">
        {PRESETS.map((p) => {
          const active = p.curve.type === curve.type;
          return (
            <button
              key={p.label}
              className="rounded p-1.5 text-center border"
              style={{
                background: active ? "rgba(245,158,11,0.15)" : "#1a1a2e",
                borderColor: active ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.06)",
              }}
              onClick={() => onChange(p.curve)}
            >
              <svg width="32" height="20" viewBox="0 0 32 20" className="mx-auto mb-0.5 block">
                <path d={presetSvgPath(p.curve)} fill="none" stroke={active ? "#fcd34d" : "#6b7280"} strokeWidth="1.5" />
              </svg>
              <div className="text-[9px]" style={{ color: active ? "#fcd34d" : "#9ca3af" }}>{p.label}</div>
            </button>
          );
        })}
      </div>

      {isCustom && (
        <div className="bg-[#1a1a2e] border border-white/10 rounded-md p-3">
          <canvas
            ref={canvasRef}
            className="w-full block cursor-crosshair"
            style={{ height: 160 }}
            onMouseDown={handleCanvasMouseDown}
          />
          <div className="flex justify-between mt-2">
            <span className="text-[10px] text-gray-500">
              bezier({bezier.x1.toFixed(2)}, {bezier.y1.toFixed(2)}, {bezier.x2.toFixed(2)}, {bezier.y2.toFixed(2)})
            </span>
            <button
              className="text-[10px] text-amber-500 hover:text-amber-400"
              onClick={() => onChange({ type: "bezier", x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 })}
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {curve.type === "sine" && (
        <div className="mt-2">
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Frequency (Hz)</label>
          <input
            type="number" min={0.1} max={50} step={0.1}
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={curve.hz}
            onChange={(e) => onChange({ type: "sine", hz: parseFloat(e.target.value) || 2 })}
          />
        </div>
      )}

      {curve.type === "strobe" && (
        <div className="mt-2">
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Frequency (Hz)</label>
          <input
            type="number" min={1} max={50} step={1}
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={curve.hz}
            onChange={(e) => onChange({ type: "strobe", hz: parseInt(e.target.value) || 10 })}
          />
        </div>
      )}
    </div>
  );
}
