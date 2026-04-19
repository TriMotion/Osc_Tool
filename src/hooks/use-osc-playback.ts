"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Recording, SavedEndpoint } from "@/lib/types";
import { matchesMapping, computeOscArgValue, resolveOscAddress } from "@/lib/osc-mapping";

interface UseOscPlaybackArgs {
  recording: Recording | null;
  playheadMs: number;
  isPlaying: boolean;
  endpoints: SavedEndpoint[];
  deviceAliases?: Record<string, string>;
}

export function useOscPlayback({ recording, playheadMs, isPlaying, endpoints, deviceAliases }: UseOscPlaybackArgs) {
  const firedRef = useRef<Set<string>>(new Set());
  const lastPlayheadRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(false);

  // Pre-compute annotated event queue — rebuilt when recording, mappings, or aliases change.
  const queue = useMemo(() => {
    if (!recording?.oscMappings?.length) return [];
    const result: Array<{ tRel: number; eventIdx: number; mappingId: string; address: string; value: number; argType: "f" | "i"; endpointId: string }> = [];

    recording.events.forEach((evt, idx) => {
      for (const mapping of recording.oscMappings!) {
        if (!matchesMapping(evt, mapping)) continue;
        result.push({
          tRel: evt.tRel,
          eventIdx: idx,
          mappingId: mapping.id,
          address: resolveOscAddress(mapping, deviceAliases),
          value: computeOscArgValue(evt, mapping),
          argType: mapping.argType,
          endpointId: mapping.endpointId,
        });
      }
    });

    return result; // already sorted because recording.events is sorted by tRel
  }, [recording?.id, recording?.oscMappings, deviceAliases]);

  useEffect(() => {
    // Detect backward seek and reset fired set.
    if (playheadMs < lastPlayheadRef.current - 100) {
      firedRef.current.clear();
    }
    lastPlayheadRef.current = playheadMs;

    // On transition from paused → playing, seed firedRef with all events already behind
    // the playhead so they don't burst-fire on the first tick after resume/seek.
    if (isPlaying && !wasPlayingRef.current) {
      for (const item of queue) {
        if (item.tRel > playheadMs) break;
        firedRef.current.add(`${item.eventIdx}-${item.mappingId}`);
      }
    }
    wasPlayingRef.current = isPlaying;

    if (!isPlaying || queue.length === 0) return;

    for (const item of queue) {
      if (item.tRel > playheadMs) break;
      const key = `${item.eventIdx}-${item.mappingId}`;
      if (firedRef.current.has(key)) continue;
      firedRef.current.add(key);

      const endpoint = endpoints.find((e) => e.id === item.endpointId);
      if (!endpoint) continue;

      window.electronAPI?.invoke("osc:send", { host: endpoint.host, port: endpoint.port }, item.address, [
        { type: item.argType, value: item.value },
      ]);
    }
  }, [playheadMs, isPlaying, queue, endpoints]);
}
