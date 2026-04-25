"use client";

import { useRef, useMemo, useState, useEffect, Fragment } from "react";
import type { LaneAnalysis, LaneBadge, LaneKey, LaneMap, NoteGroupTag, NoteSpan, RecordedEvent, MidiMappingRule, OscMapping, SavedEndpoint, TimelineSection } from "@/lib/types";
import type { OscEffect } from "@/lib/osc-effect-types";
import { laneKeyString } from "@/lib/types";
import { midiNoteName, findNoteTag } from "@/lib/timeline-util";
import { resolveOscAddress } from "@/lib/osc-mapping";
import { NoteTagEditor } from "./note-tag-editor";
import { OscMappingEditor } from "./osc-mapping-editor";
import { NotesLane, type NoteFlashRef } from "./notes-lane";
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
  onDeleteBadge?: (id: string) => void;
  suppressedAnalysis?: Set<string>;
  onSuppressAnalysis?: (laneKey: string, type: "rhythm" | "dynamic" | "melody") => void;
  flashLaneKeys?: Set<string>;
  onDeleteDevice?: (deviceName: string) => void;
  displayName?: string;
  onRenameDevice?: (newName: string) => void;
  deviceAliases?: Record<string, string>;
  selectedVelocity?: { pitch: number; velocity: number } | null;
  activeSectionRange?: { startMs: number; endMs: number } | null;
  activeSectionName?: string;
  onNoteClick?: (span: NoteSpan) => void;
  allGroups?: Array<{ pitch: number; velocity: number; count: number }>;
  hiddenNoteKeys?: Set<string>;
  sidebarHiddenNoteKeys?: Set<string>;
  sectionHiddenRanges?: Array<{ pitch: number; velocity: number; startMs: number; endMs: number }>;
  onToggleNoteGroup?: (pitch: number, velocity: number) => void;
  onSelectGroup?: (pitch: number, velocity: number) => void;
  noteTags?: NoteGroupTag[];
  onSaveNoteTag?: (tag: NoteGroupTag) => void;
  onDeleteNoteTag?: (id: string) => void;
  oscMappings?: OscMapping[];
  endpoints?: SavedEndpoint[];
  sections?: TimelineSection[];
  focusedSectionId?: string | null;
  onOpenLaneMapping?: (laneKey: LaneKey) => void;
  onAddOscMapping?: (mapping: OscMapping) => void;
  onUpdateOscMapping?: (mapping: OscMapping) => void;
  onDeleteOscMapping?: (id: string) => void;
  hiddenLanes: Set<string>;
  onHideLane: (key: string) => void;
  onShowLane: (key: string) => void;
  noteFlashRef?: React.RefObject<NoteFlashRef>;
  colorIndex?: number;
  dmxEffects?: import("@/lib/dmx-types").DmxEffect[];
  oscEffects?: OscEffect[];
}

const DEVICE_COLORS = [
  "#4488ff", // blue
  "#f59e0b", // amber
  "#a78bfa", // violet
  "#34d399", // emerald
  "#f472b6", // pink
  "#38bdf8", // sky
  "#fb923c", // orange
  "#c084fc", // purple
  "#4ade80", // green
  "#fbbf24", // yellow
];

const NOTES_HEIGHT = 48;
const CONT_HEIGHT = 36;
const MARKER_HEIGHT = 28;
const SUMMARY_HEIGHT = 22;

