"use client";

import { useEffect, useRef, useState } from "react";
import type { TimelineSection } from "@/lib/types";

const SECTION_COLORS = [
  "#c7f168", "#68d9f1", "#f1a368", "#f168c7",
  "#68f1a3", "#a368f1", "#f1d968", "#f16868",
];

function nextColor(sections: TimelineSection[]): string {
  const used = new Set(sections.map((s) => s.color).filter(Boolean));
  return SECTION_COLORS.find((c) => !used.has(c)) ?? SECTION_COLORS[sections.length % SECTION_COLORS.length];
}

type DragOp =
  | { kind: "create"; startMs: number; currentMs: number }
  | { kind: "move"; id: string; origStart: number; origEnd: number; startMs: number; currentMs: number }
  | { kind: "resize-left"; id: string; origStart: number; origEnd: number; startMs: number; currentMs: number }
  | { kind: "resize-right"; id: string; origStart: number; origEnd: number; startMs: number; currentMs: number };

/** Compute live display range for a section while dragging. */
function liveRange(section: TimelineSection, op: DragOp | null): { startMs: number; endMs: number } {
  if (!op || op.kind === "create" || op.id !== section.id) {
    return { startMs: section.startMs, endMs: section.endMs };
  }
  const delta = op.currentMs - op.startMs;
  const MIN = 100;
  if (op.kind === "move") {
    return { startMs: op.origStart + delta, endMs: op.origEnd + delta };
  }
  if (op.kind === "resize-left") {
    return { startMs: Math.min(op.origStart + delta, op.origEnd - MIN), endMs: op.origEnd };
  }
  // resize-right
  return { startMs: op.origStart, endMs: Math.max(op.origEnd + delta, op.origStart + MIN) };
}

interface SongsStripProps {
  sections: TimelineSection[];
  focusedSectionId: string | null;
  onFocus: (id: string | null) => void;
  onChange: (sections: TimelineSection[]) => void;
  /** Full recording duration in ms — used to position the global playhead. */
  durationMs: number;
  /** Live playhead ms ref — strip reads it each frame. */
  playheadMsRef: React.MutableRefObject<number>;
}

