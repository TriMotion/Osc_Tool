"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { OscArg } from "@/lib/types";

interface OscInputProps {
  onSend: (address: string, args: OscArg[]) => void;
  initialAddress?: string;
  initialArgs?: OscArg[];
}

const typeLabels: Record<OscArg["type"], string> = {
  f: "Float",
  i: "Int",
  s: "String",
  T: "True",
  F: "False",
};

export function OscInput({ onSend, initialAddress = "", initialArgs }: OscInputProps) {
  const [address, setAddress] = useState(initialAddress);
  const [args, setArgs] = useState<OscArg[]>(
    initialArgs ?? [{ type: "f", value: 0 }]
  );

  const updateArg = (index: number, updates: Partial<OscArg>) => {
    setArgs((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...updates } : a))
    );
  };

  const addArg = () => {
    setArgs((prev) => [...prev, { type: "f", value: 0 }]);
  };

  const removeArg = (index: number) => {
    setArgs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if (!address.startsWith("/")) return;
    onSend(address, args);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      handleSend();
    }
  };

  return (
    <div className="flex flex-col gap-3" onKeyDown={handleKeyDown}>
      <div>
        <label className="block text-xs text-gray-500 mb-1">OSC Address</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="/example/address"
          className="w-full bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent/50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs text-gray-500">Arguments</label>
        {args.map((arg, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={arg.type}
              onChange={(e) => updateArg(i, { type: e.target.value as OscArg["type"] })}
              className="bg-surface-lighter border border-white/10 rounded-lg px-2 py-2 text-sm w-24 focus:outline-none focus:border-accent/50"
            >
              {Object.entries(typeLabels).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
            {arg.type !== "T" && arg.type !== "F" && (
              <input
                type={arg.type === "s" ? "text" : "number"}
                value={arg.value as string | number}
                onChange={(e) =>
                  updateArg(i, {
                    value: arg.type === "s" ? e.target.value : Number(e.target.value),
                  })
                }
                step={arg.type === "f" ? "0.01" : "1"}
                className="flex-1 bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent/50"
              />
            )}
            {args.length > 1 && (
              <button
                onClick={() => removeArg(i)}
                className="text-gray-500 hover:text-red-400 transition-colors text-sm px-2"
              >
                x
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addArg}
          className="text-xs text-gray-500 hover:text-accent transition-colors self-start"
        >
          + Add argument
        </button>
      </div>

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={handleSend}
        disabled={!address.startsWith("/")}
        className="px-4 py-2 bg-accent text-surface font-medium rounded-lg text-sm hover:bg-accent-dim transition-colors disabled:opacity-30 disabled:cursor-not-allowed self-start"
      >
        Send (Cmd+Enter)
      </motion.button>
    </div>
  );
}
