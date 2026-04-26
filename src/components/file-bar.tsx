"use client";

import { useRecorderContext } from "@/contexts/recorder-context";
import { FolderOpen, Save } from "lucide-react";

export function FileBar() {
  const recorder = useRecorderContext();
  const recName = recorder.recording?.name;

  return (
    <div
      className="h-10 shrink-0 flex items-center gap-3 px-4 border-b border-white/[0.04] bg-black"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {recName ? (
        <>
          <span className="text-[11px] text-gray-600">Current file:</span>
          <span className="text-[11px] text-gray-300 font-medium truncate">{recName}</span>
          {recorder.hasUnsaved && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              <button
                onClick={() => recorder.save()}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-white transition-colors px-2 py-1 rounded border border-white/[0.06] hover:border-white/15"
              >
                <Save size={11} strokeWidth={1.5} />
                Save
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <span className="text-[11px] text-gray-600">No file loaded</span>
          <button
            onClick={() => recorder.loadFile()}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-white transition-colors px-2 py-1 rounded border border-white/[0.06] hover:border-white/15"
          >
            <FolderOpen size={11} strokeWidth={1.5} />
            Open
          </button>
        </>
      )}
    </div>
  );
}
