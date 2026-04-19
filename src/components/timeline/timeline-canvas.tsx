"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { LaneAnalysis, LaneBadge, LaneMap, MidiMappingRule, Moment, NoteGroupTag, NoteSpan, OscMapping, RecordedEvent, Recording, RedundancyPair, SavedEndpoint, TimelineSection } from "@/lib/types";
import { laneKeyString } from "@/lib/types";
import { midiNoteName } from "@/lib/timeline-util";
import { TimeRuler } from "./time-ruler";
import { AudioLane } from "./audio-lane";
import { DeviceSection } from "./device-section";
import { HoverCard } from "./hover-card";
import { TriggersSidebar } from "./triggers-sidebar";
import { SectionBar } from "./section-bar";
import { MarkerLane, MARKER_DEFAULT_COLOR } from "./marker-lane";

const LEFT_GUTTER = 140;
const MIN_LANE_HEIGHT = 16;
const AUDIO_LANE_KEY = "audio";

interface Viewport { startMs: number; endMs: number; }
type ViewAction =
  | { type: "set"; startMs: number; endMs: number; minMs?: number }
  | { type: "scrollBy"; deltaMs: number; maxMs?: number; minMs?: number }
  | { type: "zoom"; anchorMs: number; factor: number; maxMs?: number; minMs?: number }
  | { type: "fit"; durationMs: number };

function clampStart(startMs: number, endMs: number, minMs = 0): Viewport {
  if (startMs >= minMs) return { startMs, endMs };
  return { startMs: minMs, endMs: endMs + (minMs - startMs) };
}

function viewReducer(v: Viewport, a: ViewAction): Viewport {
  const minMs = (a as { minMs?: number }).minMs ?? 0;
  switch (a.type) {
    case "set": return clampStart(a.startMs, a.endMs, minMs);
    case "scrollBy": {
      const next = clampStart(v.startMs + a.deltaMs, v.endMs + a.deltaMs, minMs);
      if (a.maxMs !== undefined && next.endMs > a.maxMs) {
        const span = next.endMs - next.startMs;
        return { startMs: Math.max(minMs, a.maxMs - span), endMs: a.maxMs };
      }
      return next;
    }
    case "zoom": {
      const span = (v.endMs - v.startMs) * a.factor;
      const minSpan = 50;
      const maxSpan = 60 * 60 * 1000;
      const clampedSpan = Math.max(minSpan, Math.min(maxSpan, span));
      const leftFrac = (a.anchorMs - v.startMs) / (v.endMs - v.startMs);
      const next = clampStart(
        a.anchorMs - leftFrac * clampedSpan,
        a.anchorMs + (1 - leftFrac) * clampedSpan,
        minMs,
      );
      if (a.maxMs !== undefined && next.endMs > a.maxMs) {
        const sp = next.endMs - next.startMs;
        return { startMs: Math.max(minMs, a.maxMs - sp), endMs: a.maxMs };
      }
      return next;
    }
    case "fit":
      return { startMs: 0, endMs: Math.max(1000, a.durationMs) };
  }
}

export interface AudioTrackRenderProps {
  id: string;
  peaks: Array<{ min: number; max: number }> | null;
  offsetMs: number;
  durationMs: number;
  label: string;
}

