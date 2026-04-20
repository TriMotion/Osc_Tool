"use client";

import { useEffect, useMemo, useRef } from "react";
import type { LaneAnalysis, LaneBadge, NoteGroupTag, NoteSpan, OscMapping } from "@/lib/types";
import { findNoteTag } from "@/lib/timeline-util";
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
  onNoteClick?: (span: NoteSpan) => void;
  selectedVelocity?: { pitch: number; velocity: number } | null;
  activeSectionRange?: { startMs: number; endMs: number } | null;
  hiddenNoteKeys?: Set<string>;
  sectionHiddenRanges?: Array<{ pitch: number; velocity: number; startMs: number; endMs: number }>;
  onResize?: (newHeight: number) => void;
  analysis?: LaneAnalysis;
  userBadges?: LaneBadge[];
  onRequestAddBadge?: (laneKey: string) => void;
  onEditBadge?: (badge: LaneBadge) => void;
  onDeleteBadge?: (id: string) => void;
  suppressedAnalysisTypes?: Set<"rhythm" | "dynamic" | "melody">;
  onSuppressAnalysisBadge?: (type: "rhythm" | "dynamic" | "melody") => void;
  isFlashing?: boolean;
  onHide?: () => void;
  noteTags?: NoteGroupTag[];
  oscMappings?: OscMapping[];
  focusedSectionId?: string | null;
  onOpenNoteGroupMapping?: (pitch: number, velocity: number | null) => void;
}

