"use client";

import { useState } from "react";
import type { OscMapping, OscPreset, OscTrigger, SavedEndpoint, TimelineSection } from "@/lib/types";
import { resolveOscAddress } from "@/lib/osc-mapping";

interface OscMappingEditorProps {
  targetType: "noteGroup" | "lane";
  targetId: string;
  deviceId: string;
  mappings: OscMapping[];
  endpoints: SavedEndpoint[];
  defaultEndpointId: string | undefined;
  sections: TimelineSection[];
  deviceAliases?: Record<string, string>;
  editingMapping?: OscMapping;
  anchorRect: DOMRect;
  onAdd: (mapping: OscMapping) => void;
  onUpdate?: (mapping: OscMapping) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function OscMappingEditor({
  targetType, targetId, deviceId, mappings, endpoints, defaultEndpointId,
  sections, deviceAliases, editingMapping, anchorRect, onAdd, onUpdate, onDelete, onClose,
}: OscMappingEditorProps) {
  const [endpointId, setEndpointId] = useState(editingMapping?.endpointId ?? defaultEndpointId ?? endpoints[0]?.id ?? "");
  const [preset, setPreset] = useState<OscPreset>(editingMapping?.preset ?? "custom");
  const [trigger, setTrigger] = useState<OscTrigger>(editingMapping?.trigger ?? "on");
  const [argType, setArgType] = useState<"f" | "i">(editingMapping?.argType ?? "f");
  // custom
  const [address, setAddress] = useState(editingMapping?.address ?? "/");
  // unreal
  const [sectionName, setSectionName] = useState(editingMapping?.sectionName ?? sections[0]?.name ?? "");
  const [unrealType, setUnrealType] = useState<"parameter" | "trigger">(editingMapping?.unrealType ?? "parameter");
  const [unrealName, setUnrealName] = useState(editingMapping?.unrealName ?? "");
  // resolume
  const [resolumeMode, setResolumeMode] = useState<"column" | "clip">(editingMapping?.resolumeMode ?? "column");
  const [resolumeColumn, setResolumeColumn] = useState(editingMapping?.resolumeColumn ?? 1);
  const [resolumeLayer, setResolumeLayer] = useState(editingMapping?.resolumeLayer ?? 1);
  const [resolumeClip, setResolumeClip] = useState(editingMapping?.resolumeClip ?? 1);

  const previewMapping: OscMapping = {
    id: "preview",
    targetType, targetId, deviceId, endpointId,
    preset, trigger, argType, address,
    sectionName,
    unrealType, unrealName,
    resolumeMode, resolumeColumn, resolumeLayer, resolumeClip,
  };
  const preview = resolveOscAddress(previewMapping, deviceAliases);

  const handleAdd = () => {
    if (!endpointId) return;
    onAdd({
      id: crypto.randomUUID(),
      targetType, targetId, deviceId, endpointId,
      preset, trigger, argType, address,
      sectionName,
      unrealType, unrealName: unrealName || "param",
      resolumeMode, resolumeColumn, resolumeLayer, resolumeClip,
    });
  };

  const handleSave = () => {
    if (!editingMapping || !endpointId) return;
    onUpdate?.({
      ...editingMapping,
      endpointId, preset, trigger, argType, address,
      sectionName, unrealType, unrealName: unrealName || "param",
      resolumeMode, resolumeColumn, resolumeLayer, resolumeClip,
    });
  };

  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 480);
  const left = Math.min(anchorRect.left, window.innerWidth - 300);

  return (
    <div
      className="fixed z-50 bg-surface-light border border-white/10 rounded-lg p-4 shadow-xl"
      style={{ top, left, width: 292 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{editingMapping ? "Edit Mapping" : "OSC Mappings"}</h3>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-xs">✕</button>
      </div>

      {/* Existing mappings — hidden in edit mode */}
      {!editingMapping && mappings.length > 0 && (
        <div className="mb-3 space-y-1">
          {mappings.map((m) => {
            const ep = endpoints.find((e) => e.id === m.endpointId);
            return (
              <div key={m.id} className="flex items-center gap-2 px-2 py-1 bg-white/5 rounded text-[10px]">
                <span className="font-mono text-accent flex-1 truncate">{resolveOscAddress(m, deviceAliases)}</span>
                {targetType === "noteGroup" && (
                  <span className="text-gray-500">[{m.trigger}]</span>
                )}
                {ep && <span className="text-gray-600 truncate max-w-[60px]">{ep.name}</span>}
                <button
                  onClick={() => onDelete(m.id)}
                  className="text-gray-600 hover:text-red-400 leading-none"
                >✕</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-white/5 pt-3 space-y-2">
        {/* Endpoint */}
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Endpoint</label>
          <select
            value={endpointId}
            onChange={(e) => setEndpointId(e.target.value)}
            className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
          >
            {endpoints.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.name} ({ep.host}:{ep.port})</option>
            ))}
          </select>
        </div>

        {/* Preset */}
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Preset</label>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as OscPreset)}
            className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
          >
            <option value="custom">Custom</option>
            <option value="unreal">Unreal Engine</option>
            <option value="resolume">Resolume</option>
          </select>
        </div>

        {/* Preset-specific fields */}
        {preset === "custom" && (
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">OSC Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="/my/address"
              className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent/50"
            />
          </div>
        )}

        {preset === "unreal" && (
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Section</label>
            {sections.length > 0 ? (
              <select
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
              >
                {sections.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                placeholder="section name"
                className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent/50"
              />
            )}
          </div>
        )}

        {preset === "resolume" && (
          <>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Mode</label>
              <div className="flex gap-3">
                {(["column", "clip"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                    <input type="radio" checked={resolumeMode === m} onChange={() => setResolumeMode(m)} className="accent-accent" />
                    {m}
                  </label>
                ))}
              </div>
            </div>
            {resolumeMode === "column" && (
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Column</label>
                <input
                  type="number"
                  min={1}
                  value={resolumeColumn}
                  onChange={(e) => setResolumeColumn(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
                />
              </div>
            )}
            {resolumeMode === "clip" && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-gray-500 mb-1">Layer</label>
                  <input
                    type="number"
                    min={1}
                    value={resolumeLayer}
                    onChange={(e) => setResolumeLayer(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-gray-500 mb-1">Clip</label>
                  <input
                    type="number"
                    min={1}
                    value={resolumeClip}
                    onChange={(e) => setResolumeClip(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* Address preview */}
        <div className="text-[10px] text-gray-600 font-mono truncate">{preview}</div>

        {/* Trigger (note groups only) */}
        {targetType === "noteGroup" && (
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Trigger</label>
            <div className="flex gap-3">
              {(["on", "off", "both"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                  <input type="radio" checked={trigger === t} onChange={() => setTrigger(t)} className="accent-accent" />
                  {t}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Arg type */}
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Arg type</label>
          <div className="flex gap-3">
            {(["f", "i"] as const).map((t) => (
              <label key={t} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                <input type="radio" checked={argType === t} onChange={() => setArgType(t)} className="accent-accent" />
                {t === "f" ? "Float" : "Int"}
              </label>
            ))}
          </div>
        </div>

        {editingMapping ? (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!endpointId}
              className="flex-1 py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={() => { onDelete(editingMapping.id); onClose(); }}
              className="py-1.5 px-3 text-xs bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 rounded"
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            onClick={handleAdd}
            disabled={!endpointId || endpoints.length === 0}
            className="w-full py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            + Add Mapping
          </button>
        )}
      </div>
    </div>
  );
}
