"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecorder } from "@/hooks/use-recorder";
import { useRecordingIO } from "@/hooks/use-recording-io";
import { useAudioSync } from "@/hooks/use-audio-sync";
import { useMidiConfig, useMidiControl } from "@/hooks/use-midi";
import { useTriggerAnalysis } from "@/hooks/use-trigger-analysis";
import { TimelineToolbar } from "@/components/timeline/timeline-toolbar";
import { TimelineCanvas } from "@/components/timeline/timeline-canvas";
import { RecordingInfoPanel } from "@/components/timeline/recording-info";
import { BadgeEditorModal } from "@/components/timeline/badge-editor-modal";
import { buildLaneMap, pairNoteSpans } from "@/lib/timeline-util";
import type { LaneBadge, LaneMap, MidiMappingRule, NoteSpan } from "@/lib/types";

const LEFT_GUTTER = 140;

export default function TimelinePage() {
  const { running: bridgeRunning, devices: midiDevices, start: startBridge, stop: stopBridge, refreshDevices } = useMidiControl();
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  const handleToggleBridge = useCallback(async () => {
    setBridgeError(null);
    try {
      if (bridgeRunning) {
        await stopBridge();
      } else {
        await refreshDevices();
        await startBridge();
      }
    } catch (err) {
      setBridgeError(String(err));
    }
  }, [bridgeRunning, startBridge, stopBridge, refreshDevices]);
  const { rules } = useMidiConfig();
  const rulesRef = useRef<MidiMappingRule[]>(rules);
  rulesRef.current = rules;

  const recorder = useRecorder({
    getMappingRulesSnapshot: () => rulesRef.current,
  });

  const io = useRecordingIO();

  const durationMs = recorder.recording?.durationMs ?? (recorder.state === "recording"
    ? Math.max(
        ...(recorder.bufferRef.current.length > 0
          ? [recorder.bufferRef.current[recorder.bufferRef.current.length - 1].tRel + 500]
          : [1000])
      )
    : 1000);

  const [playheadDisplayMs, setPlayheadDisplayMs] = useState(0);

  const audio = useAudioSync({
    durationMs,
    onPlayheadChange: setPlayheadDisplayMs,
  });

  const [confirmDiscard, setConfirmDiscard] = useState<null | (() => void)>(null);
  const [saveSuggestedPath, setSaveSuggestedPath] = useState<string | null>(null);
  const [canvasWidthPx, setCanvasWidthPx] = useState(800);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [triggersSidebarOpen, setTriggersSidebarOpen] = useState(false);
  const [badgeEditor, setBadgeEditor] = useState<{ laneKey: string; badge: LaneBadge | null } | null>(null);
  const lastHoveredLaneRef = useRef<string | null>(null);

  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 800;
      setCanvasWidthPx(Math.max(300, Math.floor(w) - LEFT_GUTTER));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const onMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-lane-key]");
      if (target) lastHoveredLaneRef.current = target.dataset.laneKey ?? null;
    };
    wrap.addEventListener("mousemove", onMove);
    return () => wrap.removeEventListener("mousemove", onMove);
  }, []);

  const laneMap: LaneMap = useMemo(
    () => buildLaneMap(recorder.bufferRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recorder.bufferVersion, recorder.recording?.id]
  );

  const noteSpans: NoteSpan[] = useMemo(
    () => {
      const fallback = recorder.recording?.durationMs ?? (
        recorder.bufferRef.current.length > 0
          ? recorder.bufferRef.current[recorder.bufferRef.current.length - 1].tRel
          : 0
      );
      return pairNoteSpans(recorder.bufferRef.current, fallback);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recorder.bufferVersion, recorder.recording?.id]
  );

  const analysis = useTriggerAnalysis({
    recording: recorder.recording,
    bufferVersion: recorder.bufferVersion,
    laneMap,
    noteSpans,
  });

  const audioPeaks = audio.getPeaks(canvasWidthPx);

  const startRecording = useCallback(() => {
    if (!bridgeRunning) {
      alert("Start the MIDI bridge first (MIDI tab).");
      return;
    }
    if (recorder.hasUnsaved && recorder.recording) {
      setConfirmDiscard(() => () => {
        recorder.start();
        setConfirmDiscard(null);
      });
      return;
    }
    recorder.start();
  }, [bridgeRunning, recorder]);

  const stopRecording = useCallback(() => {
    recorder.stop();
  }, [recorder]);

  const handleSave = useCallback(async () => {
    if (!recorder.recording) return;
    const savedPath = await io.save(recorder.recording, saveSuggestedPath ?? undefined);
    if (savedPath) {
      setSaveSuggestedPath(savedPath);
      recorder.markSaved();
    }
  }, [io, recorder, saveSuggestedPath]);

  const handleSaveAs = useCallback(async () => {
    if (!recorder.recording) return;
    const savedPath = await io.saveAs(recorder.recording);
    if (savedPath) {
      setSaveSuggestedPath(savedPath);
      recorder.markSaved();
    }
  }, [io, recorder]);

  const handleLoad = useCallback(async () => {
    if (recorder.state === "recording") {
      alert("Stop the current recording before loading another file.");
      return;
    }
    const applyLoad = async () => {
      const res = await io.load();
      if (!res) return;
      recorder.setLoaded(res.recording);
      setSaveSuggestedPath(res.path);
      audio.unloadAudio();

      if (res.recording.audio) {
        const bytes = await io.readAudioBytes(res.recording.audio.filePath);
        if (bytes) {
          await audio.loadBytes(res.recording.audio.filePath, bytes.bytes, bytes.mimeType, res.recording.audio.offsetMs);
        } else {
          alert(`Audio file not found at:\n${res.recording.audio.filePath}\n\nYou can attach a new audio file after loading.`);
        }
      }
    };
    if (recorder.hasUnsaved && recorder.recording) {
      setConfirmDiscard(() => () => {
        applyLoad();
        setConfirmDiscard(null);
      });
      return;
    }
    applyLoad();
  }, [io, recorder, audio]);

  const handleImportMidi = useCallback(async () => {
    const applyImport = async () => {
      const res = await io.importMidi();
      if (!res) return;
      recorder.setLoaded(res.recording);
      setSaveSuggestedPath(null); // force Save As on first save (no existing .oscrec path)
      audio.unloadAudio();
    };
    if (recorder.state === "recording") {
      alert("Stop the current recording before importing a MIDI file.");
      return;
    }
    if (recorder.hasUnsaved && recorder.recording) {
      setConfirmDiscard(() => () => {
        applyImport();
        setConfirmDiscard(null);
      });
      return;
    }
    applyImport();
  }, [io, recorder, audio]);

  const handleLoadAudio = useCallback(async () => {
    const path = await io.pickAudio();
    if (!path) return;
    const bytes = await io.readAudioBytes(path);
    if (!bytes) return;
    await audio.loadBytes(path, bytes.bytes, bytes.mimeType, audio.audio.offsetMs);
    if (recorder.recording) {
      recorder.patchRecording({ audio: { filePath: path, offsetMs: audio.audio.offsetMs } });
    }
  }, [io, audio, recorder]);

  const handleUnloadAudio = useCallback(() => {
    audio.unloadAudio();
    if (recorder.recording) recorder.patchRecording({ audio: undefined });
  }, [audio, recorder]);

  const handleOffsetChange = useCallback(
    (ms: number) => {
      audio.setOffset(ms);
      if (recorder.recording?.audio) {
        recorder.patchRecording({
          audio: { filePath: recorder.recording.audio.filePath, offsetMs: ms },
        });
      }
    },
    [audio, recorder]
  );

  const handleOffsetDragDelta = useCallback(
    (deltaPx: number, modifier: "none" | "shift" | "alt") => {
      const canvas = canvasWidthPx;
      const span = Math.max(1000, durationMs);
      let msDelta = (deltaPx / canvas) * span;
      if (modifier === "shift") msDelta = Math.round(msDelta / 10) * 10;
      if (modifier === "alt") msDelta = Math.round(msDelta / 100) * 100;
      handleOffsetChange(audio.audio.offsetMs + msDelta);
    },
    [canvasWidthPx, durationMs, audio.audio.offsetMs, handleOffsetChange]
  );

  const handleSeek = useCallback((ms: number) => {
    audio.seek(ms);
    setPlayheadDisplayMs(ms);
  }, [audio]);

  const handleRename = useCallback(
    (name: string) => {
      if (recorder.recording) recorder.patchRecording({ name });
    },
    [recorder]
  );

  const existingBadges = recorder.recording?.badges ?? [];

  const saveBadge = useCallback((next: LaneBadge) => {
    const rec = recorder.recording;
    if (!rec) return;
    const filtered = (rec.badges ?? []).filter((b) => b.id !== next.id);
    const deduped = filtered.filter((b) => !(b.laneKey === next.laneKey && b.label === next.label));
    recorder.patchRecording({ badges: [...deduped, next] });
    setBadgeEditor(null);
  }, [recorder]);

  const deleteBadge = useCallback((id: string) => {
    const rec = recorder.recording;
    if (!rec) return;
    recorder.patchRecording({ badges: (rec.badges ?? []).filter((b) => b.id !== id) });
    setBadgeEditor(null);
  }, [recorder]);

  const handleRequestAddBadge = useCallback((laneKey: string) => {
    lastHoveredLaneRef.current = laneKey;
    setBadgeEditor({ laneKey, badge: null });
  }, []);

  const handleEditBadge = useCallback((badge: LaneBadge) => {
    setBadgeEditor({ laneKey: badge.laneKey, badge });
  }, []);

  const handleTagCurrentLane = useCallback(() => {
    const key = lastHoveredLaneRef.current;
    if (!key) {
      alert("Hover a lane first to choose which one to tag.");
      return;
    }
    setBadgeEditor({ laneKey: key, badge: null });
  }, []);

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-xl font-semibold">Timeline</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {bridgeRunning
                ? `Bridge running · ${midiDevices.length} device${midiDevices.length === 1 ? "" : "s"} detected`
                : "Bridge stopped"}
            </p>
          </div>
          <button
            onClick={handleToggleBridge}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              bridgeRunning
                ? "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
                : "bg-accent/10 text-accent border-accent/30 hover:bg-accent/20"
            }`}
          >
            {bridgeRunning ? "Stop bridge" : "Start bridge"}
          </button>
        </div>
        <RecordingInfoPanel
          recording={recorder.recording}
          recorderState={recorder.state}
          hasUnsaved={recorder.hasUnsaved}
          onRename={handleRename}
        />
      </div>

      {bridgeError && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-1.5">
          <span>{bridgeError}</span>
          <button onClick={() => setBridgeError(null)} className="ml-auto text-red-300 hover:text-white">✕</button>
        </div>
      )}

      <TimelineToolbar
        recorderState={recorder.state}
        hasRecording={!!recorder.recording || recorder.state === "recording"}
        isPlaying={audio.isPlaying}
        playheadMs={playheadDisplayMs}
        durationMs={durationMs}
        audioOffsetMs={audio.audio.offsetMs}
        audioLoaded={!!audio.audio.src}
        onRecord={startRecording}
        onStop={stopRecording}
        onPlay={audio.play}
        onPause={audio.pause}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onLoad={handleLoad}
        onLoadAudio={handleLoadAudio}
        onUnloadAudio={handleUnloadAudio}
        onOffsetChange={handleOffsetChange}
        onImportMidi={handleImportMidi}
        triggersSidebarOpen={triggersSidebarOpen}
        onToggleTriggersSidebar={() => setTriggersSidebarOpen((v) => !v)}
      />

      {io.lastError && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-1.5">
          <span>{io.lastError}</span>
          <button onClick={io.clearError} className="ml-auto text-red-300 hover:text-white">✕</button>
        </div>
      )}

      <div ref={canvasWrapRef} className="flex-1 min-h-0 flex flex-col">
        <TimelineCanvas
          recording={recorder.recording}
          events={recorder.bufferRef.current}
          bufferVersion={recorder.bufferVersion}
          isRecording={recorder.state === "recording"}
          laneMap={laneMap}
          noteSpans={noteSpans}
          mappingRules={rules}
          playheadMsRef={audio.playheadMsRef}
          onSeek={handleSeek}
          audioPeaks={audioPeaks}
          audioLabel={audio.audio.filePath?.split("/").pop()}
          onAudioOffsetDelta={handleOffsetDragDelta}
          analyses={analysis.analyses}
          redundantPairs={analysis.pairs}
          moments={analysis.moments}
          analysisReady={analysis.ready}
          analysisError={analysis.error}
          badges={existingBadges}
          triggersSidebarOpen={triggersSidebarOpen}
          onToggleTriggersSidebar={() => setTriggersSidebarOpen((v) => !v)}
          onRequestAddBadge={handleRequestAddBadge}
          onEditBadge={handleEditBadge}
          onTagCurrentLane={handleTagCurrentLane}
        />
      </div>

      {badgeEditor && (
        <BadgeEditorModal
          badge={badgeEditor.badge}
          laneKey={badgeEditor.laneKey}
          existingLabels={Array.from(new Set((recorder.recording?.badges ?? []).map((b) => b.label)))}
          onSave={saveBadge}
          onDelete={badgeEditor.badge ? () => deleteBadge(badgeEditor.badge!.id) : undefined}
          onClose={() => setBadgeEditor(null)}
        />
      )}

      {confirmDiscard && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-light border border-white/10 rounded-lg p-5 max-w-sm">
            <h3 className="text-sm font-semibold mb-2">Discard current take?</h3>
            <p className="text-xs text-gray-500 mb-4">You have unsaved MIDI captured in the current take. Continuing will replace it.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDiscard(null)}
                className="px-3 py-1.5 text-xs border border-white/10 text-gray-300 hover:text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDiscard()}
                className="px-3 py-1.5 text-xs bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 rounded"
              >
                Discard & continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
