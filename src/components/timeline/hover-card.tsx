"use client";

import type { NoteSpan, RecordedEvent } from "@/lib/types";
import { formatTime } from "@/lib/timeline-util";
import { resolveDeviceName } from "@/lib/osc-mapping";

interface HoverCardProps {
  payload:
    | { kind: "event"; event: RecordedEvent }
    | { kind: "span"; span: NoteSpan }
    | null;
  clientX: number;
  clientY: number;
  aliases?: Record<string, string>;
}

export function HoverCard({ payload, clientX, clientY, aliases }: HoverCardProps) {
  if (!payload) return null;
  const left = Math.min(clientX + 12, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240);
  const top = clientY + 12;

  return (
    <div
      className="fixed z-50 text-[10px] font-mono border border-accent/30 rounded px-2 py-1.5 pointer-events-none"
      style={{ left, top, minWidth: 200, background: "#0f0f1e", boxShadow: "0 8px 24px rgba(0,0,0,0.85)" }}
    >
      {payload.kind === "event" && <EventBody evt={payload.event} aliases={aliases} />}
      {payload.kind === "span" && <SpanBody span={payload.span} aliases={aliases} />}
    </div>
  );
}

function EventBody({ evt, aliases }: { evt: RecordedEvent; aliases?: Record<string, string> }) {
  const { midi, osc, tRel } = evt;
  const oscArgs = osc.args.map((a) => (typeof a.value === "number" ? a.value.toFixed(3) : String(a.value))).join(" ");
  return (
    <>
      <Row label="time"   value={formatTime(tRel)} />
      <Row label="device" value={resolveDeviceName(midi.deviceName, aliases)} />
      <Row label="midi"   value={formatMidiLine(evt)} />
      <Row label="osc"    value={`${osc.address} ${oscArgs}`} color="#ffaed7" />
    </>
  );
}

function SpanBody({ span, aliases }: { span: NoteSpan; aliases?: Record<string, string> }) {
  return (
    <>
      <Row label="time"   value={`${formatTime(span.tStart)} – ${formatTime(span.tEnd)}`} />
      <Row label="device" value={resolveDeviceName(span.device, aliases)} />
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
