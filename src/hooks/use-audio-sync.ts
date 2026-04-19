"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeAudioPeaks } from "@/lib/timeline-util";

interface UseAudioSyncArgs {
  durationMs: number;
  onPlayheadChange?: (ms: number) => void;
}

export interface TrackState {
  id: string;
  filePath: string;
  src: string;
  durationMs: number;
  peaksByWidth: Map<number, Array<{ min: number; max: number }>>;
  peakSamples: Float32Array | null;
  offsetMs: number;
  mimeType: string;
}

export function useAudioSync({ durationMs, onPlayheadChange }: UseAudioSyncArgs) {
  // Non-reactive map of live HTMLAudioElement per track id.
  const audioEls = useRef<Map<string, HTMLAudioElement>>(new Map());
  const playheadMsRef = useRef<number>(0);
  const playStartedAtRef = useRef<number | null>(null);
  const playStartedHeadRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [tracks, setTracks] = useState<TrackState[]>([]);

  // Always-current refs so callbacks don't go stale.
  const tracksRef = useRef<TrackState[]>(tracks);
  tracksRef.current = tracks;
  const durationMsRef = useRef(durationMs);
  durationMsRef.current = durationMs;
  const onPlayheadChangeRef = useRef(onPlayheadChange);
  onPlayheadChangeRef.current = onPlayheadChange;

  // rAF playback loop — uses first track as master clock, falls back to perf.now.
  useEffect(() => {
    if (!isPlaying) return;
    const tick = () => {
      const ts = tracksRef.current;
      const first = ts[0];
      const firstEl = first ? audioEls.current.get(first.id) : null;
      if (firstEl && first) {
        playheadMsRef.current = firstEl.currentTime * 1000 + first.offsetMs;
      } else if (playStartedAtRef.current !== null) {
        playheadMsRef.current = playStartedHeadRef.current + (performance.now() - playStartedAtRef.current);
      }
      const trackEnds = ts.map((t) => t.offsetMs + t.durationMs).filter((v) => v > 0);
      const total = Math.max(durationMsRef.current, ...trackEnds);
      if (playheadMsRef.current >= total) {
        playheadMsRef.current = total;
        setIsPlaying(false);
        return;
      }
      onPlayheadChangeRef.current?.(playheadMsRef.current);
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isPlaying]);

  const play = useCallback(() => {
    for (const track of tracksRef.current) {
      const el = audioEls.current.get(track.id);
      if (el) {
        el.currentTime = Math.max(0, (playheadMsRef.current - track.offsetMs) / 1000);
        el.play().catch(() => {});
      }
    }
    playStartedAtRef.current = performance.now();
    playStartedHeadRef.current = playheadMsRef.current;
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    for (const [, el] of audioEls.current) el.pause();
    setIsPlaying(false);
    playStartedAtRef.current = null;
  }, []);

  const seek = useCallback((ms: number) => {
    const clamped = Math.max(0, ms);
    playheadMsRef.current = clamped;
    for (const track of tracksRef.current) {
      const el = audioEls.current.get(track.id);
      if (el) el.currentTime = Math.max(0, (clamped - track.offsetMs) / 1000);
    }
    playStartedAtRef.current = null;
    playStartedHeadRef.current = clamped;
    onPlayheadChangeRef.current?.(clamped);
  }, []);

  const setTrackOffset = useCallback((id: string, ms: number) => {
    setTracks((prev) => prev.map((t) => (t.id !== id ? t : { ...t, offsetMs: ms })));
    const el = audioEls.current.get(id);
    if (el) el.currentTime = Math.max(0, (playheadMsRef.current - ms) / 1000);
  }, []);

  /** Decode audio bytes and add (or replace) a track. */
  const loadTrack = useCallback(
    async (id: string, filePath: string, bytes: ArrayBuffer, mimeType: string, initialOffsetMs = 0) => {
      const blob = new Blob([bytes], { type: mimeType });
      const src = URL.createObjectURL(blob);
      let committed = false;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      try {
        const decoded = await ctx.decodeAudioData(bytes.slice(0));
        const channels = decoded.numberOfChannels;
        const len = decoded.length;
        const mono = new Float32Array(len);
        for (let ch = 0; ch < channels; ch++) {
          const data = decoded.getChannelData(ch);
          for (let i = 0; i < len; i++) mono[i] += data[i];
        }
        if (channels > 1) for (let i = 0; i < len; i++) mono[i] /= channels;
        const audioDurationMs = (len / decoded.sampleRate) * 1000;

        // Swap out any existing audio element for this id.
        const oldEl = audioEls.current.get(id);
        if (oldEl) { oldEl.pause(); audioEls.current.delete(id); }
        const el = new Audio(src);
        el.preload = "auto";
        audioEls.current.set(id, el);

        setTracks((prev) => {
          const existing = prev.find((t) => t.id === id);
          if (existing?.src) URL.revokeObjectURL(existing.src);
          const next: TrackState = {
            id, filePath, src,
            durationMs: audioDurationMs,
            peaksByWidth: new Map(),
            peakSamples: mono,
            offsetMs: initialOffsetMs,
            mimeType,
          };
          return [...prev.filter((t) => t.id !== id), next];
        });
        committed = true;
      } finally {
        if (!committed) URL.revokeObjectURL(src);
        try { await ctx.close(); } catch { /* noop */ }
      }
    },
    []
  );

  const unloadTrack = useCallback((id: string) => {
    const el = audioEls.current.get(id);
    if (el) { el.pause(); audioEls.current.delete(id); }
    setTracks((prev) => {
      const t = prev.find((t) => t.id === id);
      if (t?.src) URL.revokeObjectURL(t.src);
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const unloadAll = useCallback(() => {
    for (const [, el] of audioEls.current) el.pause();
    audioEls.current.clear();
    setTracks((prev) => {
      for (const t of prev) if (t.src) URL.revokeObjectURL(t.src);
      return [];
    });
  }, []);

  /** Get (or compute and cache) peaks for a given track at a given pixel width. */
  const getTrackPeaks = useCallback(
    (id: string, pixelWidth: number): Array<{ min: number; max: number }> | null => {
      const track = tracksRef.current.find((t) => t.id === id);
      if (!track?.peakSamples) return null;
      const cached = track.peaksByWidth.get(pixelWidth);
      if (cached) return cached;
      const peaks = computeAudioPeaks(track.peakSamples, pixelWidth);
      track.peaksByWidth.set(pixelWidth, peaks);
      return peaks;
    },
    []
  );

  return {
    isPlaying,
    tracks,
    playheadMsRef,
    play,
    pause,
    seek,
    setTrackOffset,
    loadTrack,
    unloadTrack,
    unloadAll,
    getTrackPeaks,
  };
}
