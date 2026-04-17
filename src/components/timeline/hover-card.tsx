"use client";

import type { NoteSpan, RecordedEvent } from "@/lib/types";
import { formatTime } from "@/lib/timeline-util";

interface HoverCardProps {
  payload:
    | { kind: "event"; event: RecordedEvent }
    | { kind: "span"; span: NoteSpan }
    | null;
  clientX: number;
  clientY: number;
}

export function HoverCard({ payload, clientX, clientY }: HoverCardProps) {
  if (!payload) return null;
  const left = Math.min(clientX + 12, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240);
  const top = clientY + 12;

  return (
    <div
      className="fixed z-50 text-[10px] font-mono bg-surface-lighter border border-accent/30 rounded px-2 py-1.5 shadow-lg pointer-events-none"
      style={{ left, top, minWidth: 200 }}
    >
      {payload.kind === "event" && <EventBody evt={payload.event} />}
      {payload.kind === "span" && <SpanBody span={payload.span} />}
    </div>
  );
}

function EventBody({ evt }: { evt: RecordedEvent }) {
  const { midi, osc, tRel } = evt;
  const oscArgs = osc.args.map((a) => (typeof a.value === "number" ? a.value.toFixed(3) : String(a.value))).join(" ");
  return (
    <>
      <Row label="time"   value={formatTime(tRel)} />
      <Row label="device" value={midi.deviceName} />
      <Row label="midi"   value={formatMidiLine(evt)} />
      <Row label="osc"    value={`${osc.address} ${oscArgs}`} color="#ffaed7" />
    </>
  );
}

function SpanBody({ span }: { span: NoteSpan }) {
  return (
    <>
      <Row label="time"   value={`${formatTime(span.tStart)} – ${formatTime(span.tEnd)}`} />
      <Row label="device" value={span.device} />
      <Row label="note"   value={`ch${span.channel} #${span.pitch} vel=${span.velocity}`} />
    </>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex">
      <span className="text-gray-600 w-14 shrink-0">{label}</span>
      <span className="truncate" style={{ color: color ?? "#c7f168" }}>{value}</span>
    </div>
  );
}

function formatMidiLine(evt: RecordedEvent): string {
  const m = evt.midi;
  switch (m.type) {
    case "noteon":     return `NoteOn ch${m.channel} #${m.data1} vel=${m.data2}`;
    case "noteoff":    return `NoteOff ch${m.channel} #${m.data1} vel=${m.data2}`;
    case "cc":         return `CC ch${m.channel} #${m.data1} → ${m.data2}`;
    case "pitch":      return `Pitch ch${m.channel} → ${(m.data2 << 7) | m.data1}`;
    case "aftertouch": return `AT ch${m.channel} ${m.data1}/${m.data2}`;
    case "program":    return `Prog ch${m.channel} → ${m.data1}`;
  }
}
