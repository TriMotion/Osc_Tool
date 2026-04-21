"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Recording, SavedEndpoint } from "@/lib/types";
import { matchesMapping, computeOscArgValue, resolveOscAddress } from "@/lib/osc-mapping";

interface UseOscPlaybackArgs {
  recording: Recording | null;
  playheadMsRef: React.RefObject<number>;
  isPlaying: boolean;
  endpoints: SavedEndpoint[];
  deviceAliases?: Record<string, string>;
  onActivity?: (laneKeys: string[]) => void;
}

export function useOscPlayback({ recording, playheadMsRef, isPlaying, endpoints, deviceAliases, onActivity }: UseOscPlaybackArgs) {
  const firedRef = useRef<Set<string>>(new Set());
  const lastPlayheadRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(false);
  const activityCursorRef = useRef<number>(0);

  // Keep refs current so the interval closure never reads stale values.
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const endpointsRef = useRef(endpoints);
  useEffect(() => { endpointsRef.current = endpoints; }, [endpoints]);

  const onActivityRef = useRef(onActivity);
  useEffect(() => { onActivityRef.current = onActivity; }, [onActivity]);

  const recordingRef = useRef(recording);
  useEffect(() => { recordingRef.current = recording; activityCursorRef.current = 0; }, [recording?.id]);

  // Pre-compute annotated event queue — rebuilt when recording, mappings, or aliases change.
  const queue = useMemo(() => {
    if (!recording?.oscMappings?.length) return [];
    const result: Array<{ tRel: number; eventIdx: number; mappingId: string; address: string; value: number; argType: "f" | "i"; endpointId: string }> = [];

    recording.events.forEach((evt, idx) => {
      for (const mapping of recording.oscMappings!) {
        if (!matchesMapping(evt, mapping)) continue;
        const address = resolveOscAddress(mapping, deviceAliases, evt.midi.type === "noteon" ? evt.midi.data2 : undefined);
        const value = computeOscArgValue(evt, mapping);
        const endpointIds = [mapping.endpointId, ...(mapping.extraEndpointIds ?? [])];
        for (const epId of endpointIds) {
          result.push({
            tRel: evt.tRel,
            eventIdx: idx,
            mappingId: mapping.id,
            address,
            value,
            argType: mapping.argType,
            endpointId: epId,
          });
        }
      }
    });

    return result; // already sorted because recording.events is sorted by tRel
  }, [recording?.id, recording?.oscMappings, deviceAliases]);

  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // Own interval — reads only from refs so it never depends on React renders.
  // This keeps OSC firing even when the window is minimized or unfocused.
  useEffect(() => {
    const tick = () => {
      const playheadMs = playheadMsRef.current ?? 0;
      const playing = isPlayingRef.current;
      const q = queueRef.current;

      if (playheadMs < lastPlayheadRef.current - 100) {
        firedRef.current.clear();
      }
      lastPlayheadRef.current = playheadMs;

      // On transition from paused → playing, seed firedRef with events already behind
      // the playhead so they don't burst-fire on resume/seek.
      if (playing && !wasPlayingRef.current) {
        for (const item of q) {
          if (item.tRel > playheadMs) break;
          firedRef.current.add(`${item.eventIdx}-${item.mappingId}-${item.endpointId}`);
        }
      }
      wasPlayingRef.current = playing;

      if (!playing || q.length === 0) return;

      for (const item of q) {
        if (item.tRel > playheadMs) break;
        const key = `${item.eventIdx}-${item.mappingId}-${item.endpointId}`;
        if (firedRef.current.has(key)) continue;
        firedRef.current.add(key);

        const endpoint = endpointsRef.current.find((e) => e.id === item.endpointId);
        if (!endpoint) continue;

        window.electronAPI?.invoke("osc:send", { host: endpoint.host, port: endpoint.port }, item.address, [
          { type: item.argType, value: item.value },
        ]);
      }

      // Activity detection: find events the playhead just passed over and report lane keys.
      const rec = recordingRef.current;
      const activityCb = onActivityRef.current;
      if (rec && activityCb) {
        const events = rec.events;
        if (playheadMs < lastPlayheadRef.current - 100) {
          activityCursorRef.current = 0;
        }
        let cursor = activityCursorRef.current;
        const keys = new Set<string>();
        while (cursor < events.length && events[cursor].tRel <= playheadMs) {
          if (events[cursor].tRel > playheadMs - 50) {
            const evt = events[cursor];
            const m = evt.midi;
            let lk: string | null = null;
            switch (m.type) {
              case "noteon": case "noteoff": lk = `${m.deviceName}|notes`; break;
              case "cc": lk = `${m.deviceName}|cc|${m.channel}|${m.data1}`; break;
              case "pitch": lk = `${m.deviceName}|pitch|${m.channel}`; break;
              case "aftertouch": lk = `${m.deviceName}|at|${m.channel}|ch`; break;
              case "program": lk = `${m.deviceName}|prog|${m.channel}`; break;
            }
            if (lk) keys.add(lk);
          }
          cursor++;
        }
        activityCursorRef.current = cursor;
        if (keys.size > 0) activityCb(Array.from(keys));
      }
    };

    const id = setInterval(tick, 8);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
