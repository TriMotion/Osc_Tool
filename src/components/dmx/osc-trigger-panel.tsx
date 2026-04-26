"use client";

import { useState } from "react";
import type { OscDmxTrigger, DmxEffect } from "@/lib/dmx-types";

interface OscTriggerPanelProps {
  triggers: OscDmxTrigger[];
  effects: DmxEffect[];
  sections: import("@/lib/types").TimelineSection[];
  onSave: (trigger: OscDmxTrigger) => void;
  onDelete: (id: string) => void;
}

function emptyTrigger(): OscDmxTrigger {
  return { id: "", name: "", oscAddress: "", mode: "match-only", dmxEffectId: "", dmxChannels: [], inputMin: 0, inputMax: 1, outputMin: 0, outputMax: 255, sectionId: undefined };
}

export function OscTriggerPanel({ triggers, effects, sections, onSave, onDelete }: OscTriggerPanelProps) {
  const [editing, setEditing] = useState<OscDmxTrigger | null>(null);

  const startEdit = (t?: OscDmxTrigger) => setEditing(t ? { ...t } : emptyTrigger());

  const handleSave = () => {
    if (!editing) return;
    onSave(editing);
    setEditing(null);
  };

  if (editing) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white">{editing.id ? "Edit" : "Add"} OSC → DMX Trigger</h3>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Name</label>
          <input
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">OSC Address</label>
          <input
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white font-mono"
            placeholder="/cue/go"
            value={editing.oscAddress}
            onChange={(e) => setEditing({ ...editing, oscAddress: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Mode</label>
          <div className="flex gap-1">
            {(["match-only", "passthrough"] as const).map((m) => (
              <button
                key={m}
                className="flex-1 text-xs py-1 rounded border"
                style={{
                  background: editing.mode === m ? "rgba(245,158,11,0.15)" : "#1a1a2e",
                  borderColor: editing.mode === m ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.08)",
                  color: editing.mode === m ? "#fcd34d" : "#9ca3af",
                }}
                onClick={() => setEditing({ ...editing, mode: m })}
              >
                {m === "match-only" ? "Match Only" : "Passthrough"}
              </button>
            ))}
          </div>
        </div>

        {editing.mode === "match-only" && (
          <div>
            <label className="block text-[10px] uppercase text-gray-500 mb-1">Effect</label>
            <select
              className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
              value={editing.dmxEffectId ?? ""}
              onChange={(e) => setEditing({ ...editing, dmxEffectId: e.target.value })}
            >
              <option value="">None</option>
              {effects.map((eff) => (
                <option key={eff.id} value={eff.id}>{eff.name}</option>
              ))}
            </select>
          </div>
        )}

        {editing.mode === "passthrough" && (
          <>
            <div>
              <label className="block text-[10px] uppercase text-gray-500 mb-1">DMX Channels (comma-separated)</label>
              <input
                className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
                value={(editing.dmxChannels ?? []).join(", ")}
                onChange={(e) => {
                  const channels = e.target.value.split(",").map((s) => parseInt(s.trim())).filter((n) => n >= 1 && n <= 512);
                  setEditing({ ...editing, dmxChannels: channels });
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Input Min</label>
                <input type="number" step="0.01"
                  className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
                  value={editing.inputMin ?? 0}
                  onChange={(e) => setEditing({ ...editing, inputMin: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Input Max</label>
                <input type="number" step="0.01"
                  className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
                  value={editing.inputMax ?? 1}
                  onChange={(e) => setEditing({ ...editing, inputMax: parseFloat(e.target.value) || 1 })}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Output Min (DMX)</label>
                <input type="number" min={0} max={255}
                  className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
                  value={editing.outputMin ?? 0}
                  onChange={(e) => setEditing({ ...editing, outputMin: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Output Max (DMX)</label>
                <input type="number" min={0} max={255}
                  className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
                  value={editing.outputMax ?? 255}
                  onChange={(e) => setEditing({ ...editing, outputMax: parseInt(e.target.value) || 255 })}
                />
              </div>
            </div>
          </>
        )}

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Section</label>
          <select
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={editing.sectionId ?? ""}
            onChange={(e) => setEditing({ ...editing, sectionId: e.target.value || undefined })}
          >
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button className="px-3 py-1 rounded bg-output hover:bg-output-dim text-white text-xs" onClick={handleSave}>Save</button>
          <button className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">OSC → DMX Triggers</h3>
        <button className="text-xs text-output hover:text-output-dim" onClick={() => startEdit()}>+ Add</button>
      </div>
      {triggers.length === 0 && <p className="text-xs text-gray-600">No triggers configured</p>}
      {triggers.map((t) => (
        <div key={t.id} className="flex items-center justify-between bg-[#1a1a2e] rounded px-3 py-2 border border-white/5">
          <div>
            <div className="text-xs text-white">{t.name || t.oscAddress}</div>
            <div className="text-[9px] text-gray-500">
              {t.oscAddress} · {t.mode}
              {t.sectionId && sections.find((s) => s.id === t.sectionId) && (
                <span> · <span className="text-output/60">{sections.find((s) => s.id === t.sectionId)!.name}</span></span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="text-[10px] text-gray-400 hover:text-white" onClick={() => startEdit(t)}>Edit</button>
            <button className="text-[10px] text-red-400/60 hover:text-red-400" onClick={() => onDelete(t.id)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
