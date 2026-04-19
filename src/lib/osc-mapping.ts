import type { LaneKey, OscMapping, RecordedEvent } from "./types";
import { laneKeyString } from "./types";

export function resolveOscAddress(mapping: OscMapping): string {
  switch (mapping.preset) {
    case "custom":
      return mapping.address ?? "/";
    case "unreal": {
      const [pitch, velocity] = mapping.targetId.split("|");
      const section = mapping.sectionName ?? "default";
      return `/unreal/${section}/${mapping.deviceId}/${pitch}/${velocity}`;
    }
    case "resolume":
      return mapping.resolumeMode === "column"
        ? `/composition/columns/${mapping.resolumeColumn ?? 1}/connect`
        : `/composition/layers/${mapping.resolumeLayer ?? 1}/clips/${mapping.resolumeClip ?? 1}/connect`;
  }
}

/** Canonical note group targetId for an OscMapping. */
export function noteGroupTargetId(pitch: number, velocity: number): string {
  return `${pitch}|${velocity}`;
}

function evtToLaneKey(evt: RecordedEvent): LaneKey | null {
  switch (evt.midi.type) {
    case "cc":
      return { kind: "cc", device: evt.midi.deviceName, channel: evt.midi.channel, cc: evt.midi.data1 };
    case "pitch":
      return { kind: "pitch", device: evt.midi.deviceName, channel: evt.midi.channel };
    case "aftertouch":
      return { kind: "aftertouch", device: evt.midi.deviceName, channel: evt.midi.channel };
    case "program":
      return { kind: "program", device: evt.midi.deviceName, channel: evt.midi.channel };
    default:
      return null;
  }
}

export function matchesMapping(evt: RecordedEvent, mapping: OscMapping): boolean {
  if (evt.midi.deviceName !== mapping.deviceId) return false;

  if (mapping.targetType === "noteGroup") {
    const [pitchStr, velocityStr] = mapping.targetId.split("|");
    const pitch = parseInt(pitchStr, 10);
    const velocity = parseInt(velocityStr, 10);

    if ((mapping.trigger === "on" || mapping.trigger === "both") && evt.midi.type === "noteon") {
      return evt.midi.data1 === pitch && evt.midi.data2 === velocity;
    }
    if ((mapping.trigger === "off" || mapping.trigger === "both") && evt.midi.type === "noteoff") {
      // Note-off events don't carry the originating note-on velocity, so we match
      // on pitch only — all velocity variants of this pitch will fire on note-off.
      return evt.midi.data1 === pitch;
    }
    return false;
  }

  if (mapping.targetType === "lane") {
    const laneKey = evtToLaneKey(evt);
    return laneKey !== null && laneKeyString(laneKey) === mapping.targetId;
  }

  return false;
}

export function computeOscArgValue(evt: RecordedEvent, mapping: OscMapping): number {
  if (mapping.targetType === "noteGroup") {
    const isOn = evt.midi.type === "noteon";
    return mapping.argType === "f" ? (isOn ? 1.0 : 0.0) : (isOn ? 1 : 0);
  }
  // Lane: data2 is the raw value (0–127 for CC/AT/program, pitch varies)
  return mapping.argType === "f" ? evt.midi.data2 / 127 : evt.midi.data2;
}
