"use client";

import { useState } from "react";
import { useEndpoints } from "@/hooks/use-osc";
import type { SavedEndpoint } from "@/lib/types";

interface EndpointPickerProps {
  type: "listener" | "sender";
  currentHost: string;
  currentPort: string;
  onSelect: (host: string, port: string) => void;
}

export function EndpointPicker({ type, currentHost, currentPort, onSelect }: EndpointPickerProps) {
  const { endpoints, add, remove, update } = useEndpoints(type);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleSave = async () => {
    if (!newName.trim()) return;
    await add({
      name: newName,
      host: currentHost,
      port: parseInt(currentPort, 10),
      type,
    });
    setNewName("");
    setSaving(false);
  };

  const handleStartEdit = (ep: SavedEndpoint) => {
    setEditingId(ep.id);
    setEditName(ep.name);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) return;
    await update(id, { name: editName });
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 font-medium">Saved {type === "listener" ? "Listeners" : "Targets"}</span>
        <button
          onClick={() => setSaving(!saving)}
          className="text-xs text-gray-500 hover:text-accent transition-colors"
        >
          {saving ? "Cancel" : "+ Save current"}
        </button>
      </div>

      {saving && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="Name this endpoint..."
            autoFocus
            className="flex-1 bg-surface border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
          />
          <button
            onClick={handleSave}
            className="px-2 py-1 text-xs bg-accent text-surface rounded-lg font-medium"
          >
            Save
          </button>
        </div>
      )}

      {endpoints.length > 0 && (
        <div className="flex flex-col gap-1">
          {endpoints.map((ep) => (
            <div
              key={ep.id}
              className="flex items-center gap-2 bg-surface-lighter border border-white/5 rounded-lg px-3 py-1.5 group hover:border-white/10 transition-colors"
            >
              {editingId === ep.id ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit(ep.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => handleSaveEdit(ep.id)}
                  autoFocus
                  className="flex-1 bg-surface border border-accent/30 rounded px-1 py-0.5 text-xs focus:outline-none"
                />
              ) : (
                <button
                  onClick={() => onSelect(ep.host, String(ep.port))}
                  className="flex-1 text-left text-xs"
                >
                  <span className="text-gray-200 font-medium">{ep.name}</span>
                  <span className="text-gray-500 ml-2">{ep.host}:{ep.port}</span>
                </button>
              )}
              <button
                onClick={() => handleStartEdit(ep)}
                className="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-gray-200 transition-all"
              >
                edit
              </button>
              <button
                onClick={() => remove(ep.id)}
                className="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-red-400 transition-all"
              >
                del
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
