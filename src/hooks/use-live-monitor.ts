"use client";

import { useEffect, useRef, useState } from "react";
import { useMidiEvents } from "@/hooks/use-midi";
import { matchesMapping, resolveOscAddress, computeOscArgValue } from "@/lib/osc-mapping";
import type { ActivityEntry, MidiEvent, Recording, RecordedEvent, SavedEndpoint } from "@/lib/types";

const RING_SIZE = 500;

interface UseLiveMonitorArgs {
  recording: Recording | null;
  endpoints: SavedEndpoint[];
}

export interface DeviceActivity {
  lastMidiAt: number;
  lastOscAt: number;
}

interface UseLiveMonitorReturn {
  entries: ActivityEntry[];
  deviceActivity: Record<string, DeviceActivity>;
}

export function useLiveMonitor({ recording, endpoints }: UseLiveMonitorArgs): UseLiveMonitorReturn {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [deviceActivity, setDeviceActivity] = useState<Record<string, DeviceActivity>>({});

  const recordingRef = useRef(recording);
  const endpointsRef = useRef(endpoints);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => { endpointsRef.current = endpoints; }, [endpoints]);

  useMidiEvents((incoming: MidiEvent[]) => {
    const rec = recordingRef.current;
    const eps = endpointsRef.current;
    const now = Date.now();

    const newEntries: ActivityEntry[] = [];
    const activityUpdates: Record<string, { lastMidiAt?: number; lastOscAt?: number }> = {};

    for (const event of incoming) {
      const device = event.midi.deviceName;
      if (!activityUpdates[device]) activityUpdates[device] = {};
      activityUpdates[device].lastMidiAt = now;

      // Wrap as RecordedEvent so matchesMapping / computeOscArgValue can consume it
      const fakeEvt: RecordedEvent = { tRel: 0, midi: event.midi, osc: event.osc };

      let fired = false;

      if (rec?.oscMappings?.length) {
        for (const mapping of rec.oscMappings) {
          if (!matchesMapping(fakeEvt, mapping)) continue;

          const address = resolveOscAddress(
            mapping,
            rec.deviceAliases,
            event.midi.type === "noteon" ? event.midi.data2 : undefined,
          );
          const value = computeOscArgValue(fakeEvt, mapping);
          const allEndpointIds = [mapping.endpointId, ...(mapping.extraEndpointIds ?? [])];

          for (const epId of allEndpointIds) {
            const endpoint = eps.find((e) => e.id === epId);
            if (!endpoint) continue;

            window.electronAPI?.invoke("osc:send", { host: endpoint.host, port: endpoint.port }, address, [
              { type: mapping.argType, value },
            ]);

            activityUpdates[device].lastOscAt = now;

            newEntries.push({
              id: crypto.randomUUID(),
              wallMs: now,
              device,
              eventType: event.midi.type,
              data1: event.midi.data1,
              data2: event.midi.data2,
              mapping,
              address,
              endpointId: epId,
              value,
              argType: mapping.argType,
            });

            fired = true;
          }
        }
      }

      if (!fired) {
        newEntries.push({
          id: crypto.randomUUID(),
          wallMs: now,
          device,
          eventType: event.midi.type,
          data1: event.midi.data1,
          data2: event.midi.data2,
          mapping: null,
          address: null,
          endpointId: null,
          value: null,
          argType: null,
        });
      }
    }

    if (newEntries.length > 0) {
      setEntries((prev) => [...newEntries.reverse(), ...prev].slice(0, RING_SIZE));
    }

    if (Object.keys(activityUpdates).length > 0) {
      setDeviceActivity((prev) => {
        const next = { ...prev };
        for (const [dev, update] of Object.entries(activityUpdates)) {
          next[dev] = {
            lastMidiAt: update.lastMidiAt ?? next[dev]?.lastMidiAt ?? 0,
            lastOscAt: update.lastOscAt ?? next[dev]?.lastOscAt ?? 0,
          };
        }
        return next;
      });
    }
  });

  return { entries, deviceActivity };
}
