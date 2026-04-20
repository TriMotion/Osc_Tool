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
  const { devices: connectedLivePorts } = useMidiControl();

  const [endpoints, setEndpoints] = useState<SavedEndpoint[]>([]);
  const [showUnmapped, setShowUnmapped] = useState(true);

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

  if (!recording) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Load a recording in the Timeline tab to start live monitoring.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden -mx-6 -mb-6">
      {/* Zone 1 — Device strip */}
      <DeviceStrip
        devices={recording.devices}
        deviceActivity={deviceActivity}
        aliases={recording.deviceAliases}
        liveDeviceLinks={recording.liveDeviceLinks}
        connectedLivePorts={connectedLivePorts}
        onUpdateLinks={handleUpdateLinks}
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
