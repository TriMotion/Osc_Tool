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
}

export function useOscPlayback({ recording, playheadMsRef, isPlaying, endpoints, deviceAliases }: UseOscPlaybackArgs) {
  const firedRef = useRef<Set<string>>(new Set());
  const lastPlayheadRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(false);

  // Keep refs current so the interval closure never reads stale values.
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const endpointsRef = useRef(endpoints);
  useEffect(() => { endpointsRef.current = endpoints; }, [endpoints]);

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
    };

    const id = setInterval(tick, 8);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
