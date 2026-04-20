"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRecorderContext } from "@/contexts/recorder-context";
import { useLiveMonitor } from "@/hooks/use-live-monitor";
import { useMidiControl } from "@/hooks/use-midi";
import { DeviceStrip } from "@/components/live/device-strip";
import { ActivityFeed } from "@/components/live/activity-feed";
import { MappingConfigPanel } from "@/components/live/mapping-config-panel";
import type { OscMapping, SavedEndpoint } from "@/lib/types";

export default function LivePage() {
  const recorder = useRecorderContext();
  const recording = recorder.recording;
  const {
    running: bridgeRunning,
    devices: connectedLivePorts,
    start: startBridge,
    stop: stopBridge,
    refreshDevices,
  } = useMidiControl();

  const [endpoints, setEndpoints] = useState<SavedEndpoint[]>([]);
  const [showUnmapped, setShowUnmapped] = useState(true);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.invoke("endpoints:get-all", "sender").then((res) => {
      setEndpoints((res as SavedEndpoint[]) ?? []);
    });
  }, []);

  const { entries, deviceActivity } = useLiveMonitor({ recording, endpoints });

  // Build a map of mappingId → most recent wallMs for flash triggers in the mapping table
  const mappingFlashTriggers = useMemo(() => {
    const result: Record<string, number> = {};
    for (const entry of entries) {
      if (!entry.mapping) continue;
      const id = entry.mapping.id;
      if (!result[id] || entry.wallMs > result[id]) {
        result[id] = entry.wallMs;
      }
    }
    return result;
  }, [entries]);

  const handleUpdateMappings = useCallback(
    (mappings: OscMapping[]) => {
      recorder.patchRecording({ oscMappings: mappings });
    },
    [recorder],
  );

  const handleUpdateLinks = useCallback(
    (links: Record<string, string>) => {
      recorder.patchRecording({ liveDeviceLinks: links });
    },
    [recorder],
  );

  const handleToggleDevice = useCallback(
    (deviceName: string, nextDisabled: boolean) => {
      const current = new Set(recording?.disabledLiveDevices ?? []);
      if (nextDisabled) current.add(deviceName);
      else current.delete(deviceName);
      recorder.patchRecording({ disabledLiveDevices: Array.from(current) });
    },
    [recorder, recording?.disabledLiveDevices],
  );

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

  if (!recording) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Load a recording in the Timeline tab to start live monitoring.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden -mx-6 -mb-6">
      {/* Bridge control bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-surface-light/50 shrink-0">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              bridgeRunning
                ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]"
                : "bg-white/20"
            }`}
          />
          <span className="text-xs text-gray-300">
            MIDI bridge {bridgeRunning ? "running" : "stopped"}
          </span>
        </div>
        <button
          onClick={handleToggleBridge}
          className={`text-xs px-3 py-1 rounded border transition-colors ${
            bridgeRunning
              ? "border-red-500/40 text-red-300 hover:bg-red-500/10"
              : "border-green-500/40 text-green-300 hover:bg-green-500/10"
          }`}
        >
          {bridgeRunning ? "Stop bridge" : "Start bridge"}
        </button>
        {bridgeError && (
          <span className="text-xs text-red-400 truncate">{bridgeError}</span>
        )}
      </div>

      {/* Zone 1 — Device strip */}
      <DeviceStrip
        devices={recording.devices}
        deviceActivity={deviceActivity}
        aliases={recording.deviceAliases}
        liveDeviceLinks={recording.liveDeviceLinks}
        connectedLivePorts={connectedLivePorts}
        disabledDevices={recording.disabledLiveDevices}
        onUpdateLinks={handleUpdateLinks}
        onToggleDevice={handleToggleDevice}
      />

      {/* Zone 2 — Activity feed */}
      <ActivityFeed
        entries={entries}
        showUnmapped={showUnmapped}
        onToggleUnmapped={setShowUnmapped}
        endpoints={endpoints}
        aliases={recording.deviceAliases}
      />

      {/* Zone 3 — Mapping config (collapsible) */}
      <MappingConfigPanel
        mappings={recording.oscMappings ?? []}
        endpoints={endpoints}
        aliases={recording.deviceAliases}
        flashTriggers={mappingFlashTriggers}
        onUpdateMappings={handleUpdateMappings}
        recordingId={recording.id}
      />
    </div>
  );
}