export function NotesLane(props: NotesLaneProps) {
  const {
    laneKey, spans, viewStartMs, viewEndMs, heightPx, leftGutterPx,
    onHover, onNoteClick, selectedVelocity, activeSectionRange, hiddenNoteKeys,
    onResize, analysis, userBadges, onRequestAddBadge, onEditBadge, onDeleteBadge,
    suppressedAnalysisTypes, onSuppressAnalysisBadge, isFlashing, onHide,
    noteTags, sectionHiddenRanges,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const isHidden = (s: NoteSpan) => {
    if (hiddenNoteKeys?.has(`${s.pitch}|${s.velocity}`)) return true;
    if (sectionHiddenRanges) {
      for (const r of sectionHiddenRanges) {
        if (r.pitch === s.pitch && r.velocity === s.velocity && s.tStart < r.endMs && s.tEnd > r.startMs) return true;
      }
    }
    return false;
  };

  const device = spans[0]?.device ?? "";
  const spanColor = (s: NoteSpan): string => {
    if (noteTags?.length) {
      const tag = findNoteTag(noteTags, device, s.pitch, s.velocity);
      if (tag?.color) return tag.color;
      if (tag) {
        let h = 0;
        for (let i = 0; i < tag.label.length; i++) h = (h * 31 + tag.label.charCodeAt(i)) & 0xffffff;
        return `hsl(${h % 360},55%,65%)`;
      }
    }
    return velocityColor(s.velocity);
  };

  // Pitch range is derived only from visible (non-hidden) spans so the piano roll
  // stays dense — no wasted vertical space for hidden pitches.
  const { minPitch, maxPitch } = useMemo(() => {
    const visible = spans.filter((s) => !hiddenNoteKeys?.has(`${s.pitch}|${s.velocity}`));
    const src = visible.length > 0 ? visible : spans;
    if (src.length === 0) return { minPitch: 36, maxPitch: 84 };
    let mn = Infinity, mx = -Infinity;
    for (const s of src) {
      if (s.pitch < mn) mn = s.pitch;
      if (s.pitch > mx) mx = s.pitch;
    }
    if (mn === mx) { mn = Math.max(0, mn - 6); mx = Math.min(127, mx + 6); }
    return { minPitch: mn, maxPitch: mx };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spans, hiddenNoteKeys]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const viewSpan = viewEndMs - viewStartMs;
    if (viewSpan <= 0 || spans.length === 0) return;

    const pitchSpan = Math.max(1, maxPitch - minPitch);
    const rowH = Math.max(2, height / (pitchSpan + 1));
    const hasSelection = selectedVelocity != null;

    // Binary-search upper bound: skip spans starting after viewport.
    let hi = spans.length;
    {
      let lo = 0;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (spans[mid].tStart < viewEndMs) lo = mid + 1;
        else hi = mid;
      }
    }

    const drawSpan = (s: NoteSpan) => {
      const xStart = ((Math.max(s.tStart, viewStartMs) - viewStartMs) / viewSpan) * width;
      const xEnd = ((Math.min(s.tEnd, viewEndMs) - viewStartMs) / viewSpan) * width;
      const w = Math.max(1.5, xEnd - xStart);
      const y = (1 - (s.pitch - minPitch) / pitchSpan) * (height - rowH);
      ctx.fillRect(Math.floor(xStart), Math.floor(y), Math.ceil(w), Math.max(2, Math.ceil(rowH) - 1));
    };

    if (hasSelection) {
      const selPitch = selectedVelocity!.pitch;
      const selVel = selectedVelocity!.velocity;
      const inSection = (s: NoteSpan) =>
        !activeSectionRange || (s.tStart < activeSectionRange.endMs && s.tEnd > activeSectionRange.startMs);
      const isSelected = (s: NoteSpan) => s.pitch === selPitch && s.velocity === selVel && inSection(s);

      for (let i = 0; i < hi; i++) {
        const s = spans[i];
        if (s.tEnd < viewStartMs || isHidden(s)) continue;
        if (!inSection(s)) {
          // Outside active section: show at reduced opacity, not dimmed
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = spanColor(s);
          drawSpan(s);
        }
      }
      // Dim in-section non-selected
      ctx.globalAlpha = 0.15;
      for (let i = 0; i < hi; i++) {
        const s = spans[i];
        if (s.tEnd < viewStartMs || isHidden(s) || !inSection(s) || isSelected(s)) continue;
        ctx.fillStyle = spanColor(s);
        drawSpan(s);
      }
      // Bright: in-section selected
      ctx.globalAlpha = 1;
      for (let i = 0; i < hi; i++) {
        const s = spans[i];
        if (s.tEnd < viewStartMs || isHidden(s) || !isSelected(s)) continue;
        ctx.fillStyle = "#ffffff";
        drawSpan(s);
      }
    } else {
      ctx.globalAlpha = 1;
      for (let i = 0; i < hi; i++) {
        const s = spans[i];
        if (s.tEnd < viewStartMs || isHidden(s)) continue;
        ctx.fillStyle = spanColor(s);
        drawSpan(s);
      }
    }

    ctx.globalAlpha = 1;
  }, [spans, viewStartMs, viewEndMs, heightPx, minPitch, maxPitch, selectedVelocity, activeSectionRange, hiddenNoteKeys, noteTags]);

  const hitTest = (e: React.MouseEvent<HTMLDivElement>): NoteSpan | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xIn = e.clientX - rect.left;
    const yIn = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) return null;

    const viewSpan = viewEndMs - viewStartMs;
    const tMs = viewStartMs + (xIn / width) * viewSpan;
    const pitchSpan = Math.max(1, maxPitch - minPitch);
    const rowH = Math.max(2, height / (pitchSpan + 1));
    const hoveredPitch = Math.round(maxPitch - (yIn / (height - rowH)) * pitchSpan);

    let best: NoteSpan | null = null;
    let bestDist = Infinity;
    let hi = spans.length;
    {
      let lo = 0;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (spans[mid].tStart < viewEndMs) lo = mid + 1;
        else hi = mid;
      }
    }
    for (let i = 0; i < hi; i++) {
      const s = spans[i];
      if (s.tEnd < viewStartMs || isHidden(s) || tMs < s.tStart || tMs > s.tEnd) continue;
      const dp = Math.abs(s.pitch - hoveredPitch);
      if (dp < bestDist) { bestDist = dp; best = s; }
    }
    return best;
  };

  return (
    <div
      className={`relative border-t border-white/5 ${isFlashing ? "ring-1 ring-accent/60" : ""}`}
      style={{ height: heightPx }}
    >
      <div
        className="group/gutter absolute left-0 top-0 h-full text-[10px] text-gray-500 px-3 flex flex-col justify-center gap-0.5 border-r border-white/5 z-[2] bg-black/0 overflow-hidden"
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
          onDeleteBadge={onDeleteBadge}
          suppressedTypes={suppressedAnalysisTypes}
          onSuppressBadge={onSuppressAnalysisBadge}
        />
        {onHide && (
          <button
            onClick={(e) => { e.stopPropagation(); onHide(); }}
            className="absolute top-0.5 right-0.5 opacity-0 group-hover/gutter:opacity-100 transition-opacity text-[9px] text-gray-600 hover:text-red-400 leading-none"
            title="Hide lane"
          >⊘</button>
        )}
      </div>
      <div
        className="absolute top-0 bottom-0"
        style={{ left: leftGutterPx, right: 0, cursor: onNoteClick ? "pointer" : "default" }}
        onMouseMove={(e) => { if (onHover) onHover(hitTest(e), e.clientX, e.clientY); }}
        onMouseLeave={() => onHover?.(null, 0, 0)}
        onClick={(e) => { if (onNoteClick) { const s = hitTest(e); if (s) onNoteClick(s); } }}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
      {onResize && <ResizeHandle currentHeight={heightPx} onResize={onResize} />}
    </div>
  );
}

function velocityColor(velocity: number): string {
  const v = Math.max(0, Math.min(127, velocity));
  if (v <= 20)  return "rgba(74, 123, 255, 0.75)";
  if (v <= 50)  return "rgba(0, 212, 255, 0.80)";
  if (v <= 80)  return "rgba(125, 216, 125, 0.85)";
  if (v <= 110) return "rgba(255, 184, 77, 0.90)";
  return "rgba(255, 74, 74, 0.95)";
}
