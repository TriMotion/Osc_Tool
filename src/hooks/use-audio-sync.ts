"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeAudioPeaks } from "@/lib/timeline-util";

interface UseAudioSyncArgs {
  /** Recording duration in ms (upper bound for transport). */
  durationMs: number;
  /** Called whenever playhead changes by integration; not every rAF tick. Optional. */
  onPlayheadChange?: (ms: number) => void;
}

interface AudioState {
  filePath: string | null;
  src: string | null;       // blob URL or null
  durationMs: number;       // audio duration in ms (0 if no audio)
  peaksByWidth: Map<number, Array<{ min: number; max: number }>>; // cached per width
  peakSamples: Float32Array | null; // mono mixdown for peak re-computation
  offsetMs: number;
  mimeType: string | null;
}

export function useAudioSync({ durationMs, onPlayheadChange }: UseAudioSyncArgs) {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playheadMsRef = useRef<number>(0);
  const playStartedAtRef = useRef<number | null>(null); // performance.now() when play began
  const playStartedHeadRef = useRef<number>(0);         // playhead at play start
  const rafIdRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [audio, setAudio] = useState<AudioState>({
    filePath: null,
    src: null,
    durationMs: 0,
    peaksByWidth: new Map(),
    peakSamples: null,
    offsetMs: 0,
    mimeType: null,
  });

  // Attach / detach the <audio> element on audio change.
  useEffect(() => {
    if (!audio.src) {
      audioElRef.current = null;
      return;
    }
    const el = new Audio(audio.src);
    el.preload = "auto";
    audioElRef.current = el;
    return () => {
      el.pause();
      audioElRef.current = null;
    };
  }, [audio.src]);

  // rAF loop: maintain playheadMsRef while playing.
  useEffect(() => {
    if (!isPlaying) return;
    const tick = () => {
      const el = audioElRef.current;
      if (el && audio.src) {
        playheadMsRef.current = el.currentTime * 1000 - audio.offsetMs;
      } else if (playStartedAtRef.current !== null) {
        playheadMsRef.current = playStartedHeadRef.current + (performance.now() - playStartedAtRef.current);
      }
      const total = Math.max(durationMs, audio.durationMs - audio.offsetMs);
      if (playheadMsRef.current >= total) {
        playheadMsRef.current = total;
        setIsPlaying(false);
        return;
      }
      onPlayheadChange?.(playheadMsRef.current);
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isPlaying, audio.src, audio.offsetMs, audio.durationMs, durationMs, onPlayheadChange]);

  const play = useCallback(() => {
    const el = audioElRef.current;
    if (el) {
      el.currentTime = Math.max(0, (playheadMsRef.current + audio.offsetMs) / 1000);
      el.play().catch(() => {});
    } else {
      playStartedAtRef.current = performance.now();
      playStartedHeadRef.current = playheadMsRef.current;
    }
    setIsPlaying(true);
  }, [audio.offsetMs]);

  const pause = useCallback(() => {
    const el = audioElRef.current;
    if (el) el.pause();
    setIsPlaying(false);
    playStartedAtRef.current = null;
  }, []);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(ms, Math.max(durationMs, audio.durationMs - audio.offsetMs)));
      playheadMsRef.current = clamped;
      const el = audioElRef.current;
      if (el) el.currentTime = Math.max(0, (clamped + audio.offsetMs) / 1000);
      playStartedAtRef.current = isPlaying ? performance.now() : null;
      playStartedHeadRef.current = clamped;
      onPlayheadChange?.(clamped);
    },
    [durationMs, audio.durationMs, audio.offsetMs, isPlaying, onPlayheadChange]
  );

  const setOffset = useCallback((ms: number) => {
    setAudio((a) => ({ ...a, offsetMs: ms }));
    const el = audioElRef.current;
    if (el) {
      el.currentTime = Math.max(0, (playheadMsRef.current + ms) / 1000);
    }
  }, []);

  /**
   * Decode audio bytes into a playable blob URL + peaks array for the waveform.
   * Retains only a mono-mixdown Float32Array for re-bucketing on zoom change.
   */
  const loadBytes = useCallback(
    async (filePath: string, bytes: ArrayBuffer, mimeType: string, initialOffsetMs = 0) => {
      // Playback: blob URL
      const blob = new Blob([bytes], { type: mimeType });
      const src = URL.createObjectURL(blob);

      // Peaks: decode via Web Audio and mix to mono.
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(bytes.slice(0));
      const channels = decoded.numberOfChannels;
      const len = decoded.length;
      const mono = new Float32Array(len);
      for (let ch = 0; ch < channels; ch++) {
        const data = decoded.getChannelData(ch);
        for (let i = 0; i < len; i++) mono[i] += data[i];
      }
      if (channels > 1) {
        for (let i = 0; i < len; i++) mono[i] /= channels;
      }
      const audioDurationMs = (len / decoded.sampleRate) * 1000;
      try { await ctx.close(); } catch { /* noop */ }

      setAudio((prev) => {
        if (prev.src) URL.revokeObjectURL(prev.src);
        return {
          filePath,
          src,
          durationMs: audioDurationMs,
          peaksByWidth: new Map(),
          peakSamples: mono,
          offsetMs: initialOffsetMs,
          mimeType,
        };
      });
    },
    []
  );

  /** Get (or compute and cache) the peaks for a given pixel width. */
  const getPeaks = useCallback(
    (pixelWidth: number) => {
      if (!audio.peakSamples) return null;
      const cached = audio.peaksByWidth.get(pixelWidth);
      if (cached) return cached;
      const peaks = computeAudioPeaks(audio.peakSamples, pixelWidth);
      audio.peaksByWidth.set(pixelWidth, peaks);
      return peaks;
    },
    [audio.peakSamples, audio.peaksByWidth]
  );

  const unloadAudio = useCallback(() => {
    setAudio((prev) => {
      if (prev.src) URL.revokeObjectURL(prev.src);
      return {
        filePath: null,
        src: null,
        durationMs: 0,
        peaksByWidth: new Map(),
        peakSamples: null,
        offsetMs: 0,
        mimeType: null,
      };
    });
  }, []);

  return {
    isPlaying,
    audio,
    playheadMsRef,
    play,
    pause,
    seek,
    setOffset,
    loadBytes,
    unloadAudio,
    getPeaks,
  };
}
