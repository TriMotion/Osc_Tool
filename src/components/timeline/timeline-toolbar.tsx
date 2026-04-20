"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { RecorderState } from "@/lib/types";
import { formatTime } from "@/lib/timeline-util";

interface TimelineToolbarProps {
  recorderState: RecorderState;
  hasRecording: boolean;
  isPlaying: boolean;
  playheadMs: number;
  durationMs: number;
  onRecord: () => void;
  onStop: () => void;
  onPlay: () => void;
  onPause: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onSaveProject: () => void;
  onLoad: () => void;
  onImportMidi: () => void;
  triggersSidebarOpen: boolean;
  onToggleTriggersSidebar: () => void;
}

export function TimelineToolbar(props: TimelineToolbarProps) {
  const {
    recorderState, hasRecording, isPlaying, playheadMs, durationMs,
    onRecord, onStop, onPlay, onPause,
    onSave, onSaveAs, onSaveProject, onLoad, onImportMidi,
    triggersSidebarOpen, onToggleTriggersSidebar,
  } = props;

  const recording = recorderState === "recording";
  const [openMenu, setOpenMenu] = useState<"open" | null>(null);
  const openMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (!openMenuRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Transport */}
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
        disabled={!hasRecording || recording}
        className="px-3 py-1.5 rounded-lg text-sm bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {isPlaying ? "⏸ Pause" : "▶ Play"}
      </button>

      <span className="text-xs font-mono text-gray-400 px-2">
        {formatTime(playheadMs)} / {formatTime(durationMs)}
      </span>

      <div className="w-px h-5 bg-white/10 mx-1" />

      {/* Save */}
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
        onClick={onSaveProject}
        disabled={!hasRecording}
        title="Write recording and audio to ./project/ for committing to git"
        className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:text-white hover:border-accent/40 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Save project
      </button>

      {/* Open submenu */}
      <div ref={openMenuRef} className="relative">
        <button
          onClick={() => setOpenMenu((v) => (v === "open" ? null : "open"))}
          className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
            openMenu === "open"
              ? "bg-white/10 text-white border-white/20"
              : "border-white/10 text-gray-300 hover:text-white hover:border-accent/40"
          }`}
        >
          Open ▾
        </button>
        {openMenu === "open" && (
          <div className="absolute top-full left-0 mt-1 bg-surface border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden min-w-[140px]">
            <button
              onClick={() => { onLoad(); setOpenMenu(null); }}
              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
            >
              Load recording…
            </button>
            <button
              onClick={() => { onImportMidi(); setOpenMenu(null); }}
              className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors border-t border-white/5"
            >
              Import .mid…
            </button>
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-white/10 mx-1" />

      <button
        onClick={onToggleTriggersSidebar}
        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
          triggersSidebarOpen
            ? "bg-accent/20 text-accent border-accent/40"
            : "border-white/10 text-gray-300 hover:text-white hover:border-accent/40"
        }`}
      >
        📊 Triggers
      </button>
    </div>
  );
}
