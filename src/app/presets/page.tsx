"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PresetCard } from "@/components/preset-card";
import { OscInput } from "@/components/osc-input";
import { usePresets, useOscSender } from "@/hooks/use-osc";
import type { OscArg } from "@/lib/types";

export default function PresetsPage() {
  const { presets, add, update, remove, exportAll, importPresets } = usePresets();
  const { send } = useOscSender();
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("8000");
  const [showAdd, setShowAdd] = useState(false);
  const [presetName, setPresetName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = async (address: string, args: OscArg[]) => {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum)) return;
    await send({ host, port: portNum }, address, args);
  };

  const handleAdd = async (address: string, args: OscArg[]) => {
    if (!presetName.trim()) return;
    await add({ name: presetName, address, args });
    setPresetName("");
    setShowAdd(false);
  };

  const handleExport = async () => {
    const json = await exportAll();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "osc-presets.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const json = await file.text();
    await importPresets(json);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Presets</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-4">
            <label className="text-xs text-gray-500">Target:</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="bg-surface-lighter border border-white/10 rounded-lg px-2 py-1 text-xs w-28"
            />
            <span className="text-gray-600">:</span>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="bg-surface-lighter border border-white/10 rounded-lg px-2 py-1 text-xs w-16"
            />
          </div>
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-xs bg-surface-lighter border border-white/10 rounded-lg text-gray-400 hover:text-gray-200"
          >
            Export
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs bg-surface-lighter border border-white/10 rounded-lg text-gray-400 hover:text-gray-200"
          >
            Import
          </button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowAdd(!showAdd)}
            className="px-3 py-1.5 text-sm bg-accent text-surface rounded-lg font-medium"
          >
            + New Preset
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-surface-light rounded-xl border border-accent/20 p-4 flex flex-col gap-3 overflow-hidden"
          >
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
            />
            <OscInput onSend={handleAdd} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-2">
        <AnimatePresence>
          {presets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              onSend={handleSend}
              onUpdate={update}
              onRemove={remove}
            />
          ))}
        </AnimatePresence>
        {presets.length === 0 && !showAdd && (
          <div className="text-center text-gray-600 py-12">
            No presets yet. Create one to get started.
          </div>
        )}
      </div>
    </div>
  );
}
