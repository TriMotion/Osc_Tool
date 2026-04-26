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
  const [openFile, setOpenFile] = useState(false);
  const fileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openFile) return;
    const h = (e: MouseEvent) => { if (!fileRef.current?.contains(e.target as Node)) setOpenFile(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [openFile]);

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
        className="px-3 py-1.5 rounded-lg text-sm bg-timeline/10 text-timeline border border-timeline/30 hover:bg-timeline/20 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {isPlaying ? "⏸ Pause" : "▶ Play"}
      </button>

      <span className="text-xs font-mono text-gray-400 px-2">
        {formatTime(playheadMs)} / {formatTime(durationMs)}
      </span>

      <div className="w-px h-5 bg-white/10 mx-1" />

      {/* File menu */}
      <div ref={fileRef} className="relative">
        <button
          onClick={() => setOpenFile((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:text-white hover:border-timeline/40"
        >
          File ▾
        </button>
        {openFile && (
          <div className="absolute top-full left-0 mt-1 bg-black border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden min-w-[180px]">
            <FileMenuItem label="Save" onClick={() => { onSave(); setOpenFile(false); }} disabled={!hasRecording} />
            <FileMenuItem label="Save As…" onClick={() => { onSaveAs(); setOpenFile(false); }} disabled={!hasRecording} />
            <FileMenuItem label="Save project" onClick={() => { onSaveProject(); setOpenFile(false); }} disabled={!hasRecording} />
            <div className="h-px bg-white/5" />
            <FileMenuItem label="Load recording…" onClick={() => { onLoad(); setOpenFile(false); }} />
            <FileMenuItem label="Import .mid…" onClick={() => { onImportMidi(); setOpenFile(false); }} />
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-white/10 mx-1" />

      <button
        onClick={onToggleTriggersSidebar}
        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
          triggersSidebarOpen
            ? "bg-timeline/20 text-timeline border-timeline/40"
            : "border-white/10 text-gray-300 hover:text-white hover:border-timeline/40"
        }`}
      >
        Mappings
      </button>
    </div>
  );
}

function FileMenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
    >
      {label}
    </button>
  );
}
