"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import type { OscMessage, ListenerConfig, SenderConfig, OscArg, Preset, DiagnosticsResult } from "@/lib/types";

declare global {
  interface Window {
    electronAPI: {
      send: (channel: string, ...args: unknown[]) => void;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}

export function useOscListener(onMessage: (msg: OscMessage) => void) {
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    const unsub = window.electronAPI.on("osc:message", (msg) => {
      callbackRef.current(msg as OscMessage);
    });
    return unsub;
  }, []);
}

export function useOscThroughput() {
  const [throughput, setThroughput] = useState(0);

  useEffect(() => {
    const unsub = window.electronAPI.on("osc:throughput", (count) => {
      setThroughput(count as number);
    });
    return unsub;
  }, []);

  return throughput;
}

export function useOscSender() {
  const send = useCallback(async (config: SenderConfig, address: string, args: OscArg[]) => {
    await window.electronAPI.invoke("osc:send", config, address, args);
  }, []);

  return { send };
}

export function useListenerControl() {
  const start = useCallback(async (config: ListenerConfig) => {
    await window.electronAPI.invoke("osc:start-listener", config);
  }, []);

  const stop = useCallback(async (port: number) => {
    await window.electronAPI.invoke("osc:stop-listener", port);
  }, []);

  const getActive = useCallback(async (): Promise<number[]> => {
    return (await window.electronAPI.invoke("osc:get-active-listeners")) as number[];
  }, []);

  return { start, stop, getActive };
}

export function usePresets() {
  const [presets, setPresets] = useState<Preset[]>([]);

  const refresh = useCallback(async () => {
    const all = (await window.electronAPI.invoke("presets:get-all")) as Preset[];
    setPresets(all);
  }, []);

  const add = useCallback(async (preset: Omit<Preset, "id" | "order">) => {
    await window.electronAPI.invoke("presets:add", preset);
    await refresh();
  }, [refresh]);

  const update = useCallback(async (id: string, updates: Partial<Omit<Preset, "id">>) => {
    await window.electronAPI.invoke("presets:update", id, updates);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await window.electronAPI.invoke("presets:remove", id);
    await refresh();
  }, [refresh]);

  const reorder = useCallback(async (ids: string[]) => {
    await window.electronAPI.invoke("presets:reorder", ids);
    await refresh();
  }, [refresh]);

  const exportAll = useCallback(async (): Promise<string> => {
    return (await window.electronAPI.invoke("presets:export")) as string;
  }, []);

  const importPresets = useCallback(async (json: string) => {
    await window.electronAPI.invoke("presets:import", json);
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
    const unsub = window.electronAPI.on("diag:progress", (p) => {
      setProgress(p as { sent: number; received: number; total: number });
    });
    return unsub;
  }, []);

  const runLoopback = useCallback(async (count: number, rate: number): Promise<DiagnosticsResult> => {
    setProgress({ sent: 0, received: 0, total: count });
    const result = (await window.electronAPI.invoke("diag:run-loopback", count, rate)) as DiagnosticsResult;
    setProgress(null);
    return result;
  }, []);

  return { runLoopback, progress };
}

export function useWebServer() {
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const start = useCallback(async (port: number) => {
    const result = (await window.electronAPI.invoke("web:start", port)) as {
      ok: boolean;
      url: string;
    };
    setRunning(true);
    setUrl(result.url);
    return result.url;
  }, []);

  const stop = useCallback(async () => {
    await window.electronAPI.invoke("web:stop");
    setRunning(false);
    setUrl(null);
  }, []);

  const checkStatus = useCallback(async () => {
    const result = (await window.electronAPI.invoke("web:status")) as { running: boolean };
    setRunning(result.running);
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return { running, url, start, stop };
}
