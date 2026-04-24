"use client";

import { useCallback, useEffect, useState } from "react";
import type { DmxEffect, SacnConfig, OscDmxTrigger } from "@/lib/dmx-types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useDmx() {
  const [config, setConfigState] = useState<SacnConfig>({ universe: 7, enabled: false });
  const [effects, setEffects] = useState<DmxEffect[]>([]);
  const [triggers, setTriggers] = useState<OscDmxTrigger[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const [c, e, t] = await Promise.all([
      api.invoke("dmx:get-config") as Promise<SacnConfig>,
      api.invoke("dmx:get-effects") as Promise<DmxEffect[]>,
      api.invoke("dmx:get-triggers") as Promise<OscDmxTrigger[]>,
    ]);
    setConfigState(c);
    setEffects(e);
    setTriggers(t);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const setConfig = useCallback(async (c: SacnConfig) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:set-config", c);
    setConfigState(c);
  }, []);

  const saveEffect = useCallback(async (effect: DmxEffect) => {
    const api = getAPI();
    if (!api) return;
    const saved = (await api.invoke("dmx:save-effect", effect)) as DmxEffect;
    setEffects((prev) => {
      const idx = prev.findIndex((e) => e.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved];
    });
    return saved;
  }, []);

  const deleteEffect = useCallback(async (id: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:delete-effect", id);
    setEffects((prev) => prev.filter((e) => e.id !== id));
  }, []);

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

  const getBuffer = useCallback(async (): Promise<number[]> => {
    const api = getAPI();
    if (!api) return new Array(512).fill(0);
    return (await api.invoke("dmx:get-buffer")) as number[];
  }, []);

  const saveTrigger = useCallback(async (trigger: OscDmxTrigger) => {
    const api = getAPI();
    if (!api) return;
    const saved = (await api.invoke("dmx:save-trigger", trigger)) as OscDmxTrigger;
    setTriggers((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved];
    });
    return saved;
  }, []);

  const deleteTrigger = useCallback(async (id: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("dmx:delete-trigger", id);
    setTriggers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    config, setConfig,
    effects, saveEffect, deleteEffect,
    triggerEffect, stopEffect,
    setChannel, releaseChannel, getBuffer,
    triggers, saveTrigger, deleteTrigger,
    refresh,
  };
}