interface TimelineCanvasProps {
  recording: Recording | null;
  events: RecordedEvent[];
  bufferVersion: number;
  isRecording: boolean;
  laneMap: LaneMap;
  noteSpans: NoteSpan[];
  mappingRules: MidiMappingRule[];
  playheadMsRef: React.MutableRefObject<number>;
  onSeek: (ms: number) => void;
  audioTracks: AudioTrackRenderProps[];
  onLoadAudio: () => void;
  onUnloadAudio: (id: string) => void;
  onAudioOffsetChange: (id: string, ms: number) => void;
  onAudioOffsetDelta: (id: string, deltaPx: number, modifier: "none" | "shift" | "alt") => void;
  analyses: LaneAnalysis[] | null;
  redundantPairs: RedundancyPair[] | null;
  moments: Moment[] | null;
  analysisReady: boolean;
  analysisError: string | null;
  badges: LaneBadge[];
  triggersSidebarOpen: boolean;
  onToggleTriggersSidebar: () => void;
  onRequestAddBadge: (laneKey: string) => void;
  onEditBadge: (badge: LaneBadge) => void;
  onDeleteBadge: (id: string) => void;
  suppressedAnalysis: string[];
  onSuppressAnalysis: (laneKey: string, type: "rhythm" | "dynamic" | "melody") => void;
  onTagCurrentLane: () => void;
  onDeleteDevice: (deviceName: string) => void;
  sections: TimelineSection[];
  onSectionsChange: (sections: TimelineSection[]) => void;
  userMarkers: Moment[];
  onMarkersChange: (markers: Moment[]) => void;
  noteTags: NoteGroupTag[];
  onSaveNoteTag: (tag: NoteGroupTag) => void;
  onDeleteNoteTag: (id: string) => void;
  oscMappings: OscMapping[];
  endpoints: SavedEndpoint[];
  onAddOscMapping: (mapping: OscMapping) => void;
  onDeleteOscMapping: (id: string) => void;
  onHiddenLanesChange: (lanes: string[]) => void;
  onHiddenNoteGroupsChange: (groups: string[]) => void;
}

