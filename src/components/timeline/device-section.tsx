"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import type { LaneAnalysis, LaneBadge, LaneKey, LaneMap, NoteGroupTag, NoteSpan, RecordedEvent, MidiMappingRule } from "@/lib/types";
import { laneKeyString } from "@/lib/types";
import { midiNoteName, findNoteTag } from "@/lib/timeline-util";
import { NoteTagEditor } from "./note-tag-editor";
import { NotesLane } from "./notes-lane";
import { ContinuousLane } from "./continuous-lane";
import { ProgramLane } from "./program-lane";

interface DeviceSectionProps {
  device: string;
  laneMap: LaneMap;
  events: RecordedEvent[];
  noteSpans: NoteSpan[];               // pre-computed via pairNoteSpans for the whole recording
  mappingRules: MidiMappingRule[];     // for resolving OSC address names per lane
  viewStartMs: number;
  viewEndMs: number;
  leftGutterPx: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  bufferVersion?: number;
  onHoverEvent?: (evt: RecordedEvent | null, clientX: number, clientY: number) => void;
  onHoverSpan?: (span: NoteSpan | null, clientX: number, clientY: number) => void;
  getLaneHeight: (key: string, defaultPx: number) => number;
  onLaneResize: (key: string, newHeight: number) => void;
  getAnalysisFor?: (key: string) => LaneAnalysis | undefined;
  getBadgesFor?: (key: string) => LaneBadge[] | undefined;
  onRequestAddBadge?: (laneKey: string) => void;
  onEditBadge?: (badge: LaneBadge) => void;
  flashLaneKeys?: Set<string>;
  onDeleteDevice?: (deviceName: string) => void;
  selectedVelocity?: { pitch: number; velocity: number } | null;
  activeSectionRange?: { startMs: number; endMs: number } | null;
  onNoteClick?: (span: NoteSpan) => void;
  allGroups?: Array<{ pitch: number; velocity: number; count: number }>;
  hiddenNoteKeys?: Set<string>;
  onToggleNoteGroup?: (pitch: number, velocity: number) => void;
  noteTags?: NoteGroupTag[];
  onSaveNoteTag?: (tag: NoteGroupTag) => void;
  onDeleteNoteTag?: (id: string) => void;
  hiddenLanes: Set<string>;
  onHideLane: (key: string) => void;
  onShowLane: (key: string) => void;
}

const NOTES_HEIGHT = 48;
const CONT_HEIGHT = 22;
const MARKER_HEIGHT = 22;
const SUMMARY_HEIGHT = 22;

/**
 * Find an OSC address from a mapping rule that matches the given lane key, if any.
 * Used to show the user's named address (e.g. "/fader/master") alongside the lane label.
 */
function oscLabelFor(key: LaneKey, rules: MidiMappingRule[]): string | undefined {
  if (key.kind === "cc") {
    const r = rules.find((r) => r.type === "cc" && (r.channel === undefined || r.channel === key.channel) && (r.data1 === undefined || r.data1 === key.cc));
    return r?.address;
  }
  if (key.kind === "pitch") {
    const r = rules.find((r) => r.type === "pitch" && (r.channel === undefined || r.channel === key.channel));
    return r?.address;
  }
  if (key.kind === "aftertouch") {
    const r = rules.find((r) =>
      r.type === "aftertouch" &&
      (r.channel === undefined || r.channel === key.channel) &&
      (r.data1 === undefined || r.data1 === (key.note ?? r.data1))
    );
    return r?.address;
  }
  if (key.kind === "program") {
    const r = rules.find((r) => r.type === "program" && (r.channel === undefined || r.channel === key.channel));
    return r?.address;
  }
  return undefined;
}

