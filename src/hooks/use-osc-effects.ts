"use client";

import { useCallback, useEffect, useState } from "react";
import { useRecorderContext } from "@/contexts/recorder-context";
import type { OscEffect } from "@/lib/osc-effect-types";
import type { OscEffectTrigger } from "@/lib/types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useOscEffects() {
  const { recording, patchRecording } = useRecorderContext();

  const [globalEffects, setGlobalEffects] = useState<OscEffect[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const list = (await api.invoke("osc-effect:get-all")) as OscEffect[];
    setGlobalEffects(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const effects = recording?.oscEffects ?? globalEffects;
  const triggers = recording?.oscEffectTriggers ?? [];

  const saveEffect = useCallback(async (effect: OscEffect) => {
    if (recording) {
      const existing = recording.oscEffects ?? [];
      const toSave = effect.id ? effect : { ...effect, id: crypto.randomUUID() };
      const idx = existing.findIndex((e) => e.id === toSave.id);
      const updated = idx >= 0
        ? existing.map((e, i) => (i === idx ? toSave : e))
        : [...existing, toSave];
      patchRecording({ oscEffects: updated });
      const api = getAPI();
      if (api) await api.invoke("osc-effect:save", toSave);
      return toSave;
    }
    const api = getAPI();
    if (!api) return effect;
    const saved = (await api.invoke("osc-effect:save", effect)) as OscEffect;
    setGlobalEffects((prev) => {
      const idx = prev.findIndex((e) => e.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved];
    });
    return saved;
  }, [recording, patchRecording]);

  const deleteEffect = useCallback(async (id: string) => {
    if (recording) {
      patchRecording({ oscEffects: (recording.oscEffects ?? []).filter((e) => e.id !== id) });
      const api = getAPI();
      if (api) await api.invoke("osc-effect:delete", id);
      return;
    }
    const api = getAPI();
    if (!api) return;
    await api.invoke("osc-effect:delete", id);
    setGlobalEffects((prev) => prev.filter((e) => e.id !== id));
  }, [recording, patchRecording]);

  const saveTrigger = useCallback(async (trigger: OscEffectTrigger) => {
    if (!recording) return;
    const existing = recording.oscEffectTriggers ?? [];
    const toSave = trigger.id ? trigger : { ...trigger, id: crypto.randomUUID() };
    const idx = existing.findIndex((t) => t.id === toSave.id);
    const updated = idx >= 0
      ? existing.map((t, i) => (i === idx ? toSave : t))
      : [...existing, toSave];
    patchRecording({ oscEffectTriggers: updated });
  }, [recording, patchRecording]);

  const deleteTrigger = useCallback(async (id: string) => {
    if (!recording) return;
    patchRecording({ oscEffectTriggers: (recording.oscEffectTriggers ?? []).filter((t) => t.id !== id) });
  }, [recording, patchRecording]);

  const triggerEffect = useCallback(async (
    effectId: string,
    target: { host: string; port: number; address: string; argType: "f" | "i" },
    velocityScale?: number,
  ) => {
    const api = getAPI();
    if (!api) return null;
    return (await api.invoke("osc-effect:trigger", effectId, target, velocityScale)) as string;
  }, []);

  const releaseEffect = useCallback(async (instanceId: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("osc-effect:release", instanceId);
  }, []);

  const stopEffect = useCallback(async (instanceId: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("osc-effect:stop", instanceId);
  }, []);

  return {
    effects, triggers,
    saveEffect, deleteEffect,
    saveTrigger, deleteTrigger,
    triggerEffect, releaseEffect, stopEffect,
    refresh,
  };
}
