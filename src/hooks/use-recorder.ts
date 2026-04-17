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
      audio: undefined,
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
    patchRecording,
    markSaved,
    startedAtRef,
  };
}
