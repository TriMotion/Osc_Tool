"use client";

import { useFlash } from "@/hooks/use-flash";
import type { DeviceActivity } from "@/hooks/use-live-monitor";

interface DeviceCardProps {
  name: string;
  activity: DeviceActivity | undefined;
  aliases?: Record<string, string>;
  unlinked?: boolean;
  recordingDevices?: string[];
  onLink?: (liveName: string, recordingName: string) => void;
}

function DeviceCard({ name, activity, aliases, unlinked, recordingDevices, onLink }: DeviceCardProps) {
  const displayName = aliases?.[name] ?? name;
  const midiFlashing = useFlash(activity?.lastMidiAt ?? 0);
  const oscFlashing = useFlash(activity?.lastOscAt ?? 0);

  return (
    <div
      className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-lg min-w-[140px] ${
        unlinked
          ? "bg-amber-950/20 border border-amber-400/20"
          : "bg-surface-light border border-white/5"
      }`}
      title={unlinked ? `${name}\n(Live MIDI port not in recording — link it to route mappings)` : name}
    >
      <span
        className={`text-xs font-medium truncate max-w-[180px] ${
          unlinked ? "text-amber-200" : "text-gray-300"
        }`}
      >
        {displayName}
        {unlinked && <span className="ml-1 text-[10px] text-amber-400/80">(unlinked)</span>}
      </span>
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
      {unlinked && recordingDevices && recordingDevices.length > 0 && onLink && (
        <select
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            onLink(name, e.target.value);
          }}
          className="text-[10px] bg-surface border border-white/10 rounded px-1.5 py-0.5 text-gray-400 w-full"
          title="Route this live port to a recording device so its mappings fire"
        >
          <option value="">Link to…</option>
          {recordingDevices.map((rd) => (
            <option key={rd} value={rd}>
              {aliases?.[rd] ?? rd}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

interface DeviceStripProps {
  devices: string[];
  deviceActivity: Record<string, DeviceActivity>;
  aliases?: Record<string, string>;
  liveDeviceLinks?: Record<string, string>;
  onLinkDevice?: (liveName: string, recordingName: string) => void;
}

export function DeviceStrip({
  devices,
  deviceActivity,
  aliases,
  liveDeviceLinks,
  onLinkDevice,
}: DeviceStripProps) {
  const recordingSet = new Set(devices);
  const linkedLive = new Set(Object.keys(liveDeviceLinks ?? {}));
  // Live-only cards: devices that sent MIDI but aren't in the recording AND
  // aren't already linked to a recording device.
  const liveOnly = Object.keys(deviceActivity).filter(
    (d) => !recordingSet.has(d) && !linkedLive.has(d),
  );
  const all = [
    ...devices.map((d) => ({ name: d, unlinked: false })),
    ...liveOnly.map((d) => ({ name: d, unlinked: true })),
  ];

  if (all.length === 0) {
    return (
      <div className="flex items-center px-4 py-3 text-sm text-gray-500 border-b border-white/5">
        No devices in recording
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 overflow-x-auto shrink-0">
      {all.map(({ name, unlinked }) => (
        <DeviceCard
          key={name}
          name={name}
          activity={deviceActivity[name]}
          aliases={aliases}
          unlinked={unlinked}
          recordingDevices={unlinked ? devices : undefined}
          onLink={unlinked ? onLinkDevice : undefined}
        />
      ))}
    </div>
  );
}
