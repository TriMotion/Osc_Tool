"use client";

import { useState } from "react";
import type { OscEffectTrigger, SavedEndpoint, TimelineSection } from "@/lib/types";
import type { OscEffect } from "@/lib/osc-effect-types";

interface OscEffectTriggerPanelProps {
  triggers: OscEffectTrigger[];
  effects: OscEffect[];
  endpoints: SavedEndpoint[];
  sections: TimelineSection[];
  onSave: (trigger: OscEffectTrigger) => void;
  onDelete: (id: string) => void;
}

function emptyTrigger(): OscEffectTrigger {
  return { id: "", name: "", oscAddress: "", oscEffectId: "", endpointId: "", targetAddress: "", argType: "f" };
}

export function OscEffectTriggerPanel({ triggers, effects, endpoints, sections, onSave, onDelete }: OscEffectTriggerPanelProps) {
  const [editing, setEditing] = useState<OscEffectTrigger | null>(null);
  const senderEndpoints = endpoints.filter((ep) => ep.type === "sender");

  const startEdit = (t?: OscEffectTrigger) => setEditing(t ? { ...t } : emptyTrigger());

  const handleSave = () => {
    if (!editing) return;
    onSave(editing);
    setEditing(null);
  };

  if (editing) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white">{editing.id ? "Edit" : "Add"} OSC → Effect Trigger</h3>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Name</label>
          <input
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">OSC Address (incoming)</label>
          <input
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white font-mono"
            placeholder="/cue/go"
            value={editing.oscAddress}
            onChange={(e) => setEditing({ ...editing, oscAddress: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">OSC Effect</label>
          <select
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={editing.oscEffectId}
            onChange={(e) => setEditing({ ...editing, oscEffectId: e.target.value })}
          >
            <option value="">None</option>
            {effects.map((eff) => (
              <option key={eff.id} value={eff.id}>{eff.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Target Endpoint</label>
          <select
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
            value={editing.endpointId}
            onChange={(e) => setEditing({ ...editing, endpointId: e.target.value })}
          >
            <option value="">Select endpoint</option>
            {senderEndpoints.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.name} ({ep.host}:{ep.port})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] uppercase text-gray-500 mb-1">Target Address (output)</label>
          <input
            className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white font-mono"
            placeholder="/composition/opacity"
            value={editing.targetAddress}
            onChange={(e) => setEditing({ ...editing, targetAddress: e.target.value })}
          />
        </div>

        <div className="flex gap-3">
          <div>
            <label className="block text-[10px] uppercase text-gray-500 mb-1">Arg Type</label>
            <div className="flex gap-1">
              {(["f", "i"] as const).map((t) => (
                <button
                  key={t}
                  className="px-3 py-1 text-xs rounded border"
                  style={{
                    background: editing.argType === t ? "rgba(59,130,246,0.15)" : "#1a1a2e",
                    borderColor: editing.argType === t ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.08)",
                    color: editing.argType === t ? "#93c5fd" : "#9ca3af",
                  }}
                  onClick={() => setEditing({ ...editing, argType: t })}
                >
                  {t === "f" ? "Float" : "Int"}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer self-end pb-1">
            <input
              type="checkbox"
              checked={editing.velocityFromValue ?? false}
              onChange={(e) => setEditing({ ...editing, velocityFromValue: e.target.checked })}
              className="accent-blue-500"
            />
            <span className="text-xs text-gray-300">Velocity from Value</span>
          </label>
        </div>

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
          <button className="px-3 py-1 rounded bg-blue-500 hover:bg-blue-400 text-black text-xs font-medium" onClick={handleSave}>Save</button>
          <button className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">OSC → Effect Triggers</h3>
        <button className="text-xs text-blue-400 hover:text-blue-300" onClick={() => startEdit()}>+ Add</button>
      </div>
      {triggers.length === 0 && <p className="text-xs text-gray-600">No triggers configured</p>}
      {triggers.map((t) => {
        const effectName = effects.find((e) => e.id === t.oscEffectId)?.name ?? "—";
        const sectionName = sections.find((s) => s.id === t.sectionId)?.name;
        return (
          <div key={t.id} className="flex items-center justify-between bg-[#1a1a2e] rounded px-3 py-2 border border-white/5">
            <div>
              <div className="text-xs text-white">{t.name || t.oscAddress}</div>
              <div className="text-[9px] text-gray-500">
                {t.oscAddress} → {effectName}
                {sectionName && <span> · <span className="text-blue-400/60">{sectionName}</span></span>}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="text-[10px] text-gray-400 hover:text-white" onClick={() => startEdit(t)}>Edit</button>
              <button className="text-[10px] text-red-400/60 hover:text-red-400" onClick={() => onDelete(t.id)}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