export function SongsStrip(props: SongsStripProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragOp, setDragOp] = useState<DragOp | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [playheadFrac, setPlayheadFrac] = useState(0);
  const dragStartClientXRef = useRef(0);

  const msToFrac = (ms: number) => ms / Math.max(1, props.durationMs);
  const xToMs = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return ((clientX - rect.left) / rect.width) * props.durationMs;
  };

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setPlayheadFrac(props.playheadMsRef.current / Math.max(1, props.durationMs));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [props.durationMs, props.playheadMsRef]);

  // Track-level: starts a "create" drag on empty space
  const handleTrackMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragStartClientXRef.current = e.clientX;
    const ms = xToMs(e.clientX);
    setDragOp({ kind: "create", startMs: ms, currentMs: ms });
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragOp) return;
    const ms = xToMs(e.clientX);
    setDragOp((prev) => (prev ? { ...prev, currentMs: ms } : null));
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragOp) return;
    const hasMoved = Math.abs(e.clientX - dragStartClientXRef.current) > 5;

    if (dragOp.kind === "create") {
      if (hasMoved) {
        const startMs = Math.min(dragOp.startMs, dragOp.currentMs);
        const endMs = Math.max(dragOp.startMs, dragOp.currentMs);
        // minimum 1% of duration to avoid accidental tiny sections
        if (endMs - startMs > props.durationMs * 0.01) {
          const id = crypto.randomUUID();
          const s: TimelineSection = {
            id,
            name: `Song ${props.sections.length + 1}`,
            startMs,
            endMs,
            color: nextColor(props.sections),
          };
          props.onChange([...props.sections, s]);
          props.onFocus(id);
        }
      }
    } else if (dragOp.kind === "move") {
      if (hasMoved) {
        const delta = dragOp.currentMs - dragOp.startMs;
        props.onChange(
          props.sections.map((s) =>
            s.id !== dragOp.id ? s : { ...s, startMs: dragOp.origStart + delta, endMs: dragOp.origEnd + delta }
          )
        );
      } else {
        props.onFocus(props.focusedSectionId === dragOp.id ? null : dragOp.id);
      }
    } else if (dragOp.kind === "resize-left") {
      const delta = dragOp.currentMs - dragOp.startMs;
      const newStart = Math.min(dragOp.origStart + delta, dragOp.origEnd - 100);
      props.onChange(props.sections.map((s) => s.id !== dragOp.id ? s : { ...s, startMs: newStart }));
    } else if (dragOp.kind === "resize-right") {
      const delta = dragOp.currentMs - dragOp.startMs;
      const newEnd = Math.max(dragOp.origEnd + delta, dragOp.origStart + 100);
      props.onChange(props.sections.map((s) => s.id !== dragOp.id ? s : { ...s, endMs: newEnd }));
    }

    setDragOp(null);
  };

  // Section body: move
  const handleSectionBodyDown = (e: React.MouseEvent, section: TimelineSection) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    dragStartClientXRef.current = e.clientX;
    const ms = xToMs(e.clientX);
    setDragOp({ kind: "move", id: section.id, origStart: section.startMs, origEnd: section.endMs, startMs: ms, currentMs: ms });
    e.preventDefault();
  };

  // Edge handles: resize
  const handleEdgeDown = (e: React.MouseEvent, section: TimelineSection, edge: "left" | "right") => {
    e.stopPropagation();
    if (e.button !== 0) return;
    dragStartClientXRef.current = e.clientX;
    const ms = xToMs(e.clientX);
    const kind = edge === "left" ? "resize-left" : "resize-right";
    setDragOp({ kind, id: section.id, origStart: section.startMs, origEnd: section.endMs, startMs: ms, currentMs: ms });
    e.preventDefault();
  };

  const commitRename = () => {
    if (!editingId) return;
    props.onChange(
      props.sections.map((s) => (s.id === editingId ? { ...s, name: editingName.trim() || s.name } : s))
    );
    setEditingId(null);
  };

  const deleteSection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    props.onChange(props.sections.filter((s) => s.id !== id));
    if (props.focusedSectionId === id) props.onFocus(null);
  };

  return (
    <div className="flex flex-col gap-1 px-1 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">Songs in recording</span>
        <span className="text-[10px] text-gray-600">
          {props.sections.length
            ? `${props.sections.length} song${props.sections.length === 1 ? "" : "s"} · click to focus`
            : "Drag to mark a song"}
        </span>
      </div>

      <div
        ref={trackRef}
        onMouseDown={handleTrackMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="relative h-10 rounded bg-black/40 overflow-hidden select-none"
        style={{
          cursor: !dragOp ? "crosshair"
            : dragOp.kind === "move" ? "grabbing"
            : dragOp.kind.startsWith("resize") ? "ew-resize"
            : "crosshair",
        }}
      >
        {props.sections.map((section) => {
          const { startMs, endMs } = liveRange(section, dragOp);
          const leftFrac = Math.max(0, msToFrac(startMs));
          const rightFrac = Math.min(1, msToFrac(endMs));
          if (rightFrac <= leftFrac) return null;

          const focused = section.id === props.focusedSectionId;
          const color = section.color ?? "#c7f168";
          const isEditing = editingId === section.id;
          const isDraggingThis = dragOp && dragOp.kind !== "create" && dragOp.id === section.id;

          return (
            <div
              key={section.id}
              className="absolute top-1 bottom-1 rounded overflow-hidden group"
              style={{
                left: `${leftFrac * 100}%`,
                width: `${(rightFrac - leftFrac) * 100}%`,
                backgroundColor: `${color}${focused ? "28" : "18"}`,
                border: `1px solid ${color}${focused ? "bb" : "44"}`,
                boxShadow: focused ? `0 0 0 1px ${color}44` : "none",
                zIndex: isDraggingThis ? 10 : 1,
              }}
            >
              {/* Left resize handle */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1.5 z-10"
                style={{ cursor: "ew-resize" }}
                onMouseDown={(e) => handleEdgeDown(e, section, "left")}
              />

              {/* Body */}
              <div
                className="absolute inset-0 left-1.5 right-1.5 flex items-center"
                style={{ cursor: isDraggingThis && dragOp?.kind === "move" ? "grabbing" : "grab" }}
                onMouseDown={(e) => handleSectionBodyDown(e, section)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(section.id);
                  setEditingName(section.name);
                }}
              >
                <div className="flex-1 min-w-0 px-1 flex items-center">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="bg-transparent border-none outline-none w-full text-[10px] font-medium"
                      style={{ color }}
                    />
                  ) : (
                    <span className="text-[10px] font-medium truncate" style={{ color }}>
                      {section.name}
                    </span>
                  )}
                </div>

                {!isEditing && (
                  <div className="flex items-center gap-0.5 mr-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      className="text-[9px] leading-none hover:opacity-70"
                      style={{ color }}
                      title="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(section.id);
                        setEditingName(section.name);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      ✎
                    </button>
                    <button
                      className="text-[9px] leading-none hover:opacity-70"
                      style={{ color }}
                      title="Delete"
                      onClick={(e) => deleteSection(section.id, e)}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Right resize handle */}
              <div
                className="absolute right-0 top-0 bottom-0 w-1.5 z-10"
                style={{ cursor: "ew-resize" }}
                onMouseDown={(e) => handleEdgeDown(e, section, "right")}
              />
            </div>
          );
        })}

        {/* Create preview */}
        {dragOp?.kind === "create" && (() => {
          const leftFrac = Math.max(0, msToFrac(Math.min(dragOp.startMs, dragOp.currentMs)));
          const rightFrac = Math.min(1, msToFrac(Math.max(dragOp.startMs, dragOp.currentMs)));
          if (rightFrac <= leftFrac) return null;
          return (
            <div
              className="absolute top-1 bottom-1 rounded pointer-events-none"
              style={{
                left: `${leftFrac * 100}%`,
                width: `${(rightFrac - leftFrac) * 100}%`,
                backgroundColor: "rgba(199,241,104,0.15)",
                border: "1px dashed rgba(199,241,104,0.5)",
              }}
            />
          );
        })()}

        {/* Global playhead marker */}
        <div
          style={{ left: `${playheadFrac * 100}%` }}
          className="absolute top-0 bottom-0 w-px bg-white/80 pointer-events-none"
        />
      </div>
    </div>
  );
}
