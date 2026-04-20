"use client";

import { useCallback, useEffect, useState } from "react";
import type { Recording, RecentRecordingEntry } from "@/lib/types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useRecordingIO() {
  const [recent, setRecent] = useState<RecentRecordingEntry[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);

  const refreshRecent = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const res = (await api.invoke("recording:list-recent")) as { entries: RecentRecordingEntry[] };
    setRecent(res.entries);
  }, []);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  const save = useCallback(
    async (rec: Recording, suggestedPath?: string) => {
      setLastError(null);
      const api = getAPI();
      if (!api) return null;
      const res = (await api.invoke("recording:save", rec, suggestedPath)) as
        | { path: string }
        | { cancelled: true }
        | { error: string };
      if ("error" in res) { setLastError(res.error); return null; }
      if ("cancelled" in res) return null;
      setLastSavedPath(res.path);
      refreshRecent();
      return res.path;
    },
    [refreshRecent]
  );

  const saveAs = useCallback(
    async (rec: Recording) => {
      setLastError(null);
      const api = getAPI();
      if (!api) return null;
      const res = (await api.invoke("recording:save-as", rec)) as
        | { path: string }
        | { cancelled: true }
        | { error: string };
      if ("error" in res) { setLastError(res.error); return null; }
      if ("cancelled" in res) return null;
      setLastSavedPath(res.path);
      refreshRecent();
      return res.path;
    },
    [refreshRecent]
  );

  const load = useCallback(async () => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:load")) as
      | { recording: Recording; path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res) { setLastError(res.error); return null; }
    if ("cancelled" in res) return null;
    refreshRecent();
    return res;
  }, [refreshRecent]);

  const loadPath = useCallback(async (filePath: string) => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:load-path", filePath)) as
      | { recording: Recording; path: string }
      | { error: string };
    if ("error" in res) { setLastError(res.error); return null; }
    return res;
  }, []);

  const pickAudio = useCallback(async () => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:pick-audio")) as
      | { path: string }
      | { cancelled: true };
    if ("cancelled" in res) return null;
    return res.path;
  }, []);

  const readAudioBytes = useCallback(async (filePath: string) => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:read-audio-bytes", filePath)) as
      | { bytes: ArrayBuffer; mimeType: string }
      | { error: string };
    if ("error" in res) { setLastError(res.error); return null; }
    return res;
  }, []);

  const loadProject = useCallback(async () => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:load-project")) as
      | { recording: Recording; path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res) { setLastError(res.error); return null; }
    if ("cancelled" in res) return null;
    return res;
  }, []);

  const saveProject = useCallback(async (rec: Recording) => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:save-project", rec)) as
      | { path: string }
      | { error: string };
    if ("error" in res) { setLastError(res.error); return null; }
    setLastSavedPath(res.path);
    refreshRecent();
    return res.path;
  }, [refreshRecent]);

  const importMidi = useCallback(async () => {
    setLastError(null);
    const api = getAPI();
    if (!api) return null;
    const res = (await api.invoke("recording:import-midi")) as
      | { recording: Recording; path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res) { setLastError(res.error); return null; }
    if ("cancelled" in res) return null;
    return res;
  }, []);

  return {
    recent,
    lastError,
    lastSavedPath,
    refreshRecent,
    save,
    saveAs,
    load,
    loadPath,
    loadProject,
    saveProject,
    pickAudio,
    readAudioBytes,
    importMidi,
    clearError: () => setLastError(null),
  };
}
