"use client";

import { useState, useEffect } from "react";
import type { SacnConfig } from "@/lib/dmx-types";

interface DmxSettingsProps {
  config: SacnConfig;
  onSave: (config: SacnConfig) => void;
}

export function DmxSettings({ config, onSave }: DmxSettingsProps) {
  const [universe, setUniverse] = useState(config.universe);
  const [iface, setIface] = useState(config.networkInterface ?? "");
  const [enabled, setEnabled] = useState(config.enabled);

  useEffect(() => {
    setUniverse(config.universe);
    setIface(config.networkInterface ?? "");
    setEnabled(config.enabled);
  }, [config]);

  const handleSave = () => {
    onSave({
      universe,
      networkInterface: iface || undefined,
      enabled,
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-white">sACN / DMX Settings</h3>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => { setEnabled(e.target.checked); }}
          className="accent-output"
        />
        <span className="text-sm text-gray-300">Enable sACN Output</span>
      </label>

      <div>
        <label className="block text-[10px] uppercase text-gray-500 mb-1">Universe</label>
        <input
          type="number" min={1} max={63999}
          className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
          value={universe}
          onChange={(e) => setUniverse(parseInt(e.target.value) || 7)}
        />
      </div>

      <div>
        <label className="block text-[10px] uppercase text-gray-500 mb-1">Network Interface (optional)</label>
        <input
          className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
          placeholder="e.g. 10.0.0.2"
          value={iface}
          onChange={(e) => setIface(e.target.value)}
        />
        <p className="text-[9px] text-gray-600 mt-1">Leave empty for default interface</p>
      </div>

      <button
        className="px-4 py-1.5 rounded bg-output hover:bg-output-dim text-white text-sm"
        onClick={handleSave}
      >
        Save & Apply
      </button>
    </div>
  );
}
