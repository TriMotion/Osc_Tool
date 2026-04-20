import type { OscMapping, RecordedEvent, Recording, TimelineSection } from "./types";
import { laneKeyString } from "./types";
import { sectionContainingMs } from "./timeline-util";

function laneKeyFromEvent(event: RecordedEvent): string | null {
  const m = event.midi;
  switch (m.type) {
    case "noteon":
    case "noteoff":
      return laneKeyString({ kind: "notes", device: m.deviceName });
    case "cc":
      return laneKeyString({ kind: "cc", device: m.deviceName, channel: m.channel, cc: m.data1 });
    case "pitch":
      return laneKeyString({ kind: "pitch", device: m.deviceName, channel: m.channel });
    case "aftertouch":
      return laneKeyString(
        m.data2 === 0
          ? { kind: "aftertouch", device: m.deviceName, channel: m.channel }
          : { kind: "aftertouch", device: m.deviceName, channel: m.channel, note: m.data1 },
      );
    case "program":
      return laneKeyString({ kind: "program", device: m.deviceName, channel: m.channel });
  }
}

function eventMatchesMapping(event: RecordedEvent, mapping: OscMapping): boolean {
  if (event.midi.deviceName !== mapping.deviceId) return false;
  if (mapping.targetType === "noteGroup") {
    const [pitchStr, velStr] = mapping.targetId.split("|");
    const pitch = Number(pitchStr);
    const m = event.midi;
    if (m.type !== "noteon" && m.type !== "noteoff") return false;
    if (m.data1 !== pitch) return false;
    if (velStr && velStr !== "null" && !Number.isNaN(Number(velStr))) {
      if (m.type === "noteon" && m.data2 !== Number(velStr)) return false;
    }
    return true;
  }
  return laneKeyFromEvent(event) === mapping.targetId;
}

function firstMatchingEventTime(events: RecordedEvent[], mapping: OscMapping): number | null {
  for (const ev of events) {
    if (eventMatchesMapping(ev, mapping)) return ev.tRel;
  }
  return null;
}

function migrateOne(
  mapping: OscMapping,
  events: RecordedEvent[],
  sections: TimelineSection[] | undefined,
): OscMapping {
  if (mapping.sectionId) return mapping;
  const t = firstMatchingEventTime(events, mapping);
  if (t == null) return mapping;
  const section = sectionContainingMs(sections, t);
  if (!section) return mapping;
  return { ...mapping, sectionId: section.id };
}

/**
 * Produce a copy of the recording with legacy OSC mappings migrated to carry
 * a `sectionId`. Mappings whose trigger falls outside every section stay
 * unassigned (orphans) and must be handled by the UI.
 */
export function migrateOscMappings(recording: Recording): Recording {
  const mappings = recording.oscMappings;
  if (!mappings?.length) return recording;
  if (!mappings.some((m) => !m.sectionId)) return recording;
  const migrated = mappings.map((m) => migrateOne(m, recording.events, recording.sections));
  return { ...recording, oscMappings: migrated };
}
