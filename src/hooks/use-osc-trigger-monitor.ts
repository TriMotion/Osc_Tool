"use client";

import { useEffect, useRef } from "react";
import { useOscListener } from "@/hooks/use-osc";
import type { OscMessage, Recording, OscEffectTrigger } from "@/lib/types";
import type { OscDmxTrigger } from "@/lib/dmx-types";

interface UseOscTriggerMonitorArgs {
  recording: Recording | null;
  activeSectionId?: string | null;
}

function extractNumericArg(msg: OscMessage): number | null {
  if (!msg.args || msg.args.length === 0) return null;
  const arg = msg.args[0];
  if (typeof arg.value === "number") return arg.value;
  return null;
}

export function useOscTriggerMonitor({ recording, activeSectionId }: UseOscTriggerMonitorArgs) {
  const recordingRef = useRef(recording);
  const activeSectionIdRef = useRef(activeSectionId);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => { activeSectionIdRef.current = activeSectionId; }, [activeSectionId]);

  useOscListener((msgs: OscMessage[]) => {
    const rec = recordingRef.current;
    if (!rec) return;
    const sectionId = activeSectionIdRef.current;
    const dmxTriggers = rec.dmxTriggers ?? [];
    const oscTriggers = rec.oscEffectTriggers ?? [];
    const endpoints = rec.endpoints ?? [];

    for (const msg of msgs) {
      // --- DMX triggers ---
      for (const trigger of dmxTriggers) {
        if (msg.address !== trigger.oscAddress) continue;
        if (trigger.sectionId && trigger.sectionId !== sectionId) continue;

        if (trigger.mode === "match-only" && trigger.dmxEffectId) {
          const value = extractNumericArg(msg);
          const velocityScale = value != null ? Math.max(0, Math.min(1, value)) : 1;
          window.electronAPI?.invoke("dmx:trigger-effect", trigger.dmxEffectId, velocityScale);
        } else if (trigger.mode === "passthrough") {
          const rawValue = extractNumericArg(msg);
          if (rawValue === null) continue;
          const inMin = trigger.inputMin ?? 0;
          const inMax = trigger.inputMax ?? 1;
          const outMin = trigger.outputMin ?? 0;
          const outMax = trigger.outputMax ?? 255;
          const ratio = inMax !== inMin ? (rawValue - inMin) / (inMax - inMin) : 0;
          const dmxValue = outMin + ratio * (outMax - outMin);
          const channels = trigger.dmxChannels ?? [];
          for (const ch of channels) {
            window.electronAPI?.invoke("dmx:set-channel", ch, dmxValue);
          }
        }
      }

      // --- OSC effect triggers ---
      for (const trigger of oscTriggers) {
        if (msg.address !== trigger.oscAddress) continue;
        if (trigger.sectionId && trigger.sectionId !== sectionId) continue;

        const endpoint = endpoints.find((ep) => ep.id === trigger.endpointId);
        if (!endpoint) continue;

        const value = extractNumericArg(msg);
        const velocityScale = trigger.velocityFromValue && value != null
          ? Math.max(0, Math.min(1, value))
          : 1;

        window.electronAPI?.invoke("osc-effect:trigger", trigger.oscEffectId, {
          host: endpoint.host,
          port: endpoint.port,
          address: trigger.targetAddress,
          argType: trigger.argType,
        }, velocityScale);
      }
    }
  });
}
