"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useRecorder } from "@/hooks/use-recorder";
import { useMidiConfig } from "@/hooks/use-midi";
import type { MidiMappingRule, Recording } from "@/lib/types";

type RecorderBase = ReturnType<typeof useRecorder>;

interface RecorderContextValue extends RecorderBase {
  loadedFromPath: string | null;
  setLoadedFromPath: (path: string | null) => void;
  save: (suggestedPath?: string) => Promise<string | null>;
  saveAs: (suggestedPath?: string) => Promise<string | null>;
  loadFile: () => Promise<boolean>;
  loadFromPath: (filePath: string) => Promise<boolean>;
  loadProject: () => Promise<boolean>;
  saveProject: () => Promise<string | null>;
}

const RecorderContext = createContext<RecorderContextValue | null>(null);

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

async function migrateRecording(rec: Recording): Promise<Recording> {
  if (rec.endpoints && rec.dmxConfig && rec.dmxEffects && rec.dmxTriggers && rec.oscEffects && rec.oscEffectTriggers) {
    return rec;
  }
  const api = getAPI();
  if (!api) return rec;
  const seed = (await api.invoke("stores:get-seed-data")) as {
    endpoints: any[];
    dmxConfig: any;
    dmxEffects: any[];
    dmxTriggers: any[];
    oscEffects: any[];
  };
  return {
    ...rec,
    endpoints: rec.endpoints ?? seed.endpoints,
    dmxConfig: rec.dmxConfig ?? seed.dmxConfig,
    dmxEffects: rec.dmxEffects ?? seed.dmxEffects,
    dmxTriggers: rec.dmxTriggers ?? seed.dmxTriggers,
    oscEffects: rec.oscEffects ?? seed.oscEffects,
    oscEffectTriggers: rec.oscEffectTriggers ?? [],
  };
}

export function RecorderProvider({ children }: { children: React.ReactNode }) {
  const { rules } = useMidiConfig();
  const rulesRef = useRef<MidiMappingRule[]>(rules);
  rulesRef.current = rules;

  const recorder = useRecorder({
    getMappingRulesSnapshot: () => rulesRef.current,
  });

  const [loadedFromPath, setLoadedFromPath] = useState<string | null>(null);

  const setLoadedWithMigration = useCallback(async (rec: Recording, path?: string) => {
    const migrated = await migrateRecording(rec);
    recorder.setLoaded(migrated);
    setLoadedFromPath(path ?? null);
  }, [recorder]);

  const save = useCallback(async (suggestedPath?: string) => {
    const api = getAPI();
    if (!api || !recorder.recording) return null;
    const pathToUse = suggestedPath ?? loadedFromPath ?? undefined;
    const res = (await api.invoke("recording:save", recorder.recording, pathToUse)) as
      | { path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res || "cancelled" in res) return null;
    recorder.markSaved();
    setLoadedFromPath(res.path);
    return res.path;
  }, [recorder, loadedFromPath]);

  const saveAs = useCallback(async (suggestedPath?: string) => {
    const api = getAPI();
    if (!api || !recorder.recording) return null;
    const res = (await api.invoke("recording:save-as", recorder.recording, suggestedPath)) as
      | { path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res || "cancelled" in res) return null;
    recorder.markSaved();
    setLoadedFromPath(res.path);
    return res.path;
  }, [recorder]);

  const loadFile = useCallback(async () => {
    const api = getAPI();
    if (!api) return false;
    const res = (await api.invoke("recording:load")) as
      | { recording: Recording; path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res || "cancelled" in res) return false;
    await setLoadedWithMigration(res.recording, res.path);
    return true;
  }, [setLoadedWithMigration]);

  const loadFromPath = useCallback(async (filePath: string) => {
    const api = getAPI();
    if (!api) return false;
    const res = (await api.invoke("recording:load-path", filePath)) as
      | { recording: Recording; path: string }
      | { error: string };
    if ("error" in res) return false;
    await setLoadedWithMigration(res.recording, res.path);
    return true;
  }, [setLoadedWithMigration]);

  const loadProject = useCallback(async () => {
    const api = getAPI();
    if (!api) return false;
    const res = (await api.invoke("recording:load-project")) as
      | { recording: Recording; path: string }
      | { cancelled: true }
      | { error: string };
    if ("error" in res || "cancelled" in res) return false;
    await setLoadedWithMigration(res.recording, res.path);
    return true;
  }, [setLoadedWithMigration]);

  const saveProject = useCallback(async () => {
    const api = getAPI();
    if (!api || !recorder.recording) return null;
    const res = (await api.invoke("recording:save-project", recorder.recording)) as
      | { path: string }
      | { error: string };
    if ("error" in res) return null;
    recorder.markSaved();
    setLoadedFromPath(res.path);
    return res.path;
  }, [recorder]);

  const value: RecorderContextValue = {
    ...recorder,
    loadedFromPath,
    setLoadedFromPath,
    save,
    saveAs,
    loadFile,
    loadFromPath,
    loadProject,
    saveProject,
  };

  return (
    <RecorderContext.Provider value={value}>
      {children}
    </RecorderContext.Provider>
  );
}

export function useRecorderContext(): RecorderContextValue {
  const ctx = useContext(RecorderContext);
  if (!ctx) throw new Error("useRecorderContext must be used within RecorderProvider");
  return ctx;
}