export function DeviceSection(props: DeviceSectionProps) {
  const {
    device, laneMap, events, noteSpans, mappingRules,
    viewStartMs, viewEndMs, leftGutterPx, collapsed, onToggleCollapsed,
    bufferVersion, onHoverEvent, onHoverSpan,
    getLaneHeight, onLaneResize,
    getAnalysisFor, getBadgesFor, onRequestAddBadge, onEditBadge, flashLaneKeys,
    onDeleteDevice, selectedVelocity, activeSectionRange, onNoteClick,
    allGroups = [], hiddenNoteKeys, onToggleNoteGroup,
    noteTags = [], onSaveNoteTag, onDeleteNoteTag,
    hiddenLanes, onHideLane, onShowLane,
  } = props;

  const laneEntries = useMemo(() => {
    const list = Array.from(laneMap.values()).filter((entry) => keyDevice(entry.key) === device);
    // Order: notes first, then CCs sorted by channel then cc#, pitch, aftertouch, program.
    const rank = (k: LaneKey): number => {
      switch (k.kind) {
        case "notes":      return 0;
        case "cc":         return 1_000 + k.channel * 1000 + k.cc;
        case "pitch":      return 100_000 + k.channel;
        case "aftertouch": return 200_000 + k.channel * 1000 + (k.note ?? 0);
        case "program":    return 300_000 + k.channel;
      }
    };
    return list.sort((a, b) => rank(a.key) - rank(b.key));
  }, [laneMap, device]);

  const deviceNoteSpans = useMemo(
    () => noteSpans.filter((s) => s.device === device),
    [noteSpans, device]
  );

  const thisDeviceHiddenCount = laneEntries.filter((e) => hiddenLanes.has(laneKeyString(e.key))).length;
  const headerCount = `${laneEntries.length - thisDeviceHiddenCount} / ${laneEntries.length} lane${laneEntries.length === 1 ? "" : "s"}`;
  const hiddenCount = allGroups.filter((g) => hiddenNoteKeys?.has(`${g.pitch}|${g.velocity}`)).length;
  const [panelOpen, setPanelOpen] = useState(false);
  const [lanesOpen, setLanesOpen] = useState(false);
  const [tagEditor, setTagEditor] = useState<{
    pitch: number;
    velocity: number;
    anchorRect: DOMRect;
  } | null>(null);
  const lanesMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!lanesOpen) return;
    const handler = (e: MouseEvent) => {
      if (lanesMenuRef.current && !lanesMenuRef.current.contains(e.target as Node)) {
        setLanesOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [lanesOpen]);

  return (
    <div className="border-b border-white/5">
      {/* Device header row */}
      <div
        onClick={onToggleCollapsed}
        className="flex items-center gap-2 px-3 py-1.5 bg-black/20 text-accent text-xs font-semibold cursor-pointer select-none hover:bg-black/30"
      >
        <span>{collapsed ? "▸" : "▾"}</span>
        <span>{device}</span>
        <span className="ml-auto text-gray-600 font-normal">{headerCount}</span>

        {allGroups.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setPanelOpen((v) => !v); }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
              panelOpen
                ? "bg-accent/20 text-accent border-accent/30"
                : "text-gray-500 border-white/10 hover:text-gray-300 hover:border-white/20"
            }`}
            title="Note groups"
          >
            <span>Notes</span>
            {hiddenCount > 0 && <span className="text-gray-600">· ⊘{hiddenCount}</span>}
            <span>{panelOpen ? "▴" : "▾"}</span>
          </button>
        )}

        <div className="relative" ref={lanesMenuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setLanesOpen((v) => !v); }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
              lanesOpen
                ? "bg-accent/20 text-accent border-accent/30"
                : thisDeviceHiddenCount > 0
                  ? "text-amber-400 border-amber-400/30 hover:border-amber-400/50"
                  : "text-gray-500 border-white/10 hover:text-gray-300 hover:border-white/20"
            }`}
            title="Toggle lanes"
          >
            <span>Lanes</span>
            {thisDeviceHiddenCount > 0 && <span className="text-gray-600">· ⊘{thisDeviceHiddenCount}</span>}
            <span>{lanesOpen ? "▴" : "▾"}</span>
          </button>
          {lanesOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-30 rounded border border-white/10 min-w-[140px] py-1 overflow-hidden"
              style={{ background: "#0f0f1e", boxShadow: "0 8px 24px rgba(0,0,0,0.85)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {laneEntries.map((entry) => {
                const key = laneKeyString(entry.key);
                const hidden = hiddenLanes.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => hidden ? onShowLane(key) : onHideLane(key)}
                    className="w-full flex items-center gap-2 px-3 py-1 text-[10px] hover:bg-white/5 transition-colors text-left"
                  >
                    <span className={hidden ? "text-gray-600" : "text-accent"}>
                      {hidden ? "○" : "●"}
                    </span>
                    <span className={hidden ? "text-gray-600" : "text-gray-300"}>
                      {laneLabelShort(entry.key)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {onDeleteDevice && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteDevice(device); }}
            className="ml-1 text-gray-600 hover:text-red-400 transition-colors leading-none"
            title="Remove track"
          >
            ✕
          </button>
        )}
      </div>

      {/* Note groups panel — in-flow, full timeline width, same gutter layout as lanes */}
      {panelOpen && allGroups.length > 0 && (
        <div className="border-t border-white/5 bg-black/10">
          {allGroups.map(({ pitch, velocity, count }) => {
            const hidden = hiddenNoteKeys?.has(`${pitch}|${velocity}`) ?? false;
            const tag = findNoteTag(noteTags, device, pitch, velocity);
            const chipColor = tag ? tagColor(tag) : undefined;
            const isSelected = selectedVelocity?.pitch === pitch && selectedVelocity?.velocity === velocity;
            return (
              <div
                key={`${pitch}|${velocity}`}
                className="flex items-center border-t border-white/[0.03] first:border-t-0 group/row"
                style={{
                  height: 24,
                  background: isSelected ? "rgba(142,203,255,0.08)" : undefined,
                }}
              >
                {/* Gutter */}
                <div
                  className="flex items-center gap-2 px-3 border-r border-white/5 h-full shrink-0"
                  style={{
                    width: leftGutterPx,
                    borderLeft: isSelected ? "2px solid rgba(142,203,255,0.5)" : "2px solid transparent",
                  }}
                >
                  <button
                    onClick={() => onToggleNoteGroup?.(pitch, velocity)}
                    className={`text-[11px] leading-none transition-colors ${
                      hidden ? "text-gray-600 hover:text-gray-300" : "text-accent hover:text-white"
                    }`}
                    title={hidden ? "Show" : "Hide"}
                  >
                    {hidden ? "○" : "●"}
                  </button>
                  <span className={`font-mono text-[10px] ${hidden ? "text-gray-600" : "text-gray-300"}`}>
                    {midiNoteName(pitch)}
                  </span>
                  <span className="text-gray-600 text-[10px]">v{velocity}</span>
                  {tag ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTagEditor({ pitch, velocity, anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                      }}
                      className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border hover:opacity-80 transition-opacity"
                      style={{ color: chipColor, borderColor: `${chipColor}44`, background: `${chipColor}11` }}
                    >
                      <span>{tag.label}</span>
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTagEditor({ pitch, velocity, anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                      }}
                      className="ml-auto opacity-0 group-hover/row:opacity-100 text-[10px] text-gray-600 hover:text-gray-400 transition-all px-1.5 py-0.5 rounded border border-white/5 hover:border-white/15"
                    >
                      + tag
                    </button>
                  )}
                </div>
                {/* Track area */}
                <div className="flex-1 flex items-center px-3">
                  <span className="text-[10px] text-gray-700">{count}×</span>
                </div>
              </div>
            );
          })}
        </div>
      )}


      {tagEditor && (() => {
        const resolvedTag = findNoteTag(noteTags, device, tagEditor.pitch, tagEditor.velocity) ?? null;
        return (
          <NoteTagEditor
            tag={resolvedTag}
            device={device}
            pitch={tagEditor.pitch}
            velocity={tagEditor.velocity}
            existingLabels={[...new Set(noteTags.map((t) => t.label))]}
            anchorRect={tagEditor.anchorRect}
            onSave={(tag) => {
              onSaveNoteTag?.(tag);
              setTagEditor(null);
            }}
            onDelete={
              resolvedTag
                ? () => { onDeleteNoteTag?.(resolvedTag.id); setTagEditor(null); }
                : undefined
            }
            onClose={() => setTagEditor(null)}
          />
        );
      })()}

      {collapsed ? (
        <CollapsedSummaryRow
          entries={laneEntries}
          events={events}
          viewStartMs={viewStartMs}
          viewEndMs={viewEndMs}
          leftGutterPx={leftGutterPx}
        />
      ) : (
        <>
          {laneEntries.map((entry) => {
            const osc = oscLabelFor(entry.key, mappingRules);
            const keyStr = laneKeyString(entry.key);
            if (hiddenLanes.has(keyStr)) return null;
            switch (entry.key.kind) {
              case "notes":
                return (
                  <div data-lane-key={keyStr} key="notes">
                    <NotesLane
                      spans={deviceNoteSpans}
                      viewStartMs={viewStartMs}
                      viewEndMs={viewEndMs}
                      heightPx={getLaneHeight(keyStr, NOTES_HEIGHT)}
                      leftGutterPx={leftGutterPx}
                      onHover={onHoverSpan}
                      onNoteClick={onNoteClick}
                      selectedVelocity={selectedVelocity}
                      activeSectionRange={activeSectionRange}
                      hiddenNoteKeys={hiddenNoteKeys}
                      onResize={(h) => onLaneResize(keyStr, h)}
                      laneKey={keyStr}
                      analysis={getAnalysisFor?.(keyStr)}
                      userBadges={getBadgesFor?.(keyStr)}
                      onRequestAddBadge={onRequestAddBadge}
                      onEditBadge={onEditBadge}
                      isFlashing={flashLaneKeys?.has(keyStr) ?? false}
                      onHide={() => onHideLane(keyStr)}
                      noteTags={noteTags}
                    />
                  </div>
                );
              case "cc":
                return (
                  <div data-lane-key={keyStr} key={`cc|${entry.key.channel}|${entry.key.cc}`}>
                    <ContinuousLane
                      label={`CC ${entry.key.cc} · ch${entry.key.channel}`}
                      sublabel={osc}
                      events={events}
                      eventIndices={entry.eventIndices}
                      viewStartMs={viewStartMs}
                      viewEndMs={viewEndMs}
                      heightPx={getLaneHeight(keyStr, CONT_HEIGHT)}
                      leftGutterPx={leftGutterPx}
                      color="#c7f168"
                      fill="rgba(199,241,104,0.10)"
                      bufferVersion={bufferVersion}
                      onHover={onHoverEvent}
                      onResize={(h) => onLaneResize(keyStr, h)}
                      laneKey={keyStr}
                      analysis={getAnalysisFor?.(keyStr)}
                      userBadges={getBadgesFor?.(keyStr)}
                      onRequestAddBadge={onRequestAddBadge}
                      onEditBadge={onEditBadge}
                      isFlashing={flashLaneKeys?.has(keyStr) ?? false}
                      onHide={() => onHideLane(keyStr)}
                    />
                  </div>
                );
              case "pitch":
                return (
                  <div data-lane-key={keyStr} key={`pitch|${entry.key.channel}`}>
                    <ContinuousLane
                      label={`Pitch · ch${entry.key.channel}`}
                      sublabel={osc}
                      events={events}
                      eventIndices={entry.eventIndices}
                      viewStartMs={viewStartMs}
                      viewEndMs={viewEndMs}
                      heightPx={getLaneHeight(keyStr, CONT_HEIGHT)}
                      leftGutterPx={leftGutterPx}
                      color="#ffaed7"
                      fill="rgba(255,174,215,0.10)"
                      valueMapper={(v) => (v + 1) / 2}
                      bufferVersion={bufferVersion}
                      onHover={onHoverEvent}
                      onResize={(h) => onLaneResize(keyStr, h)}
                      laneKey={keyStr}
                      analysis={getAnalysisFor?.(keyStr)}
                      userBadges={getBadgesFor?.(keyStr)}
                      onRequestAddBadge={onRequestAddBadge}
                      onEditBadge={onEditBadge}
                      isFlashing={flashLaneKeys?.has(keyStr) ?? false}
                      onHide={() => onHideLane(keyStr)}
                    />
                  </div>
                );
              case "aftertouch": {
                const labelSuffix = entry.key.note !== undefined ? ` #${entry.key.note}` : "";
                return (
                  <div data-lane-key={keyStr} key={`at|${entry.key.channel}|${entry.key.note ?? "ch"}`}>
                    <ContinuousLane
                      label={`AT · ch${entry.key.channel}${labelSuffix}`}
                      sublabel={osc}
                      events={events}
                      eventIndices={entry.eventIndices}
                      viewStartMs={viewStartMs}
                      viewEndMs={viewEndMs}
                      heightPx={getLaneHeight(keyStr, CONT_HEIGHT)}
                      leftGutterPx={leftGutterPx}
                      color="#ffaed7"
                      fill="rgba(255,174,215,0.08)"
                      bufferVersion={bufferVersion}
                      onHover={onHoverEvent}
                      onResize={(h) => onLaneResize(keyStr, h)}
                      laneKey={keyStr}
                      analysis={getAnalysisFor?.(keyStr)}
                      userBadges={getBadgesFor?.(keyStr)}
                      onRequestAddBadge={onRequestAddBadge}
                      onEditBadge={onEditBadge}
                      isFlashing={flashLaneKeys?.has(keyStr) ?? false}
                      onHide={() => onHideLane(keyStr)}
                    />
                  </div>
                );
              }
              case "program":
                return (
                  <div data-lane-key={keyStr} key={`prog|${entry.key.channel}`}>
                    <ProgramLane
                      label={`Program · ch${entry.key.channel}`}
                      sublabel={osc}
                      events={events}
                      eventIndices={entry.eventIndices}
                      viewStartMs={viewStartMs}
                      viewEndMs={viewEndMs}
                      heightPx={getLaneHeight(keyStr, MARKER_HEIGHT)}
                      leftGutterPx={leftGutterPx}
                      onHover={onHoverEvent}
                      onResize={(h) => onLaneResize(keyStr, h)}
                      laneKey={keyStr}
                      analysis={getAnalysisFor?.(keyStr)}
                      userBadges={getBadgesFor?.(keyStr)}
                      onRequestAddBadge={onRequestAddBadge}
                      onEditBadge={onEditBadge}
                      isFlashing={flashLaneKeys?.has(keyStr) ?? false}
                      onHide={() => onHideLane(keyStr)}
                    />
                  </div>
                );
            }
          })}
        </>
      )}
    </div>
  );
}

