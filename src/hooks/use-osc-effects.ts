"use client";

import { useCallback, useEffect, useState } from "react";
import type { OscEffect } from "@/lib/osc-effect-types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useOscEffects() {
  const [effects, setEffects] = useState<OscEffect[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const list = (await api.invoke("osc-effect:get-all")) as OscEffect[];
    setEffects(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveEffect = useCallback(async (effect: OscEffect) => {
    const api = getAPI();
    if (!api) return;
    const saved = (await api.invoke("osc-effect:save", effect)) as OscEffect;
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
    await api.invoke("osc-effect:delete", id);
    setEffects((prev) => prev.filter((e) => e.id !== id));
  }, []);

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
    effects,
    saveEffect,
    deleteEffect,
    triggerEffect,
    releaseEffect,
    stopEffect,
    refresh,
  };
}
