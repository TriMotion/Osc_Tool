"use client";

import type { Recording, RecorderState } from "@/lib/types";
import { formatTime } from "@/lib/timeline-util";

interface RecordingInfoProps {
  recording: Recording | null;
  recorderState: RecorderState;
  hasUnsaved: boolean;
  onRename: (name: string) => void;
}

export function RecordingInfoPanel({ recording, recorderState, hasUnsaved, onRename }: RecordingInfoProps) {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      <input
        type="text"
        value={recording?.name ?? ""}
        disabled={!recording}
        onChange={(e) => onRename(e.target.value)}
        placeholder={recording ? "" : "(no recording)"}
        className="bg-transparent border-b border-white/10 focus:border-accent/50 focus:outline-none text-sm text-gray-200 px-1 py-0.5 w-48 disabled:opacity-50"
      />
      <span>·</span>
      <span>
        {recording ? formatTime(recording.durationMs) : "–"}
      </span>
      <span>·</span>
      <span>
        {recording ? `${recording.events.length.toLocaleString()} events` : "–"}
      </span>
      <span>·</span>
      <span>
        {recorderState === "recording"
          ? "recording…"
          : hasUnsaved
          ? <span className="text-orange-400">● unsaved</span>
          : recording
          ? "saved"
          : "idle"}
      </span>
    </div>
  );
}
