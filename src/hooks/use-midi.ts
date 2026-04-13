"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import type { MidiEvent, MidiMappingRule } from "@/lib/types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useMidiEvents(onEvents: (events: MidiEvent[]) => void) {
  const callbackRef = useRef(onEvents);
  callbackRef.current = onEvents;

  useEffect(() => {
    const api = getAPI();
    if (!api) return;
    return api.on("midi:events", (events) => {
      callbackRef.current(events as MidiEvent[]);
    });
  }, []);
}

export function useMidiControl() {
  const [running, setRunning] = useState(false);
  const [devices, setDevices] = useState<string[]>([]);

  const refreshDevices = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    setDevices((await api.invoke("midi:get-devices")) as string[]);
  }, []);

  const checkStatus = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    setRunning((await api.invoke("midi:get-status")) as boolean);
  }, []);

  const start = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    try {
      await api.invoke("midi:start");
      setRunning(true);
    } catch {
      await checkStatus();
    }
  }, [checkStatus]);

  const stop = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    try {
      await api.invoke("midi:stop");
      setRunning(false);
    } catch {
      await checkStatus();
    }
  }, [checkStatus]);

  useEffect(() => {
    checkStatus();
    refreshDevices();
  }, [checkStatus, refreshDevices]);

  return { running, devices, start, stop, refreshDevices };
}

export function useMidiConfig() {
  const [rules, setRules] = useState<MidiMappingRule[]>([]);
  const [deviceFilters, setDeviceFilters] = useState<string[]>([]);
  const [target, setTargetState] = useState<{ host: string; port: number }>({
    host: "127.0.0.1",
    port: 8000,
  });

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const [r, f, t] = await Promise.all([
      api.invoke("midi:get-mapping-rules"),
      api.invoke("midi:get-device-filters"),
      api.invoke("midi:get-target"),
    ]);
    setRules(r as MidiMappingRule[]);
    setDeviceFilters(f as string[]);
    setTargetState(t as { host: string; port: number });
  }, []);

  const saveRules = useCallback(async (newRules: MidiMappingRule[]) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("midi:set-mapping-rules", newRules);
    setRules(newRules);
  }, []);

  const saveDeviceFilters = useCallback(async (filters: string[]) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("midi:set-device-filters", filters);
    setDeviceFilters(filters);
  }, []);

  const saveTarget = useCallback(async (t: { host: string; port: number }) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("midi:set-target", t);
    setTargetState(t);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { rules, deviceFilters, target, saveRules, saveDeviceFilters, saveTarget };
}
