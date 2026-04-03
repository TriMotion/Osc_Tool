"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { Preset, OscArg } from "@/lib/types";

interface PresetCardProps {
  preset: Preset;
  onSend: (address: string, args: OscArg[]) => void;
  onUpdate: (id: string, updates: Partial<Omit<Preset, "id">>) => void;
  onRemove: (id: string) => void;
}

export function PresetCard({ preset, onSend, onUpdate, onRemove }: PresetCardProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(preset.name);
  const [address, setAddress] = useState(preset.address);
  const [args, setArgs] = useState<OscArg[]>(preset.args);

  const handleSave = () => {
    onUpdate(preset.id, { name, address, args });
    setEditing(false);
  };

  const handleCancel = () => {
    setName(preset.name);
    setAddress(preset.address);
    setArgs(preset.args);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="bg-surface-lighter border border-accent/20 rounded-xl p-4 flex flex-col gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Preset name"
          className="bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
        />
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="/osc/address"
          className="bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent/50"
        />
        {args.map((arg, i) => (
          <div key={i} className="flex gap-2">
            <select
              value={arg.type}
              onChange={(e) => {
                const next = [...args];
                next[i] = { ...next[i], type: e.target.value as OscArg["type"] };
                setArgs(next);
              }}
              className="bg-surface border border-white/10 rounded-lg px-2 py-2 text-sm w-24"
            >
              <option value="f">Float</option>
              <option value="i">Int</option>
              <option value="s">String</option>
              <option value="T">True</option>
              <option value="F">False</option>
            </select>
            {arg.type !== "T" && arg.type !== "F" && (
              <input
                type={arg.type === "s" ? "text" : "number"}
                value={arg.value}
                onChange={(e) => {
                  const next = [...args];
                  next[i] = {
                    ...next[i],
                    value: arg.type === "s" ? e.target.value : Number(e.target.value),
                  };
                  setArgs(next);
                }}
                className="flex-1 bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono"
              />
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <button onClick={handleSave} className="px-3 py-1.5 text-sm bg-accent text-surface rounded-lg font-medium">
            Save
          </button>
          <button onClick={handleCancel} className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      layout
      className="bg-surface-lighter border border-white/5 rounded-xl p-4 flex items-center justify-between group hover:border-white/10 transition-colors"
    >
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{preset.name}</span>
        <span className="text-xs font-mono text-accent">{preset.address}</span>
        <span className="text-xs text-gray-500">
          {preset.args.map((a) => `${a.value} (${a.type})`).join(", ")}
        </span>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setEditing(true)}
          className="px-2 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          Edit
        </button>
        <button
          onClick={() => onRemove(preset.id)}
          className="px-2 py-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
        >
          Delete
        </button>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => onSend(preset.address, preset.args)}
          className="px-3 py-1.5 text-sm bg-accent text-surface rounded-lg font-medium"
        >
          Send
        </motion.button>
      </div>
    </motion.div>
  );
}
