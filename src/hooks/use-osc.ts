"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import type { OscMessage, ListenerConfig, SenderConfig, OscArg, Preset, DiagnosticsResult, SavedEndpoint } from "@/lib/types";

declare global {
  interface Window {
    electronAPI?: {
      send: (channel: string, ...args: unknown[]) => void;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useOscListener(onMessages: (msgs: OscMessage[]) => void) {
  const callbackRef = useRef(onMessages);
  callbackRef.current = onMessages;

  useEffect(() => {
    const api = getAPI();
    if (!api) return;
    const unsub = api.on("osc:messages", (msgs) => {
      callbackRef.current(msgs as OscMessage[]);
    });
    return unsub;
  }, []);
}

export function useOscThroughput() {
  const [throughput, setThroughput] = useState(0);

  useEffect(() => {
    const api = getAPI();
    if (!api) return;
    const unsub = api.on("osc:throughput", (count) => {
      setThroughput(count as number);
    });
    return unsub;
  }, []);

  return throughput;
}

export function useOscSender() {
  const send = useCallback(async (config: SenderConfig, address: string, args: OscArg[]) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("osc:send", config, address, args);
  }, []);

  return { send };
}

export function useListenerControl() {
  const start = useCallback(async (config: ListenerConfig) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("osc:start-listener", config);
  }, []);

  const stop = useCallback(async (port: number) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("osc:stop-listener", port);
  }, []);

  const getActive = useCallback(async (): Promise<number[]> => {
    const api = getAPI();
    if (!api) return [];
    return (await api.invoke("osc:get-active-listeners")) as number[];
  }, []);

  return { start, stop, getActive };
}

export function usePresets() {
  const [presets, setPresets] = useState<Preset[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const all = (await api.invoke("presets:get-all")) as Preset[];
    setPresets(all);
  }, []);

  const add = useCallback(async (preset: Omit<Preset, "id" | "order">) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("presets:add", preset);
    await refresh();
  }, [refresh]);

  const update = useCallback(async (id: string, updates: Partial<Omit<Preset, "id">>) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("presets:update", id, updates);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("presets:remove", id);
    await refresh();
  }, [refresh]);

  const reorder = useCallback(async (ids: string[]) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("presets:reorder", ids);
    await refresh();
  }, [refresh]);

  const exportAll = useCallback(async (): Promise<string> => {
    const api = getAPI();
    if (!api) return "[]";
    return (await api.invoke("presets:export")) as string;
  }, []);

  const importPresets = useCallback(async (json: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("presets:import", json);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { presets, add, update, remove, reorder, exportAll, importPresets, refresh };
}

export function useDiagnostics() {
  const [progress, setProgress] = useState<{ sent: number; received: number; total: number } | null>(null);

  useEffect(() => {
    const api = getAPI();
    if (!api) return;
    const unsub = api.on("diag:progress", (p) => {
      setProgress(p as { sent: number; received: number; total: number });
    });
    return unsub;
  }, []);

  const runLoopback = useCallback(async (count: number, rate: number): Promise<DiagnosticsResult> => {
    const api = getAPI();
    if (!api) throw new Error("Not running in Electron");
    setProgress({ sent: 0, received: 0, total: count });
    const result = (await api.invoke("diag:run-loopback", count, rate)) as DiagnosticsResult;
    setProgress(null);
    return result;
  }, []);

  return { runLoopback, progress };
}

export function useWebServer() {
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const start = useCallback(async (port: number) => {
    const api = getAPI();
    if (!api) return "";
    const result = (await api.invoke("web:start", port)) as {
      ok: boolean;
      url: string;
    };
    setRunning(true);
    setUrl(result.url);
    return result.url;
  }, []);

  const stop = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("web:stop");
    setRunning(false);
    setUrl(null);
  }, []);

  const checkStatus = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const result = (await api.invoke("web:status")) as { running: boolean };
    setRunning(result.running);
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return { running, url, start, stop };
}

export function useEndpoints(type: "listener" | "sender") {
  const [endpoints, setEndpoints] = useState<SavedEndpoint[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const all = (await api.invoke("endpoints:get-all", type)) as SavedEndpoint[];
    setEndpoints(all);
  }, [type]);

  const add = useCallback(async (endpoint: Omit<SavedEndpoint, "id">) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("endpoints:add", endpoint);
    await refresh();
  }, [refresh]);

  const update = useCallback(async (id: string, updates: Partial<Omit<SavedEndpoint, "id">>) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("endpoints:update", id, updates);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("endpoints:remove", id);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { endpoints, add, update, remove, refresh };
}
