"use client";

import { useRef, useState } from "react";
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

interface SectionBarProps {
  sections: TimelineSection[];
  activeSectionId: string | null;
  viewStartMs: number;
  viewEndMs: number;
  leftGutterPx: number;
  onActivate: (id: string | null) => void;
  onChange: (sections: TimelineSection[]) => void;
}

export function SectionBar({
  sections, activeSectionId, viewStartMs, viewEndMs, leftGutterPx,
  onActivate, onChange,
}: SectionBarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragOp, setDragOp] = useState<DragOp | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const dragStartClientXRef = useRef(0);

  const viewSpan = Math.max(1, viewEndMs - viewStartMs);
  const msToFrac = (ms: number) => (ms - viewStartMs) / viewSpan;
  const xToMs = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return viewStartMs + ((clientX - rect.left) / rect.width) * viewSpan;
  };

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
        if (endMs - startMs > viewSpan * 0.01) {
          const id = crypto.randomUUID();
          const s: TimelineSection = { id, name: `Section ${sections.length + 1}`, startMs, endMs, color: nextColor(sections) };
          onChange([...sections, s]);
          onActivate(id);
        }
      }
    } else if (dragOp.kind === "move") {
      if (hasMoved) {
        const delta = dragOp.currentMs - dragOp.startMs;
        onChange(sections.map((s) => s.id !== dragOp.id ? s : { ...s, startMs: dragOp.origStart + delta, endMs: dragOp.origEnd + delta }));
      } else {
        onActivate(activeSectionId === dragOp.id ? null : dragOp.id);
      }
    } else if (dragOp.kind === "resize-left") {
      const delta = dragOp.currentMs - dragOp.startMs;
      const newStart = Math.min(dragOp.origStart + delta, dragOp.origEnd - 100);
      onChange(sections.map((s) => s.id !== dragOp.id ? s : { ...s, startMs: newStart }));
    } else if (dragOp.kind === "resize-right") {
      const delta = dragOp.currentMs - dragOp.startMs;
      const newEnd = Math.max(dragOp.origEnd + delta, dragOp.origStart + 100);
      onChange(sections.map((s) => s.id !== dragOp.id ? s : { ...s, endMs: newEnd }));
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

  const startRename = (section: TimelineSection, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(section.id);
    setEditingName(section.name);
  };

  const commitRename = () => {
    if (!editingId) return;
    onChange(sections.map((s) => (s.id === editingId ? { ...s, name: editingName.trim() || "Section" } : s)));
    setEditingId(null);
  };

  const deleteSection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(sections.filter((s) => s.id !== id));
    if (activeSectionId === id) onActivate(null);
  };

  const trackCursor = !dragOp ? "crosshair"
    : dragOp.kind === "move" ? "grabbing"
    : dragOp.kind.startsWith("resize") ? "ew-resize"
    : "crosshair";

  return (
    <div className="relative flex border-b border-white/5 select-none" style={{ height: 28 }}>
      {/* Gutter */}
      <div
        className="text-[10px] text-gray-600 px-3 flex items-center border-r border-white/5 shrink-0"
        style={{ width: leftGutterPx }}
      >
        Sections
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative flex-1 overflow-hidden"
        style={{ cursor: trackCursor }}
        onMouseDown={handleTrackMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { if (dragOp) setDragOp(null); }}
      >
        {sections.map((section) => {
          const { startMs, endMs } = liveRange(section, dragOp);
          const leftFrac = Math.max(0, msToFrac(startMs));
          const rightFrac = Math.min(1, msToFrac(endMs));
          if (rightFrac <= leftFrac) return null;

          const isActive = activeSectionId === section.id;
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
                backgroundColor: `${color}${isActive ? "28" : "18"}`,
                border: `1px solid ${color}${isActive ? "bb" : "44"}`,
                boxShadow: isActive ? `0 0 0 1px ${color}44` : "none",
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
                onDoubleClick={(e) => startRename(section, e)}
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
                      onClick={(e) => startRename(section, e)}
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
      </div>
    </div>
  );
}
