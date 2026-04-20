"use client";

import { useFlash } from "@/hooks/use-flash";
import type { DeviceActivity } from "@/hooks/use-live-monitor";

interface DeviceCardProps {
  name: string;
  activity: DeviceActivity | undefined;
  aliases?: Record<string, string>;
}

function DeviceCard({ name, activity, aliases }: DeviceCardProps) {
  const displayName = aliases?.[name] ?? name;
  const midiFlashing = useFlash(activity?.lastMidiAt ?? 0);
  const oscFlashing = useFlash(activity?.lastOscAt ?? 0);

  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-lg bg-surface-light border border-white/5 min-w-[120px]">
      <span className="text-xs font-medium text-gray-300 truncate max-w-[100px]">{displayName}</span>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <div
            className={`w-2 h-2 rounded-full transition-colors duration-150 ${
              midiFlashing ? "bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.8)]" : "bg-white/10"
            }`}
          />
          <span className="text-[10px] text-gray-500">MIDI</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className={`w-2 h-2 rounded-full transition-colors duration-150 ${
              oscFlashing ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" : "bg-white/10"
            }`}
          />
          <span className="text-[10px] text-gray-500">OSC</span>
        </div>
      </div>
    </div>
  );
}

interface DeviceStripProps {
  devices: string[];
  deviceActivity: Record<string, DeviceActivity>;
  aliases?: Record<string, string>;
}

export function DeviceStrip({ devices, deviceActivity, aliases }: DeviceStripProps) {
  if (devices.length === 0) {
    return (
      <div className="flex items-center px-4 py-3 text-sm text-gray-500 border-b border-white/5">
        No devices in recording
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 overflow-x-auto shrink-0">
      {devices.map((device) => (
        <DeviceCard
          key={device}
          name={device}
          activity={deviceActivity[device]}
          aliases={aliases}
        />
      ))}
    </div>
  );
}
