"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecordingIO } from "@/hooks/use-recording-io";
import { useAudioSync } from "@/hooks/use-audio-sync";
import { useMidiConfig, useMidiControl } from "@/hooks/use-midi";
import { useTriggerAnalysis } from "@/hooks/use-trigger-analysis";
import { useRecorderContext } from "@/contexts/recorder-context";
import { useOscPlayback } from "@/hooks/use-osc-playback";
import { TimelineToolbar } from "@/components/timeline/timeline-toolbar";
import { TimelineCanvas } from "@/components/timeline/timeline-canvas";
import { RecordingInfoPanel } from "@/components/timeline/recording-info";
import { BadgeEditorModal } from "@/components/timeline/badge-editor-modal";
import { buildLaneMap, pairNoteSpans } from "@/lib/timeline-util";
import type { LaneBadge, LaneMap, Moment, NoteGroupTag, NoteSpan, Recording, OscMapping, SavedEndpoint } from "@/lib/types";

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
  const recorder = useRecorderContext();
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

  const [endpoints, setEndpoints] = useState<SavedEndpoint[]>([]);

  useEffect(() => {
    window.electronAPI?.invoke("endpoints:get-all", "sender").then((res) => {
      setEndpoints((res as SavedEndpoint[]) ?? []);
    });
  }, []);

  useOscPlayback({
    recording: recorder.recording ?? null,
    playheadMs: playheadDisplayMs,
    isPlaying: audio.isPlaying,
    endpoints,
    deviceAliases: recorder.recording?.deviceAliases,
  });

  const [confirmDiscard, setConfirmDiscard] = useState<null | (() => void)>(null);
  const [pendingMidiMerge, setPendingMidiMerge] = useState<Recording | null>(null);
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

  // Build render props for each audio track (peaks cached per track).
  const audioTrackRenderProps = useMemo(
    () =>
      audio.tracks.map((t) => ({
        id: t.id,
        peaks: audio.getTrackPeaks(t.id, 8192),
        offsetMs: t.offsetMs,
        durationMs: t.durationMs,
        label: t.filePath.split("/").pop() ?? "audio",
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audio.tracks, audio.getTrackPeaks]
  );

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

  /** Persist current audio.tracks to recording. */
  const syncAudioTracksToRecording = useCallback(() => {
    recorder.patchRecording({
      audioTracks: audio.tracks.map((t) => ({
        id: t.id,
        filePath: t.filePath,
        offsetMs: t.offsetMs,
      })),
    });
  }, [audio.tracks, recorder]);

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
      audio.unloadAll();

      // Support both old single-audio and new multi-track recordings.
      const tracksToLoad: Array<{ id: string; filePath: string; offsetMs: number }> = [];
      if (res.recording.audioTracks?.length) {
        tracksToLoad.push(...res.recording.audioTracks);
      } else if (res.recording.audio) {
        tracksToLoad.push({ id: crypto.randomUUID(), ...res.recording.audio });
      }

      const missing: string[] = [];
      for (const t of tracksToLoad) {
        const bytes = await io.readAudioBytes(t.filePath);
        if (bytes) {
          await audio.loadTrack(t.id, t.filePath, bytes.bytes, bytes.mimeType, t.offsetMs);
        } else {
          missing.push(t.filePath);
        }
      }
      if (missing.length) {
        alert(`Audio file(s) not found:\n${missing.join("\n")}\n\nYou can attach them again after loading.`);
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
    if (recorder.state === "recording") {
      alert("Stop the current recording before importing a MIDI file.");
      return;
    }
    const res = await io.importMidi();
    if (!res) return;

    if (recorder.recording) {
      setPendingMidiMerge(res.recording);
    } else {
      recorder.setLoaded(res.recording);
      setSaveSuggestedPath(null);
      audio.unloadAll();
    }
  }, [io, recorder, audio]);

  const handleLoadAudio = useCallback(async () => {
    const path = await io.pickAudio();
    if (!path) return;
    const bytes = await io.readAudioBytes(path);
    if (!bytes) return;
    const id = crypto.randomUUID();
    await audio.loadTrack(id, path, bytes.bytes, bytes.mimeType, 0);
    recorder.patchRecording({
      audioTracks: [
        ...(recorder.recording?.audioTracks ?? []),
        { id, filePath: path, offsetMs: 0 },
      ],
    });
  }, [io, audio, recorder]);

  const handleUnloadAudio = useCallback((id: string) => {
    audio.unloadTrack(id);
    recorder.patchRecording({
      audioTracks: (recorder.recording?.audioTracks ?? []).filter((t) => t.id !== id),
    });
  }, [audio, recorder]);

  const handleAudioOffsetChange = useCallback(
    (id: string, ms: number) => {
      audio.setTrackOffset(id, ms);
      recorder.patchRecording({
        audioTracks: (recorder.recording?.audioTracks ?? []).map((t) =>
          t.id !== id ? t : { ...t, offsetMs: ms }
        ),
      });
    },
    [audio, recorder]
  );

  const handleAudioOffsetDelta = useCallback(
    (id: string, deltaPx: number, modifier: "none" | "shift" | "alt") => {
      const span = Math.max(1000, durationMs);
      let msDelta = (deltaPx / canvasWidthPx) * span;
      if (modifier === "shift") msDelta = Math.round(msDelta / 10) * 10;
      if (modifier === "alt") msDelta = Math.round(msDelta / 100) * 100;
      const track = audio.tracks.find((t) => t.id === id);
      if (!track) return;
      handleAudioOffsetChange(id, track.offsetMs + msDelta);
    },
    [canvasWidthPx, durationMs, audio.tracks, handleAudioOffsetChange]
  );

  const handleSeek = useCallback((ms: number) => {
    audio.seek(ms);
    setPlayheadDisplayMs(ms);
  }, [audio]);

  // Keep recording.audioTracks in sync whenever track state changes.
  useEffect(() => {
    if (!recorder.recording || audio.tracks.length === 0) return;
    syncAudioTracksToRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.tracks]);

  const handleRename = useCallback(
    (name: string) => {
      if (recorder.recording) recorder.patchRecording({ name });
    },
    [recorder]
  );

  const existingBadges = recorder.recording?.badges ?? [];

  const noteTags = recorder.recording?.noteTags ?? [];

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

  const saveNoteTag = useCallback((tag: NoteGroupTag) => {
    const rec = recorder.recording;
    if (!rec) return;
    const filtered = (rec.noteTags ?? []).filter((t) => t.id !== tag.id);
    recorder.patchRecording({ noteTags: [...filtered, tag] });
  }, [recorder]);

  const deleteNoteTag = useCallback((id: string) => {
    const rec = recorder.recording;
    if (!rec) return;
    recorder.patchRecording({ noteTags: (rec.noteTags ?? []).filter((t) => t.id !== id) });
  }, [recorder]);

  const addOscMapping = useCallback((mapping: OscMapping) => {
    const rec = recorder.recording;
    if (!rec) return;
    recorder.patchRecording({ oscMappings: [...(rec.oscMappings ?? []), mapping] });
  }, [recorder]);

  const updateOscMapping = useCallback((mapping: OscMapping) => {
    const rec = recorder.recording;
    if (!rec) return;
    recorder.patchRecording({ oscMappings: (rec.oscMappings ?? []).map((m) => m.id === mapping.id ? mapping : m) });
  }, [recorder]);

  const deleteOscMapping = useCallback((id: string) => {
    const rec = recorder.recording;
    if (!rec) return;
    recorder.patchRecording({ oscMappings: (rec.oscMappings ?? []).filter((m) => m.id !== id) });
  }, [recorder]);

  const saveDeviceAlias = useCallback((originalName: string, newName: string) => {
    const rec = recorder.recording;
    if (!rec) return;
    const trimmed = newName.trim();
    const currentAlias = rec.deviceAliases?.[originalName];
    if (trimmed && trimmed !== originalName) {
      if (trimmed === currentAlias) return;
      recorder.patchRecording({ deviceAliases: { ...(rec.deviceAliases ?? {}), [originalName]: trimmed } });
    } else {
      if (currentAlias === undefined) return;
      const aliases = { ...(rec.deviceAliases ?? {}) };
      delete aliases[originalName];
      recorder.patchRecording({ deviceAliases: aliases });
    }
  }, [recorder]);

  const saveHiddenLanes = useCallback((lanes: string[]) => {
    recorder.patchRecording({ hiddenLanes: lanes });
  }, [recorder]);

  const saveHiddenNoteGroups = useCallback((groups: string[]) => {
    recorder.patchRecording({ hiddenNoteGroups: groups });
  }, [recorder]);

  const handleSuppressAnalysis = useCallback((laneKey: string, type: "rhythm" | "dynamic" | "melody") => {
    const rec = recorder.recording;
    if (!rec) return;
    const entry = `${laneKey}:${type}`;
    const current = rec.suppressedAnalysis ?? [];
    if (!current.includes(entry)) recorder.patchRecording({ suppressedAnalysis: [...current, entry] });
  }, [recorder]);

  const handleRequestAddBadge = useCallback((laneKey: string) => {
    lastHoveredLaneRef.current = laneKey;
    setBadgeEditor({ laneKey, badge: null });
  }, []);

  const handleEditBadge = useCallback((badge: LaneBadge) => {
    setBadgeEditor({ laneKey: badge.laneKey, badge });
  }, []);

  const handleDeleteDevice = useCallback((deviceName: string) => {
    recorder.deleteDevice(deviceName);
  }, [recorder]);

  // Spacebar: play/pause when not recording and not focused on an input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (recorder.state === "recording") return;
      if (!recorder.recording && audio.tracks.length === 0) return;
      if (audio.isPlaying) audio.pause();
      else audio.play();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audio, recorder.state, recorder.recording]);

  const handleSectionsChange = useCallback((sections: Recording["sections"]) => {
    recorder.patchRecording({ sections });
  }, [recorder]);

  const handleMarkersChange = useCallback((moments: Moment[]) => {
    recorder.patchRecording({ moments });
  }, [recorder]);


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
        onRecord={startRecording}
        onStop={stopRecording}
        onPlay={audio.play}
        onPause={audio.pause}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onLoad={handleLoad}
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
          audioTracks={audioTrackRenderProps}
          onLoadAudio={handleLoadAudio}
          onUnloadAudio={handleUnloadAudio}
          onAudioOffsetChange={handleAudioOffsetChange}
          onAudioOffsetDelta={handleAudioOffsetDelta}
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
          onDeleteBadge={deleteBadge}
          suppressedAnalysis={recorder.recording?.suppressedAnalysis ?? []}
          onSuppressAnalysis={handleSuppressAnalysis}
          onTagCurrentLane={handleTagCurrentLane}
          onDeleteDevice={handleDeleteDevice}
          sections={recorder.recording?.sections ?? []}
          onSectionsChange={handleSectionsChange}
          userMarkers={recorder.recording?.moments ?? []}
          onMarkersChange={handleMarkersChange}
          noteTags={noteTags}
          onSaveNoteTag={saveNoteTag}
          onDeleteNoteTag={deleteNoteTag}
          oscMappings={recorder.recording?.oscMappings ?? []}
          endpoints={endpoints}
          onAddOscMapping={addOscMapping}
          onUpdateOscMapping={updateOscMapping}
          onDeleteOscMapping={deleteOscMapping}
          onHiddenLanesChange={saveHiddenLanes}
          onHiddenNoteGroupsChange={saveHiddenNoteGroups}
          deviceAliases={recorder.recording?.deviceAliases}
          onRenameDevice={saveDeviceAlias}
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

      {pendingMidiMerge && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-light border border-white/10 rounded-lg p-5 max-w-sm">
            <h3 className="text-sm font-semibold mb-2">Add to timeline?</h3>
            <p className="text-xs text-gray-500 mb-4">
              A recording is already loaded. You can merge the new MIDI file into the current
              timeline, or replace it entirely.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingMidiMerge(null)}
                className="px-3 py-1.5 text-xs border border-white/10 text-gray-300 hover:text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  recorder.setLoaded(pendingMidiMerge);
                  setSaveSuggestedPath(null);
                  audio.unloadAll();
                  setPendingMidiMerge(null);
                }}
                className="px-3 py-1.5 text-xs bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 rounded"
              >
                Replace
              </button>
              <button
                onClick={() => {
                  recorder.mergeRecording(pendingMidiMerge);
                  setSaveSuggestedPath(null);
                  setPendingMidiMerge(null);
                }}
                className="px-3 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 rounded"
              >
                Merge into timeline
              </button>
            </div>
          </div>
        </div>
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
