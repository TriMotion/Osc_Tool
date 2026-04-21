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
import { SongsStrip } from "@/components/timeline/songs-strip";
import { RecordingInfoPanel } from "@/components/timeline/recording-info";
import { BadgeEditorModal } from "@/components/timeline/badge-editor-modal";
import { buildLaneMap, pairNoteSpans } from "@/lib/timeline-util";
import { migrateOscMappings } from "@/lib/osc-mapping-migration";
import type { LaneBadge, LaneKey, LaneMap, Moment, NoteGroupTag, NoteSpan, Recording, OscMapping, SavedEndpoint } from "@/lib/types";
import { laneKeyString } from "@/lib/types";

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

  const [activityLaneKeys, setActivityLaneKeys] = useState<Set<string>>(new Set());
  const activityPendingRef = useRef<Set<string>>(new Set());
  const activityRafRef = useRef<number | null>(null);
  const activityClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleActivity = useCallback((keys: string[]) => {
    for (const k of keys) activityPendingRef.current.add(k);
    if (activityRafRef.current !== null) return;
    activityRafRef.current = requestAnimationFrame(() => {
      activityRafRef.current = null;
      const pending = activityPendingRef.current;
      if (pending.size === 0) return;
      setActivityLaneKeys((prev) => {
        const next = new Set(prev);
        for (const k of pending) next.add(k);
        return next;
      });
      pending.clear();
      if (activityClearRef.current) clearTimeout(activityClearRef.current);
      activityClearRef.current = setTimeout(() => setActivityLaneKeys(new Set()), 300);
    });
  }, []);

  useOscPlayback({
    recording: recorder.recording ?? null,
    playheadMsRef: audio.playheadMsRef,
    isPlaying: audio.isPlaying,
    endpoints,
    deviceAliases: recorder.recording?.deviceAliases,
    onActivity: handleActivity,
  });

  const [confirmDiscard, setConfirmDiscard] = useState<null | (() => void)>(null);
  const [pendingMidiMerge, setPendingMidiMerge] = useState<Recording | null>(null);
  const [saveSuggestedPath, setSaveSuggestedPath] = useState<string | null>(null);
  const [canvasWidthPx, setCanvasWidthPx] = useState(800);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [triggersSidebarOpen, setTriggersSidebarOpen] = useState(false);
  const [badgeEditor, setBadgeEditor] = useState<{ laneKey: string; badge: LaneBadge | null } | null>(null);
  const lastHoveredLaneRef = useRef<string | null>(null);

  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const focusedSection = useMemo(
    () => recorder.recording?.sections?.find((s) => s.id === focusedSectionId) ?? null,
    [recorder.recording?.sections, focusedSectionId],
  );

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
        setFocusedSectionId(null);
        recorder.start();
        setConfirmDiscard(null);
      });
      return;
    }
    setFocusedSectionId(null);
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

  /** Persist current audio.tracks to recording, keeping unloaded (missing) tracks intact. */
  const syncAudioTracksToRecording = useCallback(() => {
    const loadedById = new Map(audio.tracks.map((t) => [t.id, t]));
    recorder.patchRecording({
      audioTracks: (recorder.recording?.audioTracks ?? []).map((t) => {
        const loaded = loadedById.get(t.id);
        return loaded
          ? { id: loaded.id, filePath: loaded.filePath, offsetMs: loaded.offsetMs }
          : t;
      }),
    });
  }, [audio.tracks, recorder]);

  const applyLoadedRecording = useCallback(
    async (rec: Recording, loadedFromPath: string | null) => {
      const migrated = migrateOscMappings(rec);
      // Strip any system-generated moments that were accidentally persisted in older saves
      if (migrated.moments?.some((m) => m.kind !== "user")) {
        migrated.moments = migrated.moments!.filter((m) => m.kind === "user");
      }
      recorder.setLoaded(migrated);
      setFocusedSectionId(null);
      setSaveSuggestedPath(loadedFromPath);
      audio.unloadAll();

      // Support both old single-audio and new multi-track recordings.
      const tracksToLoad: Array<{ id: string; filePath: string; offsetMs: number }> = [];
      if (migrated.audioTracks?.length) {
        tracksToLoad.push(...migrated.audioTracks);
      } else if (migrated.audio) {
        tracksToLoad.push({ id: crypto.randomUUID(), ...migrated.audio });
      }

      for (const t of tracksToLoad) {
        const bytes = await io.readAudioBytes(t.filePath);
        if (bytes) {
          await audio.loadTrack(t.id, t.filePath, bytes.bytes, bytes.mimeType, t.offsetMs);
        }
        // Missing tracks stay in recording.audioTracks but aren't loaded into
        // the player — the UI will surface a relink control for them.
      }
    },
    [io, recorder, audio],
  );

  const handleLoad = useCallback(async () => {
    if (recorder.state === "recording") {
      alert("Stop the current recording before loading another file.");
      return;
    }
    const applyLoad = async () => {
      const res = await io.load();
      if (!res) return;
      await applyLoadedRecording(res.recording, res.path);
    };
    if (recorder.hasUnsaved && recorder.recording) {
      setConfirmDiscard(() => () => {
        applyLoad();
        setConfirmDiscard(null);
      });
      return;
    }
    applyLoad();
  }, [io, recorder, applyLoadedRecording]);

  const handleSaveProject = useCallback(async () => {
    if (!recorder.recording) return;
    const savedPath = await io.saveProject(recorder.recording);
    if (!savedPath) return;
    setSaveSuggestedPath(savedPath);
    // Re-apply: saveProject rewrites audio paths to project-relative, so reload
    // from disk to pick up the new paths (and resolved absolute versions).
    const res = await io.loadProject();
    if (res) await applyLoadedRecording(res.recording, res.path);
    setProjectFound(true);
  }, [io, recorder.recording, applyLoadedRecording]);

  const handleRelinkAudio = useCallback(
    async (trackId: string) => {
      const newPath = await io.pickAudio();
      if (!newPath) return;
      const bytes = await io.readAudioBytes(newPath);
      if (!bytes) return;
      const existing = recorder.recording?.audioTracks?.find((t) => t.id === trackId);
      const offsetMs = existing?.offsetMs ?? 0;
      await audio.loadTrack(trackId, newPath, bytes.bytes, bytes.mimeType, offsetMs);
      recorder.patchRecording({
        audioTracks: (recorder.recording?.audioTracks ?? []).map((t) =>
          t.id === trackId ? { ...t, filePath: newPath } : t,
        ),
      });
    },
    [io, audio, recorder],
  );

  // Project folder state — surfaces current path + "not found" banner.
  const [projectDirInfo, setProjectDirInfo] = useState<{ path: string; isDefault: boolean } | null>(null);
  const [projectFound, setProjectFound] = useState<boolean>(true);

  const refreshProjectDirInfo = useCallback(async () => {
    const info = await io.getProjectDir();
    if (info) setProjectDirInfo(info);
  }, [io]);

  const tryLoadProject = useCallback(async () => {
    const project = await io.loadProject();
    if (project) {
      await applyLoadedRecording(project.recording, project.path);
      setProjectFound(true);
      return true;
    }
    setProjectFound(false);
    return false;
  }, [io, applyLoadedRecording]);

  const handlePickProjectDir = useCallback(async () => {
    const picked = await io.pickProjectDir();
    if (!picked) return;
    await refreshProjectDirInfo();
    await tryLoadProject();
  }, [io, refreshProjectDirInfo, tryLoadProject]);

  // Auto-load on mount: prefer the user-configured project folder; if its
  // recording isn't present, keep the folder setting but fall back to recents.
  // Skips if a recording is already loaded.
  const autoLoadAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoLoadAttemptedRef.current) return;
    if (recorder.recording || recorder.state === "recording") return;
    autoLoadAttemptedRef.current = true;

    (async () => {
      await refreshProjectDirInfo();
      const loaded = await tryLoadProject();
      if (loaded) return;
      const recent = io.recent[0];
      if (!recent) return;
      const res = await io.loadPath(recent.path);
      if (!res || "error" in res) return;
      await applyLoadedRecording(res.recording, res.path);
    })();
  }, [io, recorder.recording, recorder.state, applyLoadedRecording, refreshProjectDirInfo, tryLoadProject]);

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

  const handlePlay = useCallback(() => {
    if (focusedSection) {
      const head = audio.playheadMsRef.current;
      if (head < focusedSection.startMs || head >= focusedSection.endMs) {
        handleSeek(focusedSection.startMs);
      }
    }
    audio.play();
  }, [focusedSection, audio, handleSeek]);

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
      else handlePlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audio, recorder.state, recorder.recording, handlePlay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const sections = recorder.recording?.sections ?? [];
      if (!sections.length) return;
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const idx = sections.findIndex((s) => s.id === focusedSectionId);
        const next = e.key === "]"
          ? sections[Math.min(sections.length - 1, (idx < 0 ? 0 : idx + 1))]
          : sections[Math.max(0, (idx < 0 ? 0 : idx - 1))];
        setFocusedSectionId(next?.id ?? null);
      } else if (e.key === "Escape" && focusedSectionId) {
        e.preventDefault();
        setFocusedSectionId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recorder.recording?.sections, focusedSectionId]);

  const handleSectionsChange = useCallback((sections: Recording["sections"]) => {
    recorder.patchRecording({ sections });
    if (focusedSectionId && !sections?.some((s) => s.id === focusedSectionId)) {
      setFocusedSectionId(null);
    }
  }, [recorder, focusedSectionId]);

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

  // Opens the OSC mapping editor for a CC/pitch/aftertouch lane chip click.
  // DeviceSection handles editor rendering via its own local oscEditor state;
  // this handler exists as a page-level hook point for future prefill or
  // cross-component coordination (e.g. pre-selecting the focused section).
  const handleOpenLaneMapping = useCallback((_laneKey: LaneKey) => {
    // DeviceSection opens OscMappingEditor via setOscEditor internally.
    // The focusedSectionId is passed down as a prop so DeviceSection can scope
    // the mapping lookup — no additional action needed here currently.
    void laneKeyString(_laneKey); // silence unused-import lint
  }, []);

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold">Timeline</h2>

        {projectDirInfo && (
          <ProjectFolderDropdown
            info={projectDirInfo}
            found={projectFound}
            onPick={handlePickProjectDir}
          />
        )}

        <button
          onClick={handleToggleBridge}
          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
            bridgeRunning
              ? "bg-red-500/10 text-red-300 border-red-500/30 hover:bg-red-500/20"
              : "bg-white/5 text-gray-400 border-white/10 hover:text-white"
          }`}
          title={bridgeRunning ? `${midiDevices.length} device${midiDevices.length === 1 ? "" : "s"}` : "Bridge stopped"}
        >
          {bridgeRunning ? `● Bridge · ${midiDevices.length}` : "○ Bridge off"}
        </button>

        <div className="flex-1" />

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
        onPlay={handlePlay}
        onPause={audio.pause}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onSaveProject={handleSaveProject}
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

      {(() => {
        const loadedIds = new Set(audio.tracks.map((t) => t.id));
        const missing = (recorder.recording?.audioTracks ?? []).filter((t) => !loadedIds.has(t.id));
        if (missing.length === 0) return null;
        return (
          <div className="flex flex-col gap-1 text-xs bg-amber-500/10 border border-amber-400/30 rounded px-3 py-2">
            <span className="text-amber-300 font-medium">
              Audio missing ({missing.length}) — file{missing.length === 1 ? "" : "s"} referenced by this recording couldn't be found
            </span>
            {missing.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span className="text-amber-200/70 font-mono truncate flex-1" title={t.filePath}>
                  {t.filePath}
                </span>
                <button
                  onClick={() => handleRelinkAudio(t.id)}
                  className="shrink-0 px-2 py-0.5 rounded border border-amber-400/40 text-amber-200 hover:bg-amber-400/20 transition-colors"
                >
                  🔗 Relink…
                </button>
              </div>
            ))}
          </div>
        );
      })()}

      <SongsStrip
        sections={recorder.recording?.sections ?? []}
        focusedSectionId={focusedSectionId}
        onFocus={setFocusedSectionId}
        onChange={handleSectionsChange}
        durationMs={durationMs}
        playheadMsRef={audio.playheadMsRef}
      />

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
          focusedSection={focusedSection}
          focusedSectionId={focusedSectionId}
          onOpenLaneMapping={handleOpenLaneMapping}
          activityLaneKeys={activityLaneKeys}
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

function ProjectFolderDropdown({
  info,
  found,
  onPick,
}: {
  info: { path: string; isDefault: boolean };
  found: boolean;
  onPick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const folderName = info.path.split(/[\\/]/).pop() || info.path;
  const toneClass = found ? "text-gray-400 hover:text-white" : "text-amber-300 hover:text-amber-200";

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded border border-white/10 text-[11px] ${toneClass} hover:border-white/20 transition-colors`}
        title={info.path}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span className="font-mono truncate max-w-[160px]">{folderName}</span>
        {!found && <span className="text-amber-300">•</span>}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 w-[360px] max-w-[90vw] bg-surface border border-white/10 rounded-md shadow-xl p-3 flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Project folder</div>
          <div className={`font-mono text-[11px] break-all ${found ? "text-gray-300" : "text-amber-300"}`}>
            {info.path}
            {info.isDefault && <span className="ml-1 text-gray-600">(default)</span>}
          </div>
          {!found && (
            <div className="text-[11px] text-amber-300/90">
              No .oscrec file found here. Pick another folder or Save project to create one.
            </div>
          )}
          <button
            onClick={() => { setOpen(false); onPick(); }}
            className="self-start px-2 py-1 rounded border border-white/10 text-[11px] text-gray-300 hover:text-white hover:border-accent/40 transition-colors"
          >
            Change folder…
          </button>
        </div>
      )}
    </div>
  );
}
