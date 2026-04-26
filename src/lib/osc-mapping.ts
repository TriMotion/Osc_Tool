import type { LaneKey, OscMapping, RecordedEvent } from "./types";
import { laneKeyString } from "./types";

export function resolveDeviceName(name: string, aliases?: Record<string, string>): string {
  const display = aliases?.[name] ?? name;
  return display.replace(/\.(mid|midi)$/i, "");
}

const sequentialCounters = new Map<string, number>();

export function resolveOscAddress(mapping: OscMapping, aliases?: Record<string, string>, eventVelocity?: number): string {
  switch (mapping.preset) {
    case "custom":
      return mapping.address ?? "/";
    case "unreal": {
      const [pitch, groupVelocity] = mapping.targetId.split("|");
      const section = mapping.sectionName ?? "default";
      const deviceName = resolveDeviceName(mapping.deviceId, aliases);
      const velocity = eventVelocity !== undefined ? eventVelocity : groupVelocity;
      return `/unreal/${section}/${deviceName}/${pitch}/${velocity}`;
    }
    case "resolume": {
      if (mapping.resolumeMode === "column") {
        return `/composition/columns/${mapping.resolumeColumn ?? 1}/connect`;
      }
      const layer = mapping.resolumeLayer ?? 1;
      const clipMin = mapping.resolumeClip ?? 1;
      const clipMax = mapping.resolumeClipMax;
      let clip = clipMin;
      if (clipMax && clipMax > clipMin) {
        if (mapping.resolumeClipMode === "sequential") {
          const counterKey = mapping.sequenceGroup || mapping.id;
          const prev = sequentialCounters.get(counterKey) ?? clipMin;
          clip = prev > clipMax ? clipMin : prev;
          sequentialCounters.set(counterKey, clip + 1);
        } else {
          clip = Math.floor(Math.random() * (clipMax - clipMin + 1)) + clipMin;
        }
      }
      return `/composition/layers/${layer}/clips/${clip}/connect`;
    }
  }
}

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

function velocityPasses(velocity: number, mapping: OscMapping): boolean {
  const filter = mapping.velocityFilter ?? "all";
  if (filter === "all") return true;
  if (filter === "min") return velocity >= (mapping.velocityMin ?? 0);
  if (filter === "exact") return velocity === (mapping.velocityExact ?? 0);
  return true;
}

export function matchesMapping(evt: RecordedEvent, mapping: OscMapping): boolean {
  if (evt.midi.deviceName !== mapping.deviceId) return false;

  if (mapping.targetType === "noteGroup") {
    const [pitchStr] = mapping.targetId.split("|");
    const pitch = parseInt(pitchStr, 10);

    if ((mapping.trigger === "on" || mapping.trigger === "both") && evt.midi.type === "noteon") {
      return evt.midi.data1 === pitch && velocityPasses(evt.midi.data2, mapping);
    }
    if ((mapping.trigger === "off" || mapping.trigger === "both") && evt.midi.type === "noteoff") {
      return evt.midi.data1 === pitch;
    }
    return false;
  }

  if (mapping.targetType === "lane") {
    const laneKey = evtToLaneKey(evt);
    if (laneKey === null || laneKeyString(laneKey) !== mapping.targetId) return false;
    if (mapping.velocityFilter && mapping.velocityFilter !== "all") {
      return velocityPasses(evt.midi.data2, mapping);
    }
    return true;
  }

  return false;
}

export function computeOscArgValue(evt: RecordedEvent, mapping: OscMapping): number {
  if (mapping.targetType === "noteGroup") {
    if (evt.midi.type !== "noteon") return 0;
    return mapping.argType === "f" ? evt.midi.data2 / 127 : evt.midi.data2;
  }
  return mapping.argType === "f" ? evt.midi.data2 / 127 : evt.midi.data2;
}
