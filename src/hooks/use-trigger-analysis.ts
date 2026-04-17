"use client";

import { useEffect, useRef, useState } from "react";
import type { LaneAnalysis, LaneMap, Moment, NoteSpan, Recording, RedundancyPair } from "@/lib/types";
import { analyzeRecording } from "@/lib/trigger-analysis";
import { detectMoments } from "@/lib/moment-detection";

interface Result {
  analyses: LaneAnalysis[] | null;
  pairs: RedundancyPair[] | null;
  moments: Moment[] | null;
  ready: boolean;
  error: string | null;
}

interface Args {
  recording: Recording | null;
  bufferVersion: number;
  laneMap: LaneMap;
  noteSpans: NoteSpan[];
}

/**
 * Runs trigger analysis in the background, memoized on (recording.id, bufferVersion).
 * Yields via requestIdleCallback so the main thread stays responsive on long takes.
 */
export function useTriggerAnalysis({ recording, bufferVersion, laneMap, noteSpans }: Args): Result {
  const [result, setResult] = useState<Result>({ analyses: null, pairs: null, moments: null, ready: false, error: null });
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    if (!recording || recording.events.length === 0) {
      setResult({ analyses: [], pairs: [], moments: [], ready: true, error: null });
      return;
    }

    setResult((prev) => ({ ...prev, ready: false, error: null }));
    const token = { cancelled: false };
    cancelRef.current = token;

    const run = async () => {
      try {
        await idleYield();
        if (token.cancelled) return;
        const { analyses, pairs } = analyzeRecording(recording, laneMap, noteSpans);
        if (token.cancelled) return;
        const moments = detectMoments(recording, noteSpans);
        if (token.cancelled) return;
        setResult({ analyses, pairs, moments, ready: true, error: null });
      } catch (err) {
        if (token.cancelled) return;
        setResult({ analyses: null, pairs: null, moments: null, ready: true, error: (err as Error).message });
      }
    };
    run();

    return () => { token.cancelled = true; };
    // Depend on identity-stable slices of recording so badge edits don't re-trigger analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording?.id, recording?.events.length, recording?.durationMs, bufferVersion, laneMap, noteSpans]);

  return result;
}

function idleYield(): Promise<void> {
  return new Promise<void>((resolve) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === "function") {
      ric(() => resolve(), { timeout: 3000 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}
