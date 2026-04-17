"use client";

import { motion } from "framer-motion";
import type { RecorderState } from "@/lib/types";
import { formatTime } from "@/lib/timeline-util";

interface TimelineToolbarProps {
  recorderState: RecorderState;
  hasRecording: boolean;
  isPlaying: boolean;
  playheadMs: number;
  durationMs: number;
  audioOffsetMs: number;
  audioLoaded: boolean;
  onRecord: () => void;
  onStop: () => void;
  onPlay: () => void;
  onPause: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onLoad: () => void;
  onLoadAudio: () => void;
  onUnloadAudio: () => void;
  onOffsetChange: (ms: number) => void;
}

export function TimelineToolbar(props: TimelineToolbarProps) {
  const {
    recorderState, hasRecording, isPlaying, playheadMs, durationMs,
    audioOffsetMs, audioLoaded,
    onRecord, onStop, onPlay, onPause,
    onSave, onSaveAs, onLoad, onLoadAudio, onUnloadAudio, onOffsetChange,
  } = props;

  const canPlay = hasRecording || audioLoaded;
  const recording = recorderState === "recording";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={recording ? onStop : onRecord}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
          recording
            ? "bg-red-500/30 text-red-200 border-red-500/50"
            : "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
        }`}
      >
        {recording ? "■ Stop" : "● Record"}
      </motion.button>

      <button
        onClick={isPlaying ? onPause : onPlay}
        disabled={!canPlay || recording}
        className="px-3 py-1.5 rounded-lg text-sm bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {isPlaying ? "⏸ Pause" : "▶ Play"}
      </button>

      <span className="text-xs font-mono text-gray-400 px-2">
        {formatTime(playheadMs)} / {formatTime(durationMs)}
      </span>

      <div className="w-px h-5 bg-white/10 mx-1" />

      <button
        onClick={onSave}
        disabled={!hasRecording}
        className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:text-white hover:border-accent/40 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Save
      </button>
      <button
        onClick={onSaveAs}
        disabled={!hasRecording}
        className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:text-white hover:border-accent/40 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Save As…
      </button>
      <button
        onClick={onLoad}
        className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:text-white hover:border-accent/40"
      >
        Load…
      </button>

      <div className="w-px h-5 bg-white/10 mx-1" />

      {audioLoaded ? (
        <>
          <button
            onClick={onUnloadAudio}
            className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-400 hover:text-white hover:border-accent/40"
          >
            ♪ Remove audio
          </button>
          <span className="text-[10px] text-gray-500 font-mono">offset</span>
          <input
            type="number"
            step={0.001}
            value={(audioOffsetMs / 1000).toFixed(3)}
            onChange={(e) => {
              const s = parseFloat(e.target.value);
              if (!Number.isNaN(s)) onOffsetChange(Math.round(s * 1000));
            }}
            className="w-20 text-xs px-2 py-1 bg-surface-lighter border border-white/10 rounded focus:outline-none focus:border-accent/50 font-mono"
          />
          <span className="text-[10px] text-gray-500">s</span>
        </>
      ) : (
        <button
          onClick={onLoadAudio}
          className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-400 hover:text-white hover:border-accent/40"
        >
          ♪ Load audio…
        </button>
      )}
    </div>
  );
}