function LaneControlsPopover({
  actions,
}: {
  actions: Array<{ label: string; onClick: () => void; danger?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="px-1 text-gray-500 hover:text-white"
        title="Lane options"
      >⋯</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[180px] bg-black border border-white/10 rounded shadow-xl">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => { a.onClick(); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 ${a.danger ? "text-red-400" : "text-gray-300 hover:text-white"}`}
            >{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Find an OSC address from a mapping rule that matches the given lane key, if any.
 * Used to show the user's named address (e.g. "/fader/master") alongside the lane label.
 */
function dmxEffectLabel(effectId: string | undefined, effects?: import("@/lib/dmx-types").DmxEffect[]): string {
  if (!effectId) return "DMX: —";
  const eff = effects?.find((e) => e.id === effectId);
  return `DMX: ${eff?.name ?? effectId.slice(0, 8)}`;
}

function oscEffectLabel(mapping: OscMapping, oscEffects: OscEffect[]): string | null {
  if (!mapping.oscEffectId) return null;
  const eff = oscEffects.find((e) => e.id === mapping.oscEffectId);
  return `FX: ${eff ? eff.name : mapping.oscEffectId.slice(0, 8)}`;
}

function oscLabelFor(
  key: LaneKey,
  rules: MidiMappingRule[],
  oscMappings: OscMapping[],
  deviceAliases?: Record<string, string>,
  focusedSectionId?: string,
  dmxEffects?: import("@/lib/dmx-types").DmxEffect[],
  oscEffects?: OscEffect[],
): string | undefined {
  const keyStr = laneKeyString(key);
  const om = oscMappings.find(
    (m) =>
      m.targetType === "lane" &&
      m.targetId === keyStr &&
      (focusedSectionId ? m.sectionId === focusedSectionId : !m.sectionId),
  );
  if (om) {
    if (om.outputType === "dmx") return dmxEffectLabel(om.dmxEffectId, dmxEffects);
    if (om.oscEffectId && oscEffects) return oscEffectLabel(om, oscEffects) ?? resolveOscAddress(om, deviceAliases);
    return resolveOscAddress(om, deviceAliases);
  }
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
    getAnalysisFor, getBadgesFor, onRequestAddBadge, onEditBadge, onDeleteBadge,
    suppressedAnalysis, onSuppressAnalysis, flashLaneKeys,
    onDeleteDevice, displayName, onRenameDevice, deviceAliases, selectedVelocity, activeSectionRange, activeSectionName, onNoteClick,
    allGroups = [], hiddenNoteKeys, sidebarHiddenNoteKeys, sectionHiddenRanges, onToggleNoteGroup, onSelectGroup,
    noteTags = [], onSaveNoteTag, onDeleteNoteTag,
    oscMappings = [], endpoints = [], sections = [], focusedSectionId, onOpenLaneMapping, onAddOscMapping, onUpdateOscMapping, onDeleteOscMapping,
    hiddenLanes, onHideLane, onShowLane, noteFlashRef, colorIndex = 0, dmxEffects, oscEffects = [],
  } = props;

  const deviceColor = DEVICE_COLORS[colorIndex % DEVICE_COLORS.length];

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
  const [panelOpen, setPanelOpen] = useState(false);
  const [lanesOpen, setLanesOpen] = useState(false);
  const [filterTagged, setFilterTagged] = useState(false);
  const [combineVelocity, setCombineVelocity] = useState(false);
  const [tagEditor, setTagEditor] = useState<{
    pitch: number;
    velocity: number;
    anchorRect: DOMRect;
  } | null>(null);
  const [oscEditor, setOscEditor] = useState<{
    targetType: "noteGroup" | "lane";
    targetId: string;
    anchorRect: DOMRect;
    editingMapping?: OscMapping;
  } | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editValue, setEditValue] = useState("");
  const startNameEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(displayName ?? device);
    setIsEditingName(true);
  };

  const commitNameEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== device) onRenameDevice?.(trimmed);
    setIsEditingName(false);
  };

  const cancelNameEdit = () => setIsEditingName(false);

  const defaultEndpointId = useMemo(
    () => oscMappings.length > 0 ? oscMappings[oscMappings.length - 1].endpointId : endpoints[0]?.id,
    [oscMappings, endpoints]
  );
  const lanesMenuRef = useRef<HTMLDivElement | null>(null);

  // Merged/filtered rows for the panel
  const displayGroups = useMemo(() => {
    type DisplayGroup = {
      key: string;
      pitch: number;
      velocity: number | null;
      velocities: number[];
      count: number;
    };

    let groups: DisplayGroup[];

    if (combineVelocity) {
      const byPitch = new Map<number, { velocities: number[]; count: number }>();
      for (const g of allGroups) {
        const entry = byPitch.get(g.pitch) ?? { velocities: [], count: 0 };
        entry.velocities.push(g.velocity);
        entry.count += g.count;
        byPitch.set(g.pitch, entry);
      }
      groups = Array.from(byPitch.entries()).map(([pitch, { velocities, count }]) => ({
        key: `${pitch}|combined`,
        pitch,
        velocity: null,
        velocities,
        count,
      }));
    } else {
      groups = allGroups.map((g) => ({
        key: `${g.pitch}|${g.velocity}`,
        pitch: g.pitch,
        velocity: g.velocity,
        velocities: [g.velocity],
        count: g.count,
      }));
    }

    if (filterTagged) {
      groups = groups.filter((g) =>
        g.velocities.some((v) => !!findNoteTag(noteTags, device, g.pitch, v))
      );
    }

    return groups;
  }, [allGroups, combineVelocity, filterTagged, noteTags, device]);

  // Keys to hide on the canvas (merges parent hidden set with filter state)
  const effectiveHiddenKeys = useMemo(() => {
    if (!filterTagged) return hiddenNoteKeys;
    const extra = new Set(hiddenNoteKeys);
    for (const g of allGroups) {
      if (!findNoteTag(noteTags, device, g.pitch, g.velocity)) {
        extra.add(`${g.pitch}|${g.velocity}`);
      }
    }
    return extra;
  }, [filterTagged, hiddenNoteKeys, allGroups, noteTags, device]);

  const hiddenCount = allGroups.filter((g) => effectiveHiddenKeys?.has(`${g.pitch}|${g.velocity}`)).length;

  const handleAddAllUnrealMappings = (e: React.MouseEvent) => {
    e.stopPropagation();
    const endpointId = defaultEndpointId ?? endpoints[0]?.id;
    if (!endpointId || allGroups.length === 0) return;
    const sectionName = activeSectionName ?? sections[0]?.name ?? "default";
    for (const g of allGroups) {
      const targetId = `${g.pitch}|${g.velocity}`;
      const alreadyHasUnreal = oscMappings.some(
        (m) => m.targetType === "noteGroup" && m.targetId === targetId && m.deviceId === device && m.preset === "unreal"
      );
      if (alreadyHasUnreal) continue;
      onAddOscMapping?.({
        id: crypto.randomUUID(),
        targetType: "noteGroup",
        targetId,
        deviceId: device,
        endpointId,
        preset: "unreal",
        trigger: "on",
        argType: "f",
        address: "/",
        sectionName,
        unrealType: "parameter",
        unrealName: "param",
        resolumeMode: "column",
        resolumeColumn: 1,
        resolumeLayer: 1,
        resolumeClip: 1,
      });
    }
  };

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
    <div className="border-b border-white/10">
      {/* Device header row */}
      <div
        onClick={onToggleCollapsed}
        className="group flex items-center gap-2 px-3 py-1.5 text-xs font-semibold cursor-pointer select-none transition-colors text-white"
        style={{ background: `${deviceColor}18`, borderLeft: `3px solid ${deviceColor}` }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = `${deviceColor}28`; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = `${deviceColor}18`; }}
      >
        <span>{collapsed ? "▸" : "▾"}</span>
        {isEditingName ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitNameEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitNameEdit(); }
              if (e.key === "Escape") cancelNameEdit();
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-elevated rounded px-1 text-xs text-white font-semibold focus:outline-none min-w-[60px]"
            style={{ width: Math.max(60, editValue.length * 7), borderWidth: 1, borderStyle: "solid", borderColor: `${deviceColor}66` }}
          />
        ) : (
          <span
            className="group/devname flex items-center gap-1 cursor-default"
            onDoubleClick={onRenameDevice ? startNameEdit : undefined}
            title={onRenameDevice ? "Double-click to rename" : undefined}
          >
            {displayName ?? device}
            {onRenameDevice && (
              <span
                className="opacity-0 group-hover/devname:opacity-50 text-[9px] text-gray-500 hover:text-gray-300 cursor-pointer leading-none"
                onClick={startNameEdit}
              >
                ✎
              </span>
            )}
          </span>
        )}
        {allGroups.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setPanelOpen((v) => !v); }}
            className={`ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
              panelOpen
                ? ""
                : "text-gray-500 border-white/10 hover:text-gray-300 hover:border-white/20"
            }`}
            style={panelOpen ? { color: deviceColor, background: `${deviceColor}33`, borderColor: `${deviceColor}4d` } : undefined}
            title="Note groups"
          >
            <span>Notes</span>
            {hiddenCount > 0 && <span className="text-gray-600">· ⊘{hiddenCount}</span>}
            <span>{panelOpen ? "▴" : "▾"}</span>
          </button>
        )}

        {allGroups.length > 0 && endpoints.length > 0 && (
          <button
            onClick={handleAddAllUnrealMappings}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors text-gray-500 border-white/10 hover:text-gray-300 hover:border-white/20"
            title="Add Unreal Engine OSC mapping for all note groups"
          >
            + OSC
          </button>
        )}

        <div className="relative" ref={lanesMenuRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setLanesOpen((v) => !v); }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
              lanesOpen
                ? ""
                : "text-gray-500 border-white/10 hover:text-gray-300 hover:border-white/20"
            }`}
            style={lanesOpen ? { color: deviceColor, background: `${deviceColor}33`, borderColor: `${deviceColor}4d` } : undefined}
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
                    <span style={hidden ? undefined : { color: deviceColor }}>
                      {hidden ? <span className="text-gray-600">○</span> : "●"}
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

        {(onDeleteDevice || onRenameDevice) && (
          <LaneControlsPopover
            actions={[
              ...(onRenameDevice ? [{ label: "Rename device…", onClick: () => { setEditValue(displayName ?? device); setIsEditingName(true); } }] : []),
              ...(onDeleteDevice ? [{ label: "Delete device", danger: true, onClick: () => onDeleteDevice(device) }] : []),
            ]}
          />
        )}
      </div>

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
            onMapToOsc={() => {
              setTagEditor(null);
              setOscEditor({
                targetType: "noteGroup",
                targetId: `${tagEditor.pitch}|${tagEditor.velocity}`,
                anchorRect: tagEditor.anchorRect,
              });
            }}
          />
        );
      })()}

      {oscEditor && (
        <OscMappingEditor
          targetType={oscEditor.targetType}
          targetId={oscEditor.targetId}
          deviceId={device}
          mappings={oscMappings.filter(
            (m) => m.targetType === oscEditor.targetType && m.targetId === oscEditor.targetId && m.deviceId === device
          )}
          endpoints={endpoints}
          defaultEndpointId={defaultEndpointId}
          sections={sections}
          defaultSectionName={activeSectionName}
          defaultMapping={oscMappings.filter((m) => m.deviceId === device).slice(-1)[0]}
          anchorRect={oscEditor.anchorRect}
          deviceAliases={deviceAliases}
          sectionId={focusedSectionId}
          dmxEffects={dmxEffects}
          editingMapping={oscEditor.editingMapping}
          onAdd={(mapping) => { onAddOscMapping?.(mapping); }}
          onUpdate={(mapping) => { onUpdateOscMapping?.(mapping); setOscEditor(null); }}
          onDelete={(id) => { onDeleteOscMapping?.(id); }}
          onClose={() => setOscEditor(null)}
        />
      )}

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
            const osc = oscLabelFor(entry.key, mappingRules, oscMappings, deviceAliases, focusedSectionId ?? undefined, dmxEffects, oscEffects);
            const keyStr = laneKeyString(entry.key);
            if (hiddenLanes.has(keyStr)) return null;
            switch (entry.key.kind) {
              case "notes":
                return (
                  <Fragment key="notes">
                    <div data-lane-key={keyStr} className="relative group">
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
                        hiddenNoteKeys={effectiveHiddenKeys}
                        sectionHiddenRanges={sectionHiddenRanges}
                        onResize={(h) => onLaneResize(keyStr, h)}
                        laneKey={keyStr}
                        analysis={getAnalysisFor?.(keyStr)}
                        userBadges={getBadgesFor?.(keyStr)}
                        onRequestAddBadge={onRequestAddBadge}
                        onEditBadge={onEditBadge}
                        onDeleteBadge={onDeleteBadge}
                        suppressedAnalysisTypes={suppressedAnalysis ? suppressedTypesFor(suppressedAnalysis, keyStr) : undefined}
                        onSuppressAnalysisBadge={(type) => onSuppressAnalysis?.(keyStr, type)}
                        isFlashing={flashLaneKeys?.has(keyStr) ?? false}
                        noteTags={noteTags}
                        oscMappings={oscMappings}
                        focusedSectionId={focusedSectionId}
                        onOpenNoteGroupMapping={(pitch, vel) => {
                          setOscEditor({
                            targetType: "noteGroup",
                            targetId: `${pitch}|${vel ?? "any"}`,
                            anchorRect: new DOMRect(0, 0, 0, 0),
                          });
                        }}
                        flashRef={noteFlashRef}
                      />
                      <div className="absolute top-0.5 right-1 flex items-center" style={{ left: leftGutterPx - 24, width: 20 }}>
                        <LaneControlsPopover
                          actions={[
                            { label: "Hide lane", onClick: () => onHideLane(keyStr) },
                            ...(onSuppressAnalysis ? [
                              { label: "Suppress: rhythm", onClick: () => onSuppressAnalysis(keyStr, "rhythm") },
                              { label: "Suppress: dynamic", onClick: () => onSuppressAnalysis(keyStr, "dynamic") },
                              { label: "Suppress: melody", onClick: () => onSuppressAnalysis(keyStr, "melody") },
                            ] : []),
                          ]}
                        />
                      </div>
                    </div>
                    {panelOpen && allGroups.length > 0 && (
                      <div className="border-t border-white/10 bg-black/10">
                        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-white/[0.04]">
                          <button
                            onClick={() => setFilterTagged((v) => !v)}
                            className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                              filterTagged
                                ? ""
                                : "text-gray-600 border-white/10 hover:text-gray-400 hover:border-white/20"
                            }`}
                            style={filterTagged ? { color: deviceColor, background: `${deviceColor}33`, borderColor: `${deviceColor}4d` } : undefined}
                          >
                            tagged only
                          </button>
                          <button
                            onClick={() => setCombineVelocity((v) => !v)}
                            className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                              combineVelocity
                                ? ""
                                : "text-gray-600 border-white/10 hover:text-gray-400 hover:border-white/20"
                            }`}
                            style={combineVelocity ? { color: deviceColor, background: `${deviceColor}33`, borderColor: `${deviceColor}4d` } : undefined}
                          >
                            combine vel
                          </button>
                        </div>
                        {(() => {
                          const viewSpan = Math.max(1, viewEndMs - viewStartMs);
                          const sectionLeftPct = (sName: string | undefined): string => {
                            if (!sName) return "0%";
                            const sec = sections.find((s) => s.name === sName);
                            if (!sec) return "0%";
                            const frac = Math.max(0, (sec.startMs - viewStartMs) / viewSpan);
                            return `${frac * 100}%`;
                          };
                          return displayGroups.map(({ key, pitch, velocity, velocities, count }) => {
                          const hiddenKeys = sidebarHiddenNoteKeys ?? effectiveHiddenKeys;
                          const hidden = velocities.every((v) => hiddenKeys?.has(`${pitch}|${v}`));
                          const tag = velocity !== null
                            ? findNoteTag(noteTags, device, pitch, velocity)
                            : noteTags.find((t) => t.device === device && t.pitch === pitch && t.velocity === null) ??
                              (velocities.length > 0 ? findNoteTag(noteTags, device, pitch, velocities[0]) : undefined);
                          const chipColor = tag ? tagColor(tag) : undefined;
                          const isSelected = velocity !== null
                            ? selectedVelocity?.pitch === pitch && selectedVelocity?.velocity === velocity
                            : selectedVelocity?.pitch === pitch;
                          const handleToggle = () => { for (const v of velocities) onToggleNoteGroup?.(pitch, v); };
                          const handleSelect = () => { if (velocity !== null) onSelectGroup?.(pitch, velocity); };
                          const tagVelocity = velocity ?? velocities[0];
                          const hasMidi = noteFlashRef ? velocities.some((v) => noteFlashRef.current.midi.has(`${device}|${pitch}|${v}`)) : false;
                          const hasOsc = noteFlashRef ? velocities.some((v) => noteFlashRef.current.osc.has(`${device}|${pitch}|${v}`)) : false;
                          return (
                            <div
                              key={key}
                              className="flex items-center border-t border-white/[0.03] first:border-t-0 group/row"
                              style={{
                                height: 24,
                                background: hasMidi ? (hasOsc ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)") : isSelected ? "rgba(142,203,255,0.08)" : undefined,
                                cursor: velocity !== null ? "pointer" : "default",
                              }}
                              onClick={handleSelect}
                            >
                              <div
                                className="flex items-center gap-2 px-3 border-r border-white/10 h-full shrink-0"
                                style={{
                                  width: leftGutterPx,
                                  borderLeft: hasMidi ? (hasOsc ? "2px solid rgba(74,222,128,0.7)" : "2px solid rgba(248,113,113,0.7)") : isSelected ? "2px solid rgba(142,203,255,0.5)" : "2px solid transparent",
                                }}
                              >
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleToggle(); }}
                                  className={`text-[11px] leading-none transition-colors ${
                                    hidden ? "text-gray-600 hover:text-gray-300" : "hover:text-white"
                                  }`}
                                  style={hidden ? undefined : { color: deviceColor }}
                                  title={hidden ? "Show" : "Hide"}
                                >
                                  {hidden ? "○" : "●"}
                                </button>
                                <span className={`font-mono text-[10px] ${hidden ? "text-gray-600" : "text-gray-300"}`}>
                                  {midiNoteName(pitch)}
                                </span>
                                <span className={`font-mono text-[10px] ${hidden ? "text-gray-700" : "text-gray-600"}`}>
                                  {pitch}
                                </span>
                                {velocity !== null && (
                                  <span className="text-gray-600 text-[10px]">v{velocity}</span>
                                )}
                                <div className="ml-auto flex items-center gap-1">
                                  {tag ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTagEditor({ pitch, velocity: tagVelocity, anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                                      }}
                                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border hover:opacity-80 transition-opacity"
                                      style={{ color: chipColor, borderColor: `${chipColor}44`, background: `${chipColor}11` }}
                                    >
                                      <span>{tag.label}</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTagEditor({ pitch, velocity: tagVelocity, anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                                      }}
                                      className="opacity-0 group-hover/row:opacity-100 text-[10px] text-gray-600 hover:text-gray-400 transition-all px-1 py-px rounded border border-white/5 hover:border-white/15 leading-none"
                                    >
                                      + tag
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOscEditor({
                                        targetType: "noteGroup",
                                        targetId: `${pitch}|${tagVelocity}`,
                                        anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                                      });
                                    }}
                                    className="opacity-30 group-hover/row:opacity-100 text-[10px] text-gray-500 transition-all px-2 py-0.5 rounded border border-white/5 leading-none shrink-0 hover:opacity-100"
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = deviceColor; (e.currentTarget as HTMLElement).style.borderColor = `${deviceColor}4d`; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = ""; (e.currentTarget as HTMLElement).style.borderColor = ""; }}
                                  >
                                    + OSC
                                  </button>
                                </div>
                              </div>
                              {(() => {
                                const rowMappings = oscMappings.filter(
                                  (m) => m.targetType === "noteGroup" && m.targetId === `${pitch}|${tagVelocity}` && m.deviceId === device
                                );
                                const grouped = new Map<string, typeof rowMappings>();
                                for (const m of rowMappings) {
                                  const sKey = m.sectionName ?? "__none__";
                                  if (!grouped.has(sKey)) grouped.set(sKey, []);
                                  grouped.get(sKey)!.push(m);
                                }
                                return (
                                  <div className="relative flex-1 h-full overflow-hidden" style={{ minHeight: 24 }}>
                                    {/* Count badge — far right, always visible */}
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-700 pointer-events-none">
                                      {count}×
                                    </span>
                                    {/* Chips — grouped by section, positioned at section startMs */}
                                    {Array.from(grouped.entries()).map(([sKey, chips]) => {
                                      const sec = sKey !== "__none__" ? sections.find((s) => s.name === sKey) : undefined;
                                      if (sec && (sec.endMs < viewStartMs || sec.startMs > viewEndMs)) return null;
                                      const secColor = sec?.color;
                                      return (
                                        <div
                                          key={sKey}
                                          className="absolute flex items-center gap-1 top-1/2 -translate-y-1/2"
                                          style={{ left: sectionLeftPct(sKey === "__none__" ? undefined : sKey) }}
                                        >
                                          {chips.map((m) => (
                                            <div
                                              key={m.id}
                                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border shrink-0 cursor-pointer transition-colors"
                                              style={secColor ? {
                                                borderColor: `${secColor}55`,
                                                background: `${secColor}18`,
                                                color: secColor,
                                              } : m.outputType === "dmx" ? {
                                                borderColor: "rgba(168,85,247,0.3)",
                                                background: "rgba(168,85,247,0.08)",
                                                color: "rgba(168,85,247,0.85)",
                                              } : m.oscEffectId ? {
                                                borderColor: "rgba(20,184,166,0.3)",
                                                background: "rgba(20,184,166,0.08)",
                                                color: "rgba(45,212,191,0.9)",
                                              } : {
                                                borderColor: "rgba(142,203,255,0.2)",
                                                background: "rgba(142,203,255,0.05)",
                                                color: "rgba(142,203,255,0.8)",
                                              }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setOscEditor({
                                                  targetType: "noteGroup",
                                                  targetId: `${pitch}|${tagVelocity}`,
                                                  anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                                                  editingMapping: m,
                                                });
                                              }}
                                            >
                                              <span className="font-mono truncate max-w-[120px]">{m.outputType === "dmx" ? dmxEffectLabel(m.dmxEffectId, dmxEffects) : (m.oscEffectId ? oscEffectLabel(m, oscEffects) : null) ?? resolveOscAddress(m, deviceAliases)}</span>
                                              <button
                                                onClick={(e) => { e.stopPropagation(); onDeleteOscMapping?.(m.id); }}
                                                className="opacity-40 hover:text-red-400 leading-none transition-colors"
                                              >×</button>
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          );
                          });
                        })()}
                      </div>
                    )}
                  </Fragment>
                );
              case "cc":
                return (
                  <div data-lane-key={keyStr} key={`cc|${entry.key.channel}|${entry.key.cc}`} className="relative group">
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
                      onDeleteBadge={onDeleteBadge}
                      suppressedAnalysisTypes={suppressedAnalysis ? suppressedTypesFor(suppressedAnalysis, keyStr) : undefined}
                      onSuppressAnalysisBadge={(type) => onSuppressAnalysis?.(keyStr, type)}
                      isFlashing={flashLaneKeys?.has(keyStr) ?? false}
                      onRequestOscEditor={(targetId, anchorRect) => {
                        setOscEditor({ targetType: "lane", targetId, anchorRect });
                      }}
                      mapping={oscMappings.find((m) => m.targetType === "lane" && m.targetId === laneKeyString(entry.key) && (focusedSectionId ? m.sectionId === focusedSectionId : !m.sectionId)) ?? null}
                      onOpenMapping={(e) => {
                        const existing = oscMappings.find((m) => m.targetType === "lane" && m.targetId === laneKeyString(entry.key) && (focusedSectionId ? m.sectionId === focusedSectionId : !m.sectionId));
                        setOscEditor({ targetType: "lane", targetId: laneKeyString(entry.key), anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(), editingMapping: existing });
                        onOpenLaneMapping?.(entry.key);
                      }}
                    />
                    <div className="absolute top-0.5 flex items-center" style={{ left: leftGutterPx - 24, width: 20 }}>
                      <LaneControlsPopover
                        actions={[
                          { label: "Hide lane", onClick: () => onHideLane(keyStr) },
                          ...(onSuppressAnalysis ? [
                            { label: "Suppress: rhythm", onClick: () => onSuppressAnalysis(keyStr, "rhythm") },
                            { label: "Suppress: dynamic", onClick: () => onSuppressAnalysis(keyStr, "dynamic") },
                            { label: "Suppress: melody", onClick: () => onSuppressAnalysis(keyStr, "melody") },
                          ] : []),
                        ]}
                      />
                    </div>
                  </div>
                );
              case "pitch":
                return (
                  <div data-lane-key={keyStr} key={`pitch|${entry.key.channel}`} className="relative group">
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
                      onDeleteBadge={onDeleteBadge}
                      suppressedAnalysisTypes={suppressedAnalysis ? suppressedTypesFor(suppressedAnalysis, keyStr) : undefined}
                      onSuppressAnalysisBadge={(type) => onSuppressAnalysis?.(keyStr, type)}
                      isFlashing={flashLaneKeys?.has(keyStr) ?? false}
                      onRequestOscEditor={(targetId, anchorRect) => {
                        setOscEditor({ targetType: "lane", targetId, anchorRect });
                      }}
                      mapping={oscMappings.find((m) => m.targetType === "lane" && m.targetId === laneKeyString(entry.key) && (focusedSectionId ? m.sectionId === focusedSectionId : !m.sectionId)) ?? null}
                      onOpenMapping={(e) => {
                        const existing = oscMappings.find((m) => m.targetType === "lane" && m.targetId === laneKeyString(entry.key) && (focusedSectionId ? m.sectionId === focusedSectionId : !m.sectionId));
                        setOscEditor({ targetType: "lane", targetId: laneKeyString(entry.key), anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(), editingMapping: existing });
                        onOpenLaneMapping?.(entry.key);
                      }}
                    />
                    <div className="absolute top-0.5 flex items-center" style={{ left: leftGutterPx - 24, width: 20 }}>
                      <LaneControlsPopover
                        actions={[
                          { label: "Hide lane", onClick: () => onHideLane(keyStr) },
                          ...(onSuppressAnalysis ? [
                            { label: "Suppress: rhythm", onClick: () => onSuppressAnalysis(keyStr, "rhythm") },
                            { label: "Suppress: dynamic", onClick: () => onSuppressAnalysis(keyStr, "dynamic") },
                            { label: "Suppress: melody", onClick: () => onSuppressAnalysis(keyStr, "melody") },
                          ] : []),
                        ]}
                      />
                    </div>
                  </div>
                );
              case "aftertouch": {
                const labelSuffix = entry.key.note !== undefined ? ` #${entry.key.note}` : "";
                return (
                  <div data-lane-key={keyStr} key={`at|${entry.key.channel}|${entry.key.note ?? "ch"}`} className="relative group">
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
                      onDeleteBadge={onDeleteBadge}
                      suppressedAnalysisTypes={suppressedAnalysis ? suppressedTypesFor(suppressedAnalysis, keyStr) : undefined}
                      onSuppressAnalysisBadge={(type) => onSuppressAnalysis?.(keyStr, type)}
                      isFlashing={flashLaneKeys?.has(keyStr) ?? false}
                      onRequestOscEditor={(targetId, anchorRect) => {
                        setOscEditor({ targetType: "lane", targetId, anchorRect });
                      }}
                      mapping={oscMappings.find((m) => m.targetType === "lane" && m.targetId === laneKeyString(entry.key) && (focusedSectionId ? m.sectionId === focusedSectionId : !m.sectionId)) ?? null}
                      onOpenMapping={(e) => {
                        const existing = oscMappings.find((m) => m.targetType === "lane" && m.targetId === laneKeyString(entry.key) && (focusedSectionId ? m.sectionId === focusedSectionId : !m.sectionId));
                        setOscEditor({ targetType: "lane", targetId: laneKeyString(entry.key), anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(), editingMapping: existing });
                        onOpenLaneMapping?.(entry.key);
                      }}
                    />
                    <div className="absolute top-0.5 flex items-center" style={{ left: leftGutterPx - 24, width: 20 }}>
                      <LaneControlsPopover
                        actions={[
                          { label: "Hide lane", onClick: () => onHideLane(keyStr) },
                          ...(onSuppressAnalysis ? [
                            { label: "Suppress: rhythm", onClick: () => onSuppressAnalysis(keyStr, "rhythm") },
                            { label: "Suppress: dynamic", onClick: () => onSuppressAnalysis(keyStr, "dynamic") },
                            { label: "Suppress: melody", onClick: () => onSuppressAnalysis(keyStr, "melody") },
                          ] : []),
                        ]}
                      />
                    </div>
                  </div>
                );
              }
              case "program":
                return (
                  <div data-lane-key={keyStr} key={`prog|${entry.key.channel}`} className="relative group">
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
                      onDeleteBadge={onDeleteBadge}
                      suppressedAnalysisTypes={suppressedAnalysis ? suppressedTypesFor(suppressedAnalysis, keyStr) : undefined}
                      onSuppressAnalysisBadge={(type) => onSuppressAnalysis?.(keyStr, type)}
                      isFlashing={flashLaneKeys?.has(keyStr) ?? false}
                      onRequestOscEditor={(targetId, anchorRect) => {
                        setOscEditor({ targetType: "lane", targetId, anchorRect });
                      }}
                      hasOscMapping={oscMappings.some((m) => m.targetType === "lane" && m.targetId === keyStr && m.deviceId === device)}
                    />
                    <div className="absolute top-0.5 flex items-center" style={{ left: leftGutterPx - 24, width: 20 }}>
                      <LaneControlsPopover
                        actions={[
                          { label: "Hide lane", onClick: () => onHideLane(keyStr) },
                          ...(onSuppressAnalysis ? [
                            { label: "Suppress: rhythm", onClick: () => onSuppressAnalysis(keyStr, "rhythm") },
                            { label: "Suppress: dynamic", onClick: () => onSuppressAnalysis(keyStr, "dynamic") },
                            { label: "Suppress: melody", onClick: () => onSuppressAnalysis(keyStr, "melody") },
                          ] : []),
                        ]}
                      />
                    </div>
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

function suppressedTypesFor(suppressed: Set<string>, laneKey: string): Set<"rhythm" | "dynamic" | "melody"> | undefined {
  const result = new Set<"rhythm" | "dynamic" | "melody">();
  for (const type of ["rhythm", "dynamic", "melody"] as const) {
    if (suppressed.has(`${laneKey}:${type}`)) result.add(type);
  }
  return result.size > 0 ? result : undefined;
}

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
    <div className="relative flex border-t border-white/10" style={{ height: SUMMARY_HEIGHT }}>
      <div
        className="text-[10px] text-gray-700 px-3 flex items-center border-r border-white/10"
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
