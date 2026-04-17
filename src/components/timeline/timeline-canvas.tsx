"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { LaneMap, MidiMappingRule, NoteSpan, RecordedEvent, Recording } from "@/lib/types";
import { TimeRuler } from "./time-ruler";
import { AudioLane } from "./audio-lane";
import { DeviceSection } from "./device-section";
import { HoverCard } from "./hover-card";

const LEFT_GUTTER = 140;

interface Viewport { startMs: number; endMs: number; }
type ViewAction =
  | { type: "set"; startMs: number; endMs: number }
  | { type: "scrollBy"; deltaMs: number }
  | { type: "zoom"; anchorMs: number; factor: number }
  | { type: "fit"; durationMs: number };

function viewReducer(v: Viewport, a: ViewAction): Viewport {
  switch (a.type) {
    case "set": return { startMs: a.startMs, endMs: a.endMs };
    case "scrollBy": {
      const d = a.deltaMs;
      return { startMs: v.startMs + d, endMs: v.endMs + d };
    }
    case "zoom": {
      const span = (v.endMs - v.startMs) * a.factor;
      const minSpan = 50;
      const maxSpan = 60 * 60 * 1000;
      const clampedSpan = Math.max(minSpan, Math.min(maxSpan, span));
      const leftFrac = (a.anchorMs - v.startMs) / (v.endMs - v.startMs);
      return {
        startMs: a.anchorMs - leftFrac * clampedSpan,
        endMs: a.anchorMs + (1 - leftFrac) * clampedSpan,
      };
    }
    case "fit":
      return { startMs: 0, endMs: Math.max(1000, a.durationMs) };
  }
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
  audioPeaks: Array<{ min: number; max: number }> | null;
  audioLabel?: string;
  onAudioOffsetDelta?: (deltaPx: number, modifier: "none" | "shift" | "alt") => void;
}

export function TimelineCanvas(props: TimelineCanvasProps) {
  const {
    recording, events, bufferVersion, isRecording, laneMap, noteSpans, mappingRules,
    playheadMsRef, onSeek, audioPeaks, audioLabel, onAudioOffsetDelta,
  } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [hover, setHover] = useState<{ payload: Parameters<typeof HoverCard>[0]["payload"]; x: number; y: number }>({
    payload: null, x: 0, y: 0,
  });

  const latestTRel = events.length > 0 ? events[events.length - 1].tRel : 0;
  const duration = Math.max(
    1000,
    recording?.durationMs ?? (isRecording ? latestTRel + 500 : 1000)
  );

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
      dispatch({ type: "zoom", anchorMs, factor });
      tailFollowRef.current = false;
    } else {
      const span = view.endMs - view.startMs;
      const delta = (e.deltaX || e.deltaY) / 500 * span;
      dispatch({ type: "scrollBy", deltaMs: delta });
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

  const jumpLive = () => {
    tailFollowRef.current = true;
    const latest = events.length > 0 ? events[events.length - 1].tRel : 0;
    const span = view.endMs - view.startMs;
    dispatch({ type: "set", startMs: latest + 500 - span, endMs: latest + 500 });
  };

  return (
    <div
      ref={wrapRef}
      onWheel={handleWheel}
      className="relative flex-1 min-h-0 bg-surface rounded-lg border border-white/5 overflow-y-auto"
    >
      <TimeRuler
        viewStartMs={view.startMs}
        viewEndMs={view.endMs}
        leftGutterPx={LEFT_GUTTER}
        onSeek={(ms) => { tailFollowRef.current = false; onSeek(ms); }}
      />

      <AudioLane
        peaks={audioPeaks}
        heightPx={38}
        label={audioLabel}
        leftGutterPx={LEFT_GUTTER}
        onOffsetDragDelta={onAudioOffsetDelta}
      />

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
        />
      ))}

      <div
        ref={playheadElRef}
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-orange-400/80"
        style={{ left: LEFT_GUTTER, zIndex: 10 }}
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

      <HoverCard payload={hover.payload} clientX={hover.x} clientY={hover.y} />
    </div>
  );
}
