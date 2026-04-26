"use client";

import { useCallback, useEffect, useState } from "react";
import { useRecorderContext } from "@/contexts/recorder-context";
import type { DmxEffect, SacnConfig, OscDmxTrigger } from "@/lib/dmx-types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useDmx() {
  const { recording, patchRecording } = useRecorderContext();

  const [globalConfig, setGlobalConfig] = useState<SacnConfig>({ universe: 7, enabled: false });
  const [globalEffects, setGlobalEffects] = useState<DmxEffect[]>([]);
  const [globalTriggers, setGlobalTriggers] = useState<OscDmxTrigger[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const [c, e, t] = await Promise.all([
      api.invoke("dmx:get-config") as Promise<SacnConfig>,
      api.invoke("dmx:get-effects") as Promise<DmxEffect[]>,
      api.invoke("dmx:get-triggers") as Promise<OscDmxTrigger[]>,
    ]);
    setGlobalConfig(c);
    setGlobalEffects(e);
    setGlobalTriggers(t);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const config = recording?.dmxConfig ?? globalConfig;
  const effects = recording?.dmxEffects ?? globalEffects;
  const triggers = recording?.dmxTriggers ?? globalTriggers;

  const setConfig = useCallback(async (c: SacnConfig) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:set-config", c);
    if (recording) {
      patchRecording({ dmxConfig: c });
    } else {
      setGlobalConfig(c);
    }
  }, [recording, patchRecording]);

  const saveEffect = useCallback(async (effect: DmxEffect) => {
    if (recording) {
      const existing = recording.dmxEffects ?? [];
      const toSave = effect.id ? effect : { ...effect, id: crypto.randomUUID() };
      const idx = existing.findIndex((e) => e.id === toSave.id);
      const updated = idx >= 0
        ? existing.map((e, i) => (i === idx ? toSave : e))
        : [...existing, toSave];
      patchRecording({ dmxEffects: updated });
      const api = getAPI();
      if (api) await api.invoke("dmx:save-effect", toSave);
      return toSave;
    }
    const api = getAPI();
    if (!api) return effect;
    const saved = (await api.invoke("dmx:save-effect", effect)) as DmxEffect;
    setGlobalEffects((prev) => {
      const idx = prev.findIndex((e) => e.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved];
    });
    return saved;
  }, [recording, patchRecording]);

  const deleteEffect = useCallback(async (id: string) => {
    if (recording) {
      patchRecording({ dmxEffects: (recording.dmxEffects ?? []).filter((e) => e.id !== id) });
      const api = getAPI();
      if (api) await api.invoke("dmx:delete-effect", id);
      return;
    }
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:delete-effect", id);
    setGlobalEffects((prev) => prev.filter((e) => e.id !== id));
  }, [recording, patchRecording]);

  const triggerEffect = useCallback(async (effectId: string, velocityScale?: number) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:trigger-effect", effectId, velocityScale);
  }, []);

  const stopEffect = useCallback(async (effectId: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:stop-effect", effectId);
  }, []);

  const setChannel = useCallback(async (channel: number, value: number) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:set-channel", channel, value);
  }, []);

  const releaseChannel = useCallback(async (channel: number) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:release-channel", channel);
  }, []);

  const saveTrigger = useCallback(async (trigger: OscDmxTrigger) => {
    if (recording) {
      const existing = recording.dmxTriggers ?? [];
      const toSave = trigger.id ? trigger : { ...trigger, id: crypto.randomUUID() };
      const idx = existing.findIndex((t) => t.id === toSave.id);
      const updated = idx >= 0
        ? existing.map((t, i) => (i === idx ? toSave : t))
        : [...existing, toSave];
      patchRecording({ dmxTriggers: updated });
      return;
    }
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:save-trigger", trigger);
    await refresh();
  }, [recording, patchRecording, refresh]);

  const deleteTrigger = useCallback(async (id: string) => {
    if (recording) {
      patchRecording({ dmxTriggers: (recording.dmxTriggers ?? []).filter((t) => t.id !== id) });
      return;
    }
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:delete-trigger", id);
    setGlobalTriggers((prev) => prev.filter((t) => t.id !== id));
  }, [recording, patchRecording]);

  const getBuffer = useCallback(async () => {
    const api = getAPI();
    if (!api) return new Uint8Array(512);
    return (await api.invoke("dmx:get-buffer")) as Uint8Array;
  }, []);

  return {
    config, effects, triggers,
    setConfig, saveEffect, deleteEffect,
    triggerEffect, stopEffect,
    setChannel, releaseChannel, getBuffer,
    saveTrigger, deleteTrigger,
    refresh,
  };
}