function keyDevice(k: LaneKey): string { return k.device; }

function laneLabelShort(k: LaneKey): string {
  switch (k.kind) {
    case "notes":      return "Notes";
    case "cc":         return `CC ${k.cc} ch${k.channel}`;
    case "pitch":      return `Pitch ch${k.channel}`;
    case "aftertouch": return k.note !== undefined ? `AT ch${k.channel} #${k.note}` : `AT ch${k.channel}`;
    case "program":    return `Prog ch${k.channel}`;
  }
}

function tagColor(tag: NoteGroupTag): string {
  if (tag.color) return tag.color;
  let h = 0;
  for (let i = 0; i < tag.label.length; i++) h = (h * 31 + tag.label.charCodeAt(i)) & 0xffffff;
  return `hsl(${h % 360},55%,65%)`;
}

interface CollapsedSummaryRowProps {
  entries: Array<{ key: LaneKey; eventIndices: number[] }>;
  events: RecordedEvent[];
  viewStartMs: number;
  viewEndMs: number;
  leftGutterPx: number;
}

function CollapsedSummaryRow({ entries, events, viewStartMs, viewEndMs, leftGutterPx }: CollapsedSummaryRowProps) {
  // Collapse all event indices into a single viewport density bar.
  const viewSpan = Math.max(1, viewEndMs - viewStartMs);
  const BIN_COUNT = 40;
  const bins = new Array<number>(BIN_COUNT).fill(0);
  for (const entry of entries) {
    for (const idx of entry.eventIndices) {
      const t = events[idx].tRel;
      if (t < viewStartMs || t >= viewEndMs) continue;
      const bin = Math.min(BIN_COUNT - 1, Math.floor(((t - viewStartMs) / viewSpan) * BIN_COUNT));
      bins[bin]++;
    }
  }
  const maxCount = Math.max(1, ...bins);

  return (
    <div className="relative flex border-t border-white/5" style={{ height: SUMMARY_HEIGHT }}>
      <div
        className="text-[10px] text-gray-700 px-3 flex items-center border-r border-white/5"
        style={{ width: leftGutterPx, flexShrink: 0 }}
      >
        (expand)
      </div>
      <div className="flex-1 relative">
        {bins.map((c, i) => {
          if (c === 0) return null;
          const alpha = 0.25 + 0.5 * (c / maxCount);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${(i / BIN_COUNT) * 100}%`,
                width: `${(1 / BIN_COUNT) * 100}%`,
                top: 4,
                bottom: 4,
                background: `rgba(142,203,255,${alpha})`,
                borderRadius: 2,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
