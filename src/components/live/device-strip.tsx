"use client";

import { useFlash } from "@/hooks/use-flash";
import type { DeviceActivity } from "@/hooks/use-live-monitor";

const AUTO = "__auto__";

interface DeviceCardProps {
  name: string;
  activity: DeviceActivity | undefined;
  aliases?: Record<string, string>;
  unlinked?: boolean;
  recordingDevices?: string[];
  liveSources?: string[];
  currentLiveSource?: string | null;
  onSetSource?: (recordingName: string, liveSource: string | null) => void;
  onLink?: (liveName: string, recordingName: string) => void;
}

function DeviceCard({
  name,
  activity,
  aliases,
  unlinked,
  recordingDevices,
  liveSources,
  currentLiveSource,
  onSetSource,
  onLink,
}: DeviceCardProps) {
  const displayName = aliases?.[name] ?? name;
  const midiFlashing = useFlash(activity?.lastMidiAt ?? 0);
  const oscFlashing = useFlash(activity?.lastOscAt ?? 0);

  return (
    <div
      className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-lg min-w-[160px] ${
        unlinked
          ? "bg-amber-950/20 border border-amber-400/20"
          : "bg-surface-light border border-white/5"
      }`}
      title={unlinked ? `${name}\n(Live MIDI port not linked to a recording device)` : name}
    >
      <span
        className={`text-xs font-medium truncate max-w-[200px] ${
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

      {/* Recording-device card: source dropdown */}
      {!unlinked && liveSources !== undefined && onSetSource && (
        <select
          value={currentLiveSource ?? AUTO}
          onChange={(e) => {
            const v = e.target.value;
            onSetSource(name, v === AUTO ? null : v);
          }}
          className="text-[10px] bg-surface border border-white/10 rounded px-1.5 py-0.5 text-gray-400 w-full"
          title="Which live MIDI port feeds this recording device"
        >
          <option value={AUTO}>Source: auto (by name)</option>
          {liveSources.map((src) => (
            <option key={src} value={src}>
              Source: {src}
            </option>
          ))}
        </select>
      )}

      {/* Live-only card: link-to dropdown */}
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
  connectedLivePorts?: string[];
  onUpdateLinks?: (links: Record<string, string>) => void;
}

export function DeviceStrip({
  devices,
  deviceActivity,
  aliases,
  liveDeviceLinks,
  connectedLivePorts,
  onUpdateLinks,
}: DeviceStripProps) {
  const links = liveDeviceLinks ?? {};
  const recordingSet = new Set(devices);

  // All live-side port names we know about: from the bridge (connected, even if silent)
  // and from activity (in case a port was removed but is still in the current session).
  const allLivePorts = Array.from(
    new Set([...(connectedLivePorts ?? []), ...Object.keys(deviceActivity)]),
  );
  const allLivePortsSet = new Set(allLivePorts);

  // Inverse lookup: recording device name → live port that's linked to it (if any).
  const liveSourceForRecording = (rec: string): string | null => {
    for (const [live, target] of Object.entries(links)) {
      if (target === rec) return live;
    }
    // No explicit link — but if a live port has the same name, that's the effective source.
    return allLivePortsSet.has(rec) ? rec : null;
  };

  // Live ports that aren't (a) a recording device by name and (b) explicitly linked elsewhere.
  const linkedPortsSet = new Set(Object.keys(links));
  const unlinkedLivePorts = allLivePorts.filter(
    (p) => !recordingSet.has(p) && !linkedPortsSet.has(p),
  );

  const handleSetSource = (rec: string, live: string | null) => {
    if (!onUpdateLinks) return;
    const next: Record<string, string> = { ...links };
    // Remove any existing link pointing to this recording device.
    for (const [livePort, target] of Object.entries(next)) {
      if (target === rec) delete next[livePort];
    }
    // If the chosen source is a live port that doesn't match rec by name, record the link.
    if (live !== null && live !== rec) {
      next[live] = rec;
    }
    onUpdateLinks(next);
  };

  const handleLink = (liveName: string, recordingName: string) => {
    if (!onUpdateLinks) return;
    const next: Record<string, string> = { ...links };
    // Replace any prior source for the same recording device.
    for (const [livePort, target] of Object.entries(next)) {
      if (target === recordingName) delete next[livePort];
    }
    next[liveName] = recordingName;
    onUpdateLinks(next);
  };

  if (devices.length === 0 && unlinkedLivePorts.length === 0) {
    return (
      <div className="flex items-center px-4 py-3 text-sm text-gray-500 border-b border-white/5">
        No devices in recording
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 overflow-x-auto shrink-0">
      {devices.map((rec) => (
        <DeviceCard
          key={`rec:${rec}`}
          name={rec}
          activity={deviceActivity[rec]}
          aliases={aliases}
          liveSources={allLivePorts}
          currentLiveSource={liveSourceForRecording(rec)}
          onSetSource={handleSetSource}
        />
      ))}
      {unlinkedLivePorts.map((live) => (
        <DeviceCard
          key={`live:${live}`}
          name={live}
          activity={deviceActivity[live]}
          aliases={aliases}
          unlinked
          recordingDevices={devices}
          onLink={handleLink}
        />
      ))}
    </div>
  );
}
