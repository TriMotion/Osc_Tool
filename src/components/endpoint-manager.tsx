"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SavedEndpoint } from "@/lib/types";

interface EndpointManagerProps {
  type: "listener" | "sender";
  endpoints: SavedEndpoint[];
  activeIds: Set<string>;
  onAdd: (endpoint: Omit<SavedEndpoint, "id">) => Promise<void>;
  onUpdate: (id: string, updates: Partial<Omit<SavedEndpoint, "id">>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggle: (endpoint: SavedEndpoint) => void;
  accent: "input" | "output";
}

const DEFAULTS: Record<"listener" | "sender", { host: string; port: number }> = {
  listener: { host: "0.0.0.0", port: 9000 },
  sender: { host: "127.0.0.1", port: 8000 },
};

export function EndpointManager({
  type,
  endpoints,
  activeIds,
  onAdd,
  onUpdate,
  onDelete,
  onToggle,
  accent,
}: EndpointManagerProps) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", host: "", port: "" });

  const accentText = accent === "input" ? "text-input" : "text-output";
  const accentBg = accent === "input" ? "bg-input" : "bg-output";
  const accentBorder = accent === "input" ? "border-input/30" : "border-output/30";
  const accentBgSoft = accent === "input" ? "bg-input/10" : "bg-output/10";
  const accentFocus = accent === "input" ? "focus:border-input/40" : "focus:border-output/40";
  const label = type === "listener" ? "Listener" : "Sender";

  const handleStartCreate = () => {
    const d = DEFAULTS[type];
    setDraft({ name: `New ${label}`, host: d.host, port: String(d.port) });
    setCreating(true);
    setEditingId(null);
  };

  const handleCreate = async () => {
    const port = parseInt(draft.port, 10);
    if (!draft.name.trim() || !draft.host.trim() || isNaN(port) || port < 1 || port > 65535) return;
    await onAdd({ name: draft.name.trim(), host: draft.host.trim(), port, type });
    setCreating(false);
  };

  const handleStartEdit = (ep: SavedEndpoint) => {
    setDraft({ name: ep.name, host: ep.host, port: String(ep.port) });
    setEditingId(ep.id);
    setCreating(false);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const port = parseInt(draft.port, 10);
    if (!draft.name.trim() || !draft.host.trim() || isNaN(port) || port < 1 || port > 65535) return;
    await onUpdate(editingId, { name: draft.name.trim(), host: draft.host.trim(), port });
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setCreating(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent, save: () => void) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") handleCancelEdit();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{label}s</h3>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleStartCreate}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${accentBg} text-black hover:opacity-90 transition-opacity`}
        >
          + Create {label}
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className={`rounded-lg border ${accentBorder} p-3 flex flex-col gap-2 ${accentBgSoft}`}>
              <div className="grid grid-cols-[1fr_1fr_80px] gap-2">
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 mb-1">Name</label>
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    onKeyDown={(e) => handleKeyDown(e, handleCreate)}
                    className={`w-full bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none ${accentFocus}`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 mb-1">
                    {type === "listener" ? "Bind Address" : "Host"}
                  </label>
                  <input
                    value={draft.host}
                    onChange={(e) => setDraft((d) => ({ ...d, host: e.target.value }))}
                    onKeyDown={(e) => handleKeyDown(e, handleCreate)}
                    className={`w-full bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none ${accentFocus}`}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 mb-1">Port</label>
                  <input
                    value={draft.port}
                    onChange={(e) => setDraft((d) => ({ ...d, port: e.target.value }))}
                    onKeyDown={(e) => handleKeyDown(e, handleCreate)}
                    className={`w-full bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none ${accentFocus}`}
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1 rounded text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  className={`px-3 py-1 rounded text-xs font-medium ${accentBg} text-black hover:opacity-90`}
                >
                  Create
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {endpoints.length === 0 && !creating && (
        <div className="text-center py-6 text-xs text-gray-600">
          No {type}s configured. Create one to get started.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {endpoints.map((ep) => {
            const isActive = activeIds.has(ep.id);
            const isEditing = editingId === ep.id;

            return (
              <motion.div
                key={ep.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={`rounded-lg border transition-colors ${
                  isActive
                    ? `${accentBorder} ${accentBgSoft}`
                    : "border-white/5 bg-elevated"
                }`}
              >
                {isEditing ? (
                  <div className="p-3 flex flex-col gap-2">
                    <div className="grid grid-cols-[1fr_1fr_80px] gap-2">
                      <div>
                        <label className="block text-[10px] uppercase text-gray-500 mb-1">Name</label>
                        <input
                          autoFocus
                          value={draft.name}
                          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                          onKeyDown={(e) => handleKeyDown(e, handleSaveEdit)}
                          className={`w-full bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-sm text-white focus:outline-none ${accentFocus}`}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase text-gray-500 mb-1">
                          {type === "listener" ? "Bind Address" : "Host"}
                        </label>
                        <input
                          value={draft.host}
                          onChange={(e) => setDraft((d) => ({ ...d, host: e.target.value }))}
                          onKeyDown={(e) => handleKeyDown(e, handleSaveEdit)}
                          className={`w-full bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none ${accentFocus}`}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase text-gray-500 mb-1">Port</label>
                        <input
                          value={draft.port}
                          onChange={(e) => setDraft((d) => ({ ...d, port: e.target.value }))}
                          onKeyDown={(e) => handleKeyDown(e, handleSaveEdit)}
                          className={`w-full bg-black/50 border border-white/10 rounded px-2.5 py-1.5 text-sm text-white font-mono focus:outline-none ${accentFocus}`}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-1 rounded text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        className={`px-3 py-1 rounded text-xs font-medium ${accentBg} text-black hover:opacity-90`}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`flex items-center gap-3 px-4 py-3 group ${!isActive ? "opacity-50" : ""}`}>
                    {/* Status dot */}
                    <div
                      className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all ${
                        isActive
                          ? `${accentBg} shadow-[0_0_8px] ${accent === "input" ? "shadow-input/60" : "shadow-output/60"}`
                          : "bg-gray-700 border border-gray-600"
                      }`}
                    />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${isActive ? "text-white" : "text-gray-500"}`}>
                        {ep.name}
                      </div>
                      <div className={`text-xs font-mono ${isActive ? "text-gray-400" : "text-gray-600"}`}>
                        {ep.host}:{ep.port}
                      </div>
                    </div>

                    {/* Status label */}
                    {!isActive && (
                      <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">
                        Inactive
                      </span>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => onToggle(ep)}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          isActive
                            ? "bg-white/10 text-white hover:bg-red-500/20 hover:text-red-400"
                            : `${accentBgSoft} ${accentText} hover:opacity-80`
                        }`}
                      >
                        {isActive ? "Stop" : "Start"}
                      </motion.button>
                      <button
                        onClick={() => handleStartEdit(ep)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-gray-200 transition-all"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onDelete(ep.id)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-red-400 transition-all"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
