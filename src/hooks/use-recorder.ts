"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import type {
  MidiEvent,
  MidiMappingRule,
  Recording,
  RecordedEvent,
  RecorderState,
} from "@/lib/types";
import { useMidiEvents } from "@/hooks/use-midi";

interface UseRecorderArgs {
  getMappingRulesSnapshot: () => MidiMappingRule[]; // called on stop
}

/**
 * Recorder state machine + in-memory buffer.
 *
 * The buffer is kept in a ref (not state) to avoid copying huge arrays on
 * every batch. `bufferVersion` is bumped each time the buffer is mutated;
 * components that read `bufferRef.current` depend on `bufferVersion` to
 * re-render.
 */
export function useRecorder({ getMappingRulesSnapshot }: UseRecorderArgs) {
  const [state, setState] = useState<RecorderState>("idle");
  const [bufferVersion, setBufferVersion] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);

  const bufferRef = useRef<RecordedEvent[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const stateRef = useRef<RecorderState>("idle");
  stateRef.current = state;

  useMidiEvents(
    useCallback((incoming: MidiEvent[]) => {
      if (stateRef.current !== "recording") return;
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;

      for (const ev of incoming) {
        const tRel = Math.max(0, ev.midi.timestamp - startedAt);
        bufferRef.current.push({ tRel, midi: ev.midi, osc: ev.osc });
      }
      setBufferVersion((v) => v + 1);
    }, [])
  );

  const start = useCallback(() => {
    bufferRef.current = [];
    startedAtRef.current = Date.now();
    setRecording(null);
    setHasUnsaved(false);
    setBufferVersion((v) => v + 1);
    setState("recording");
  }, []);

  const stop = useCallback(() => {
    if (stateRef.current !== "recording") return;
    const startedAt = startedAtRef.current ?? Date.now();
    const durationMs = Date.now() - startedAt;
    const events = bufferRef.current;
    const devices = Array.from(new Set(events.map((e) => e.midi.deviceName)));

    const rec: Recording = {
      version: 1,
      id: crypto.randomUUID(),
      name: "Untitled",
      startedAt,
      durationMs,
      events,
      devices,
      mappingRulesSnapshot: getMappingRulesSnapshot(),
      audioTracks: [],
    };

    setRecording(rec);
    setHasUnsaved(true);
    setState("stopped");
  }, [getMappingRulesSnapshot]);

  /** Clear buffer and recording, returning to idle. Does NOT prompt. */
  const clear = useCallback(() => {
    bufferRef.current = [];
    startedAtRef.current = null;
    setRecording(null);
    setHasUnsaved(false);
    setBufferVersion((v) => v + 1);
    setState("idle");
  }, []);

  /** Replace the current in-memory recording (e.g. after Load from file). */
  const setLoaded = useCallback((rec: Recording) => {
    bufferRef.current = rec.events;
    startedAtRef.current = null;
    setRecording(rec);
    setHasUnsaved(false);
    setBufferVersion((v) => v + 1);
    setState("stopped");
  }, []);

  /** Update recording metadata (e.g. rename, attach audio). Marks as unsaved. */
  const patchRecording = useCallback((patch: Partial<Recording>) => {
    setRecording((prev) => {
      if (!prev) return prev;
      return { ...prev, ...patch };
    });
    setHasUnsaved(true);
  }, []);

  const markSaved = useCallback(() => {
    setHasUnsaved(false);
  }, []);

  /** Merge another recording's events into the current buffer (used for multi-MIDI import). */
  const mergeRecording = useCallback((incoming: Recording) => {
    const merged = [...bufferRef.current, ...incoming.events].sort((a, b) => a.tRel - b.tRel);
    bufferRef.current = merged;
    setRecording((prev) => {
      const base = prev ?? incoming;
      const deviceSet = new Set([...base.devices, ...incoming.devices]);
      return {
        ...base,
        events: merged,
        durationMs: Math.max(base.durationMs, incoming.durationMs),
        devices: Array.from(deviceSet),
      };
    });
    setHasUnsaved(true);
    setBufferVersion((v) => v + 1);
    setState("stopped");
  }, []);

  /** Remove note-on/note-off pairs for a given device where pitch AND velocity both match. */
  const deleteNotesByVelocity = useCallback((deviceName: string, pitch: number, velocity: number) => {
    const events = bufferRef.current;

    // Collect note-on indices that match pitch + velocity, keyed by "channel|pitch|tRel" for pairing.
    const matchedOnKeys = new Set<string>();
    for (const e of events) {
      if (
        e.midi.deviceName === deviceName &&
        e.midi.type === "noteon" &&
        e.midi.data1 === pitch &&
        e.midi.data2 === velocity
      ) {
        matchedOnKeys.add(`${e.midi.channel}|${e.midi.data1}|${e.tRel}`);
      }
    }

    // Walk forward pairing note-ons to note-offs (FIFO per channel|pitch).
    const toRemove = new Set<number>();
    const openStacks = new Map<string, number[]>(); // "channel|pitch" → stack of event indices

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const m = e.midi;
      if (m.deviceName !== deviceName) continue;

      if (m.type === "noteon") {
        const noteKey = `${m.channel}|${m.data1}|${e.tRel}`;
        if (matchedOnKeys.has(noteKey)) {
          toRemove.add(i);
          const stackKey = `${m.channel}|${m.data1}`;
          const stack = openStacks.get(stackKey) ?? [];
          stack.push(i);
          openStacks.set(stackKey, stack);
        }
      } else if (m.type === "noteoff" && m.data1 === pitch) {
        const stackKey = `${m.channel}|${m.data1}`;
        const stack = openStacks.get(stackKey);
        if (stack && stack.length > 0) {
          stack.shift();
          toRemove.add(i);
        }
      }
    }

    const filtered = events.filter((_, i) => !toRemove.has(i));
    bufferRef.current = filtered;
    setRecording((prev) => {
      if (!prev) return prev;
      return { ...prev, events: filtered };
    });
    setHasUnsaved(true);
    setBufferVersion((v) => v + 1);
  }, []);

  /** Remove all events for a given device name from the buffer. */
  const deleteDevice = useCallback((deviceName: string) => {
    const filtered = bufferRef.current.filter((e) => e.midi.deviceName !== deviceName);
    bufferRef.current = filtered;
    setRecording((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        events: filtered,
        devices: prev.devices.filter((d) => d !== deviceName),
      };
    });
    setHasUnsaved(true);
    setBufferVersion((v) => v + 1);
  }, []);

  // Defensive: if component unmounts mid-recording, don't leak event handler work.
  useEffect(() => () => {
    stateRef.current = "idle";
  }, []);

  return {
    state,
    bufferVersion,
    bufferRef,
    recording,
    hasUnsaved,
    start,
    stop,
    clear,
    setLoaded,
    mergeRecording,
    deleteNotesByVelocity,
    deleteDevice,
    patchRecording,
    markSaved,
    startedAtRef,
  };
}
