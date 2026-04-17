"use client";

import { useMemo } from "react";
import type { LaneAnalysis, LaneBadge, LaneKey, LaneMap, NoteSpan, RecordedEvent, MidiMappingRule } from "@/lib/types";
import { laneKeyString } from "@/lib/types";
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
  flashLaneKey?: string | null;
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
    getAnalysisFor, getBadgesFor, onRequestAddBadge, onEditBadge, flashLaneKey,
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

  const headerCount = `${laneEntries.length} lane${laneEntries.length === 1 ? "" : "s"}`;

  return (
    <div className="border-b border-white/5">
      <div
        onClick={onToggleCollapsed}
        className="flex items-center gap-2 px-3 py-1.5 bg-black/20 text-accent text-xs font-semibold cursor-pointer select-none hover:bg-black/30"
      >
        <span>{collapsed ? "▸" : "▾"}</span>
        <span>{device}</span>
        <span className="ml-auto text-gray-600 font-normal">{headerCount}</span>
      </div>

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
                      onResize={(h) => onLaneResize(keyStr, h)}
                      laneKey={keyStr}
                      analysis={getAnalysisFor?.(keyStr)}
                      userBadges={getBadgesFor?.(keyStr)}
                      onRequestAddBadge={onRequestAddBadge}
                      onEditBadge={onEditBadge}
                      isFlashing={flashLaneKey === keyStr}
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
                      isFlashing={flashLaneKey === keyStr}
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
                      isFlashing={flashLaneKey === keyStr}
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
                      isFlashing={flashLaneKey === keyStr}
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
                      isFlashing={flashLaneKey === keyStr}
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
