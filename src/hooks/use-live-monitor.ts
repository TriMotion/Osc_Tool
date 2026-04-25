"use client";

import { useEffect, useRef, useState } from "react";
import { useMidiEvents } from "@/hooks/use-midi";
import { matchesMapping, resolveOscAddress, computeOscArgValue } from "@/lib/osc-mapping";
import type { ActivityEntry, MidiEvent, Recording, RecordedEvent, SavedEndpoint } from "@/lib/types";

const RING_SIZE = 500;

interface UseLiveMonitorArgs {
  recording: Recording | null;
  endpoints: SavedEndpoint[];
  activeSectionId?: string | null;
}

export interface DeviceActivity {
  lastMidiAt: number;
  lastOscAt: number;
}

interface UseLiveMonitorReturn {
  entries: ActivityEntry[];
  deviceActivity: Record<string, DeviceActivity>;
}

export function useLiveMonitor({ recording, endpoints, activeSectionId }: UseLiveMonitorArgs): UseLiveMonitorReturn {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [deviceActivity, setDeviceActivity] = useState<Record<string, DeviceActivity>>({});

  const recordingRef = useRef(recording);
  const endpointsRef = useRef(endpoints);
  const activeSectionIdRef = useRef(activeSectionId);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => { endpointsRef.current = endpoints; }, [endpoints]);
  useEffect(() => { activeSectionIdRef.current = activeSectionId; }, [activeSectionId]);

  const oscEffectInstances = useRef<Map<string, string>>(new Map());

  useMidiEvents((incoming: MidiEvent[]) => {
    const rec = recordingRef.current;
    const eps = endpointsRef.current;
    const now = Date.now();

    const newEntries: ActivityEntry[] = [];
    const activityUpdates: Record<string, { lastMidiAt?: number; lastOscAt?: number }> = {};

    const disabled = new Set(rec?.disabledLiveDevices ?? []);

    for (const event of incoming) {
      const liveDevice = event.midi.deviceName;
      // Resolve live port name → recording device name via user-defined links.
      const resolvedDevice = rec?.liveDeviceLinks?.[liveDevice] ?? liveDevice;
      // Drop events from disabled devices: no flash, no OSC, no log entry.
      if (disabled.has(resolvedDevice) || disabled.has(liveDevice)) continue;
      // Bump activity for both the live name (so an unlinked card lights up)
      // and the resolved name (so its linked recording card lights up too).
      if (!activityUpdates[liveDevice]) activityUpdates[liveDevice] = {};
      activityUpdates[liveDevice].lastMidiAt = now;
      if (resolvedDevice !== liveDevice) {
        if (!activityUpdates[resolvedDevice]) activityUpdates[resolvedDevice] = {};
        activityUpdates[resolvedDevice].lastMidiAt = now;
      }
      const device = resolvedDevice;

      // Wrap as RecordedEvent so matchesMapping / computeOscArgValue can consume it.
      // Rewrite the device name so mappings keyed on the recording's device match.
      const resolvedMidi = resolvedDevice === liveDevice ? event.midi : { ...event.midi, deviceName: resolvedDevice };
      const fakeEvt: RecordedEvent = { tRel: 0, midi: resolvedMidi, osc: event.osc };

      let fired = false;

      if (rec?.oscMappings?.length) {
        const sectionFilter = activeSectionIdRef.current;
        for (const mapping of rec.oscMappings) {
          if (sectionFilter && mapping.sectionId && mapping.sectionId !== sectionFilter) continue;
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

            if (mapping.oscEffectId && event.midi.type === "noteon") {
              const instanceKey = `${mapping.id}|${event.midi.data1}`;
              const velocityScale = event.midi.data2 / 127;
              window.electronAPI?.invoke("osc-effect:trigger", mapping.oscEffectId, {
                host: endpoint.host,
                port: endpoint.port,
                address,
                argType: mapping.argType,
              }, velocityScale).then((instanceId: unknown) => {
                if (typeof instanceId === "string" && instanceId) {
                  oscEffectInstances.current.set(instanceKey, instanceId);
                }
              });
            } else if (mapping.oscEffectId && event.midi.type === "noteoff") {
              const instanceKey = `${mapping.id}|${event.midi.data1}`;
              const instanceId = oscEffectInstances.current.get(instanceKey);
              if (instanceId) {
                window.electronAPI?.invoke("osc-effect:release", instanceId);
                oscEffectInstances.current.delete(instanceKey);
              }
            } else if (!mapping.oscEffectId) {
              window.electronAPI?.invoke("osc:send", { host: endpoint.host, port: endpoint.port }, address, [
                { type: mapping.argType, value },
              ]);
            }

            activityUpdates[device].lastOscAt = now;
            if (liveDevice !== device) {
              activityUpdates[liveDevice].lastOscAt = now;
            }

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