export function TimelineCanvas(props: TimelineCanvasProps) {
  const {
    recording, events, bufferVersion, isRecording, laneMap, noteSpans, mappingRules,
    playheadMsRef, onSeek, audioTracks, onLoadAudio, onUnloadAudio, onAudioOffsetChange, onAudioOffsetDelta,
    analyses, redundantPairs, moments, analysisReady, analysisError, badges,
    triggersSidebarOpen, onToggleTriggersSidebar, onRequestAddBadge, onEditBadge, onDeleteBadge,
    suppressedAnalysis, onSuppressAnalysis, onTagCurrentLane,
    onDeleteDevice, sections, onSectionsChange, userMarkers, onMarkersChange,
    noteTags, onSaveNoteTag, onDeleteNoteTag,
    oscMappings, endpoints, onAddOscMapping, onDeleteOscMapping,
    onHiddenLanesChange, onHiddenNoteGroupsChange,
  } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [laneHeights, setLaneHeights] = useState<Map<string, number>>(new Map());

  const getLaneHeight = useCallback(
    (key: string, defaultPx: number) => laneHeights.get(key) ?? defaultPx,
    [laneHeights]
  );

  const setLaneHeight = useCallback((key: string, newHeight: number) => {
    setLaneHeights((prev) => {
      const next = new Map(prev);
      next.set(key, Math.max(MIN_LANE_HEIGHT, newHeight));
      return next;
    });
  }, []);

  const [flashLaneKeys, setFlashLaneKeys] = useState<Set<string>>(new Set());
  const flashTimerRef = useRef<number | null>(null);

  const analysisByKey = useMemo(() => {
    const m = new Map<string, LaneAnalysis>();
    for (const a of analyses ?? []) m.set(a.laneKey, a);
    return m;
  }, [analyses]);

  const badgesByKey = useMemo(() => {
    const m = new Map<string, LaneBadge[]>();
    for (const b of badges ?? []) {
      const list = m.get(b.laneKey) ?? [];
      list.push(b);
      m.set(b.laneKey, list);
    }
    return m;
  }, [badges]);

  const flashLane = useCallback((laneKey: string) => {
    setFlashLaneKeys((prev) => {
      const next = new Set(prev);
      next.add(laneKey);
      return next;
    });
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashLaneKeys(new Set()), 900);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  const scrollLaneIntoView = useCallback((laneKey: string) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const target = wrap.querySelector(`[data-lane-key="${CSS.escape(laneKey)}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const laneLabelFor = useCallback((laneKey: string): string => {
    for (const entry of laneMap.values()) {
      if (laneKeyString(entry.key) !== laneKey) continue;
      const k = entry.key;
      switch (k.kind) {
        case "notes":       return `${k.device} · Notes`;
        case "cc":          return `${k.device} · CC ${k.cc} ch${k.channel}`;
        case "pitch":       return `${k.device} · Pitch ch${k.channel}`;
        case "aftertouch":  return `${k.device} · AT ch${k.channel}${k.note !== undefined ? ` #${k.note}` : ""}`;
        case "program":     return `${k.device} · Program ch${k.channel}`;
      }
    }
    return laneKey;
  }, [laneMap]);

  const [hover, setHover] = useState<{ payload: Parameters<typeof HoverCard>[0]["payload"]; x: number; y: number }>({
    payload: null, x: 0, y: 0,
  });

  const latestTRel = events.length > 0 ? events[events.length - 1].tRel : 0;
  const duration = Math.max(
    1000,
    recording?.durationMs ?? (isRecording ? latestTRel + 500 : 1000)
  );

  // Hard right edge: the furthest end of any audio track or the MIDI recording.
  const maxMs = useMemo(() => {
    const audioEnd = audioTracks.reduce((m, t) => Math.max(m, t.offsetMs + t.durationMs), 0);
    return Math.max(duration, audioEnd);
  }, [duration, audioTracks]);

  const [view, dispatch] = useReducer(viewReducer, { startMs: 0, endMs: duration });

  const tailFollowRef = useRef(true);
  useEffect(() => {
    if (!isRecording) return;
    if (!tailFollowRef.current) return;
    const latest = events.length > 0 ? events[events.length - 1].tRel : 0;
    const span = view.endMs - view.startMs;
    if (latest + 500 > view.endMs) {
      dispatch({ type: "set", startMs: latest + 500 - span, endMs: latest + 500 });
    }
  }, [bufferVersion, isRecording, events, view.endMs, view.startMs]);

  const priorIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (recording && recording.id !== priorIdRef.current) {
      priorIdRef.current = recording.id;
      dispatch({ type: "fit", durationMs: recording.durationMs });
      tailFollowRef.current = true;
    }
  }, [recording]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = playheadElRef.current;
      const wrap = wrapRef.current;
      if (el && wrap) {
        const rect = wrap.getBoundingClientRect();
        const trackWidth = rect.width - LEFT_GUTTER;
        const span = view.endMs - view.startMs;
        const pct = (playheadMsRef.current - view.startMs) / span;
        el.style.left = `${LEFT_GUTTER + pct * trackWidth}px`;
        el.style.display = pct < 0 || pct > 1 ? "none" : "block";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view.startMs, view.endMs, playheadMsRef]);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left - LEFT_GUTTER;
      const trackWidth = rect.width - LEFT_GUTTER;
      if (trackWidth <= 0) return;
      const anchorMs = view.startMs + (x / trackWidth) * (view.endMs - view.startMs);
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      dispatch({ type: "zoom", anchorMs, factor, maxMs, minMs: originOffsetMs });
      tailFollowRef.current = false;
    } else {
      const span = view.endMs - view.startMs;
      const delta = (e.deltaX || e.deltaY) / 500 * span;
      dispatch({ type: "scrollBy", deltaMs: delta, maxMs, minMs: originOffsetMs });
      tailFollowRef.current = false;
    }
  };

  const toggleCollapsed = (device: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(device)) next.delete(device); else next.add(device);
      return next;
    });
  };

  const devices = recording?.devices ?? [];

  const suppressedAnalysisSet = useMemo(
    () => new Set(suppressedAnalysis),
    [suppressedAnalysis]
  );

  const [noteSelection, setNoteSelection] = useState<{ device: string; pitch: number; velocity: number } | null>(null);
  const [hiddenNoteGroups, setHiddenNoteGroups] = useState<Set<string>>(
    () => new Set(recording?.hiddenNoteGroups ?? [])
  );
  const [hiddenLanes, setHiddenLanes] = useState<Set<string>>(
    () => new Set(recording?.hiddenLanes ?? [])
  );

  // Reset hidden state when a different recording is loaded.
  const recordingId = recording?.id;
  const prevRecordingIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (recordingId === prevRecordingIdRef.current) return;
    prevRecordingIdRef.current = recordingId;
    setHiddenNoteGroups(new Set(recording?.hiddenNoteGroups ?? []));
    setHiddenLanes(new Set(recording?.hiddenLanes ?? []));
    setNoteSelection(null);
  }, [recordingId, recording]);

  // Persist hidden state changes to recording (skip if already in sync).
  const recordingHiddenLanesRef = useRef(recording?.hiddenLanes);
  const recordingHiddenGroupsRef = useRef(recording?.hiddenNoteGroups);
  useEffect(() => { recordingHiddenLanesRef.current = recording?.hiddenLanes; }, [recording]);
  useEffect(() => { recordingHiddenGroupsRef.current = recording?.hiddenNoteGroups; }, [recording]);

  useEffect(() => {
    const arr = [...hiddenLanes];
    const current = recordingHiddenLanesRef.current;
    if (current && current.length === arr.length && arr.every((k) => current.includes(k))) return;
    onHiddenLanesChange(arr);
  }, [hiddenLanes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const arr = [...hiddenNoteGroups];
    const current = recordingHiddenGroupsRef.current;
    if (current && current.length === arr.length && arr.every((k) => current.includes(k))) return;
    onHiddenNoteGroupsChange(arr);
  }, [hiddenNoteGroups]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [originOffsetMs, setOriginOffsetMs] = useState(0);

  const activeSection = useMemo(
    () => (activeSectionId ? sections.find((s) => s.id === activeSectionId) ?? null : null),
    [activeSectionId, sections]
  );

  const selectedCount = useMemo(() => {
    if (!noteSelection) return 0;
    return noteSpans.filter((s) => {
      if (s.device !== noteSelection.device || s.pitch !== noteSelection.pitch || s.velocity !== noteSelection.velocity) return false;
      if (activeSection && (s.tStart >= activeSection.endMs || s.tEnd <= activeSection.startMs)) return false;
      return true;
    }).length;
  }, [noteSpans, noteSelection, activeSection]);

  // Per-device: set of "pitch|velocity" keys that are hidden (for NotesLane filtering).
  const hiddenKeysByDevice = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const fullKey of hiddenNoteGroups) {
      const firstPipe = fullKey.indexOf("|");
      const device = fullKey.slice(0, firstPipe);
      const pvKey = fullKey.slice(firstPipe + 1);
      const set = map.get(device) ?? new Set<string>();
      set.add(pvKey);
      map.set(device, set);
    }
    return map;
  }, [hiddenNoteGroups]);

  // Per-device: ALL unique (pitch, velocity) groups with counts, sorted by pitch then velocity.
  const allGroupsByDevice = useMemo(() => {
    const interim = new Map<string, Map<string, { pitch: number; velocity: number; count: number }>>();
    for (const s of noteSpans) {
      let deviceMap = interim.get(s.device);
      if (!deviceMap) { deviceMap = new Map(); interim.set(s.device, deviceMap); }
      const key = `${s.pitch}|${s.velocity}`;
      const g = deviceMap.get(key);
      if (g) g.count++;
      else deviceMap.set(key, { pitch: s.pitch, velocity: s.velocity, count: 1 });
    }
    const result = new Map<string, Array<{ pitch: number; velocity: number; count: number }>>();
    for (const [device, groupMap] of interim) {
      result.set(device, Array.from(groupMap.values()).sort((a, b) => a.pitch - b.pitch || a.velocity - b.velocity));
    }
    return result;
  }, [noteSpans]);

  // When a section is active, filter groups to only those with notes in that section.
  const displayGroupsByDevice = useMemo(() => {
    if (!activeSection) return allGroupsByDevice;
    const { startMs, endMs } = activeSection;
    const interim = new Map<string, Map<string, { pitch: number; velocity: number; count: number }>>();
    for (const s of noteSpans) {
      if (s.tStart >= endMs || s.tEnd <= startMs) continue;
      let deviceMap = interim.get(s.device);
      if (!deviceMap) { deviceMap = new Map(); interim.set(s.device, deviceMap); }
      const key = `${s.pitch}|${s.velocity}`;
      const g = deviceMap.get(key);
      if (g) g.count++;
      else deviceMap.set(key, { pitch: s.pitch, velocity: s.velocity, count: 1 });
    }
    const result = new Map<string, Array<{ pitch: number; velocity: number; count: number }>>();
    for (const [device, groupMap] of interim) {
      result.set(device, Array.from(groupMap.values()).sort((a, b) => a.pitch - b.pitch || a.velocity - b.velocity));
    }
    return result;
  }, [activeSection, allGroupsByDevice, noteSpans]);

  const handleNoteClick = useCallback((device: string, span: NoteSpan) => {
    setNoteSelection((prev) =>
      prev?.device === device && prev.pitch === span.pitch && prev.velocity === span.velocity
        ? null
        : { device, pitch: span.pitch, velocity: span.velocity }
    );
  }, []);

  const hideNoteGroup = useCallback((device: string, pitch: number, velocity: number) => {
    setHiddenNoteGroups((prev) => new Set([...prev, `${device}|${pitch}|${velocity}`]));
    setNoteSelection(null);
  }, []);

  const toggleHiddenNoteGroup = useCallback((device: string, pitch: number, velocity: number) => {
    const key = `${device}|${pitch}|${velocity}`;
    setHiddenNoteGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const jumpLive = () => {
    tailFollowRef.current = true;
    const latest = events.length > 0 ? events[events.length - 1].tRel : 0;
    const span = view.endMs - view.startMs;
    dispatch({ type: "set", startMs: latest + 500 - span, endMs: latest + 500 });
  };

  return (
    <div className="flex-1 min-h-0 flex">
      <div
        ref={wrapRef}
        onWheel={handleWheel}
        className="relative flex-1 min-h-0 bg-surface rounded-lg border border-white/5 overflow-y-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
      {/* Sticky header — time ruler, sections, and markers stay pinned while lanes scroll */}
      <div className="sticky top-0 z-20" style={{ background: "#0f0f1e", boxShadow: "0 4px 16px rgba(0,0,0,0.8)" }}>
        <TimeRuler
          viewStartMs={view.startMs}
          viewEndMs={view.endMs}
          leftGutterPx={LEFT_GUTTER}
          onSeek={(ms) => { tailFollowRef.current = false; onSeek(ms); }}
          originOffsetMs={originOffsetMs}
          onOriginChange={(ms) => {
            const clamped = Math.max(0, ms);
            setOriginOffsetMs(clamped);
            const span = view.endMs - view.startMs;
            dispatch({ type: "set", startMs: clamped, endMs: clamped + span, minMs: clamped });
          }}
        />

        <SectionBar
          sections={sections}
          activeSectionId={activeSectionId}
          viewStartMs={view.startMs}
          viewEndMs={view.endMs}
          leftGutterPx={LEFT_GUTTER}
          onActivate={setActiveSectionId}
          onChange={onSectionsChange}
        />

        {/* Auto-detected moments (drops/builds/peaks/silences) are computed in useTriggerAnalysis
            but not shown here — the detection needs more work before it's useful. */}
        <MarkerLane
          markers={userMarkers}
          viewStartMs={view.startMs}
          viewEndMs={view.endMs}
          leftGutterPx={LEFT_GUTTER}
          onAdd={(tMs) => {
            const marker: Moment = {
              id: crypto.randomUUID(),
              tMs,
              kind: "user",
              label: "Marker",
            };
            onMarkersChange([...userMarkers, marker]);
          }}
          onRename={(id, label) => {
            onMarkersChange(userMarkers.map((m) => (m.id === id ? { ...m, label } : m)));
          }}
          onDelete={(id) => {
            onMarkersChange(userMarkers.filter((m) => m.id !== id));
          }}
          onClearSystem={() => {
            onMarkersChange(userMarkers.filter((m) => m.kind === "user"));
          }}
          onColorChange={(id, color) => {
            onMarkersChange(userMarkers.map((m) => (m.id === id ? { ...m, color } : m)));
          }}
          onSeek={(ms) => { tailFollowRef.current = false; onSeek(ms); }}
        />
      </div>

      {audioTracks.map((track) => (
        <AudioLane
          key={track.id}
          peaks={track.peaks}
          heightPx={getLaneHeight(`audio:${track.id}`, 38)}
          label={track.label}
          leftGutterPx={LEFT_GUTTER}
          onOffsetDragDelta={(deltaPx, mod) => onAudioOffsetDelta(track.id, deltaPx, mod)}
          onResize={(h) => setLaneHeight(`audio:${track.id}`, h)}
          viewStartMs={view.startMs}
          viewEndMs={view.endMs}
          audioOffsetMs={track.offsetMs}
          audioDurationMs={track.durationMs}
          audioLoaded
          onUnloadAudio={() => onUnloadAudio(track.id)}
          onOffsetChange={(ms) => onAudioOffsetChange(track.id, ms)}
        />
      ))}
      {/* Load audio — empty lane when no tracks, or add-more button */}
      {audioTracks.length === 0 ? (
        <AudioLane
          peaks={null}
          heightPx={getLaneHeight(AUDIO_LANE_KEY, 38)}
          label={undefined}
          leftGutterPx={LEFT_GUTTER}
          viewStartMs={view.startMs}
          viewEndMs={view.endMs}
          audioOffsetMs={0}
          audioDurationMs={0}
          audioLoaded={false}
          onLoadAudio={onLoadAudio}
          onResize={(h) => setLaneHeight(AUDIO_LANE_KEY, h)}
        />
      ) : (
        <div className="flex border-b border-white/5" style={{ height: 22 }}>
          <button
            onClick={onLoadAudio}
            className="px-3 text-[10px] text-gray-600 hover:text-gray-300 transition-colors text-left"
            style={{ width: LEFT_GUTTER, flexShrink: 0 }}
          >
            + Add audio
          </button>
          <div className="flex-1 border-l border-white/5" />
        </div>
      )}

      {devices.length === 0 && !isRecording && (
        <div className="p-6 text-xs text-gray-600 italic">
          {recording ? "No events in this recording." : "No recording loaded. Hit Record, or load an .oscrec file."}
        </div>
      )}

      {devices.map((device) => (
        <DeviceSection
          key={device}
          device={device}
          laneMap={laneMap}
          events={events}
          noteSpans={noteSpans}
          mappingRules={mappingRules}
          viewStartMs={view.startMs}
          viewEndMs={view.endMs}
          leftGutterPx={LEFT_GUTTER}
          collapsed={collapsed.has(device)}
          onToggleCollapsed={() => toggleCollapsed(device)}
          bufferVersion={bufferVersion}
          onHoverEvent={(evt, x, y) => setHover({ payload: evt ? { kind: "event", event: evt } : null, x, y })}
          onHoverSpan={(span, x, y) => setHover({ payload: span ? { kind: "span", span } : null, x, y })}
          getLaneHeight={getLaneHeight}
          onLaneResize={setLaneHeight}
          getAnalysisFor={(k) => analysisByKey.get(k)}
          getBadgesFor={(k) => badgesByKey.get(k)}
          onRequestAddBadge={onRequestAddBadge}
          onEditBadge={onEditBadge}
          onDeleteBadge={onDeleteBadge}
          suppressedAnalysis={suppressedAnalysisSet}
          onSuppressAnalysis={onSuppressAnalysis}
          flashLaneKeys={flashLaneKeys}
          onDeleteDevice={onDeleteDevice}
          selectedVelocity={noteSelection?.device === device ? { pitch: noteSelection.pitch, velocity: noteSelection.velocity } : null}
          activeSectionRange={activeSection ? { startMs: activeSection.startMs, endMs: activeSection.endMs } : null}
          onNoteClick={(span) => handleNoteClick(device, span)}
          allGroups={displayGroupsByDevice.get(device) ?? []}
          hiddenNoteKeys={hiddenKeysByDevice.get(device) ?? new Set()}
          onToggleNoteGroup={(pitch, velocity) => toggleHiddenNoteGroup(device, pitch, velocity)}
          onSelectGroup={(pitch, velocity) => setNoteSelection((prev) =>
            prev?.device === device && prev.pitch === pitch && prev.velocity === velocity
              ? null
              : { device, pitch, velocity }
          )}
          noteTags={noteTags}
          onSaveNoteTag={onSaveNoteTag}
          onDeleteNoteTag={onDeleteNoteTag}
          oscMappings={oscMappings}
          endpoints={endpoints}
          onAddOscMapping={onAddOscMapping}
          onDeleteOscMapping={onDeleteOscMapping}
          hiddenLanes={hiddenLanes}
          onHideLane={(key) => setHiddenLanes((prev) => new Set([...prev, key]))}
          onShowLane={(key) => setHiddenLanes((prev) => { const n = new Set(prev); n.delete(key); return n; })}
        />
      ))}

      {/* Full-height marker lines — rendered as overlay so they span all lanes */}
      {userMarkers.map((m) => {
        const viewSpan = Math.max(1, view.endMs - view.startMs);
        const leftFrac = (m.tMs - view.startMs) / viewSpan;
        if (leftFrac < -0.02 || leftFrac > 1.02) return null;
        return (
          <div
            key={m.id}
            className="pointer-events-none absolute top-0 w-px"
            style={{
              left: `calc(${LEFT_GUTTER}px + ${leftFrac} * (100% - ${LEFT_GUTTER}px))`,
              height: "10000px",
              background: m.color ?? MARKER_DEFAULT_COLOR,
              opacity: 0.35,
              zIndex: 5,
            }}
          />
        );
      })}

      <div
        ref={playheadElRef}
        className="pointer-events-none absolute top-0 w-px bg-orange-400/80"
        style={{ left: LEFT_GUTTER, height: "10000px", zIndex: 10 }}
      >
        <div
          className="absolute -top-0.5 -left-1 w-2 h-1.5 bg-orange-400"
          style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
        />
      </div>

      {!tailFollowRef.current && isRecording && (
        <button
          onClick={jumpLive}
          className="absolute top-2 right-3 z-20 text-[10px] px-2 py-1 bg-accent/20 text-accent border border-accent/30 rounded"
        >
          Jump to live ↴
        </button>
      )}

      {noteSelection && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 border border-white/15 rounded-lg px-3 py-2" style={{ background: "#0f0f1e", boxShadow: "0 8px 24px rgba(0,0,0,0.85)" }}>
          <span className="text-xs text-gray-300">
            <span className="text-white font-semibold">{selectedCount}</span> × {midiNoteName(noteSelection.pitch)} · vel {noteSelection.velocity}
            {activeSection && <span className="ml-1 text-gray-500">in {activeSection.name}</span>}
          </span>
          <button
            onClick={() => hideNoteGroup(noteSelection.device, noteSelection.pitch, noteSelection.velocity)}
            className="px-2 py-1 text-xs bg-surface-lighter border border-white/10 text-gray-300 rounded hover:text-white transition-colors"
          >
            Hide
          </button>
          <button
            onClick={() => setNoteSelection(null)}
            className="text-gray-600 hover:text-white text-xs transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      <HoverCard payload={hover.payload} clientX={hover.x} clientY={hover.y} />
      </div>
      {triggersSidebarOpen && (
        <TriggersSidebar
          analyses={analyses}
          pairs={redundantPairs}
          moments={moments}
          ready={analysisReady}
          error={analysisError}
          userBadges={badges}
          laneLabelFor={laneLabelFor}
          onSelectLane={(k) => { flashLane(k); scrollLaneIntoView(k); }}
          onSelectPair={(a, b) => { flashLane(a); flashLane(b); scrollLaneIntoView(a); }}
          onSelectMoment={(m) => {
            tailFollowRef.current = false;
            onSeek(m.tMs);
            const currentSpan = view.endMs - view.startMs;
            const targetSpan = Math.min(currentSpan, Math.max(8000, (m.durationMs ?? 0) * 2));
            dispatch({ type: "set", startMs: m.tMs - targetSpan / 2, endMs: m.tMs + targetSpan / 2 });
          }}
          onTagCurrentLane={onTagCurrentLane}
        />
      )}
    </div>
  );
}

