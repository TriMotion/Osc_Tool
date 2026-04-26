"use client";

import { useEffect, useRef, useState } from "react";
import type { OscMapping, OscPreset, OscTrigger, SavedEndpoint, TimelineSection } from "@/lib/types";
import type { DmxEffect } from "@/lib/dmx-types";
import { resolveOscAddress } from "@/lib/osc-mapping";
import { useOscEffects } from "@/hooks/use-osc-effects";

interface OscMappingEditorProps {
  targetType: "noteGroup" | "lane";
  targetId: string;
  deviceId: string;
  mappings: OscMapping[];
  endpoints: SavedEndpoint[];
  defaultEndpointId: string | undefined;
  sections: TimelineSection[];
  defaultSectionName?: string;
  defaultMapping?: OscMapping;
  deviceAliases?: Record<string, string>;
  editingMapping?: OscMapping;
  dmxEffects?: DmxEffect[];
  anchorRect: DOMRect;
  sectionId?: string | null;
  prefill?: Partial<OscMapping>;
  onAdd: (mapping: OscMapping) => void;
  onUpdate?: (mapping: OscMapping) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function OscMappingEditor({
  targetType, targetId, deviceId, mappings, endpoints, defaultEndpointId,
  sections, defaultSectionName, defaultMapping, deviceAliases, dmxEffects, editingMapping, anchorRect, sectionId, prefill, onAdd, onUpdate, onDelete, onClose,
}: OscMappingEditorProps) {
  // When adding a new mapping, seed from: last target-specific mapping → defaultMapping (last across device) → prefill → hard defaults.
  const lastMapping = !editingMapping && mappings.length > 0 ? mappings[mappings.length - 1] : undefined;
  const seed = editingMapping ?? lastMapping ?? defaultMapping ?? prefill;

  const [endpointId, setEndpointId] = useState(seed?.endpointId ?? defaultEndpointId ?? endpoints[0]?.id ?? "");
  useEffect(() => {
    if (!endpointId && endpoints.length > 0) {
      setEndpointId(endpoints[0].id);
    }
  }, [endpoints]);
  const [preset, setPreset] = useState<OscPreset>(seed?.preset ?? "resolume");
  const [trigger, setTrigger] = useState<OscTrigger>(seed?.trigger ?? "on");
  const [argType, setArgType] = useState<"f" | "i">(seed?.argType ?? "f");
  // custom
  const [address, setAddress] = useState(editingMapping?.address ?? prefill?.address ?? "/");
  // unreal
  const [sectionName, setSectionName] = useState(
    editingMapping?.sectionName ?? defaultSectionName ?? sections[0]?.name ?? ""
  );
  const [unrealType, setUnrealType] = useState<"parameter" | "trigger">(seed?.unrealType ?? "parameter");
  const [unrealName, setUnrealName] = useState(editingMapping?.unrealName ?? prefill?.unrealName ?? "");
  // resolume
  const [resolumeMode, setResolumeMode] = useState<"column" | "clip">(seed?.resolumeMode ?? "column");
  const [resolumeColumn, setResolumeColumn] = useState(seed?.resolumeColumn ?? 1);
  const [resolumeLayer, setResolumeLayer] = useState(seed?.resolumeLayer ?? 1);
  const [resolumeClip, setResolumeClip] = useState(seed?.resolumeClip ?? 1);
  const [resolumeClipMax, setResolumeClipMax] = useState(seed?.resolumeClipMax ?? 0);
  const [resolumeClipMode, setResolumeClipMode] = useState<"random" | "sequential">(seed?.resolumeClipMode ?? "random");
  // velocity filter
  const [velocityFilter, setVelocityFilter] = useState<"all" | "min" | "exact">(seed?.velocityFilter ?? "all");
  const [velocityMin, setVelocityMin] = useState(seed?.velocityMin ?? 64);
  const [velocityExact, setVelocityExact] = useState(seed?.velocityExact ?? 100);
  const [outputType, setOutputType] = useState<"osc" | "dmx">(seed?.outputType ?? "osc");
  const [dmxEffectId, setDmxEffectId] = useState(seed?.dmxEffectId ?? "");
  const [oscEffectId, setOscEffectId] = useState(seed?.oscEffectId ?? "");
  const { effects: oscEffects } = useOscEffects();

  const previewMapping: OscMapping = {
    id: "preview",
    targetType, targetId, deviceId, endpointId,
    preset, trigger, argType, address,
    sectionName,
    unrealType, unrealName,
    resolumeMode, resolumeColumn, resolumeLayer, resolumeClip, resolumeClipMax: resolumeClipMax || undefined, resolumeClipMode: resolumeClipMax ? resolumeClipMode : undefined,
    velocityFilter: velocityFilter !== "all" ? velocityFilter : undefined,
    velocityMin: velocityFilter === "min" ? velocityMin : undefined,
    velocityExact: velocityFilter === "exact" ? velocityExact : undefined,
  };
  const preview = resolveOscAddress(previewMapping, deviceAliases);

  const sharedFields = () => ({
    preset, trigger, argType, address,
    sectionName, unrealType, unrealName: unrealName || "param",
    resolumeMode, resolumeColumn, resolumeLayer, resolumeClip,
    resolumeClipMax: resolumeClipMax || undefined,
    resolumeClipMode: resolumeClipMax ? resolumeClipMode : undefined,
    velocityFilter: velocityFilter !== "all" ? velocityFilter : undefined,
    velocityMin: velocityFilter === "min" ? velocityMin : undefined,
    velocityExact: velocityFilter === "exact" ? velocityExact : undefined,
    outputType,
    dmxEffectId: outputType === "dmx" ? dmxEffectId : undefined,
    oscEffectId: outputType === "osc" ? (oscEffectId || undefined) : undefined,
  });

  const handleAdd = () => {
    if (outputType === "osc" && !endpointId) return;
    onAdd({
      id: crypto.randomUUID(),
      targetType, targetId, deviceId,
      endpointId: outputType === "dmx" ? "" : endpointId,
      ...sharedFields(),
      sectionId: sectionId ?? undefined,
    });
    onClose();
  };

  const handleSave = () => {
    if (!editingMapping || (outputType === "osc" && !endpointId)) return;
    onUpdate?.({
      ...editingMapping,
      endpointId: outputType === "dmx" ? "" : endpointId,
      ...sharedFields(),
      sectionId: editingMapping.sectionId ?? sectionId ?? undefined,
    });
  };

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setOffset({ x: d.ox + e.clientX - d.startX, y: d.oy + e.clientY - d.startY });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 480) + offset.y;
  const left = Math.min(anchorRect.left, window.innerWidth - 300) + offset.x;

  return (
    <div
      className="fixed z-50 border border-white/10 rounded-lg p-4"
      style={{ top, left, width: 292, background: "#0f0f1e", boxShadow: "0 8px 32px rgba(0,0,0,0.9)" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center justify-between mb-3 cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => {
          e.preventDefault();
          dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
        }}
      >
        <h3 className="text-sm font-semibold">{editingMapping ? "Edit Mapping" : "OSC Mappings"}</h3>
        <button onClick={onClose} onMouseDown={(e) => e.stopPropagation()} className="text-gray-600 hover:text-gray-300 text-xs">✕</button>
      </div>

      {/* Existing mappings — hidden in edit mode */}
      {!editingMapping && mappings.length > 0 && (
        <div className="mb-3 space-y-1">
          {mappings.map((m) => {
            const ep = endpoints.find((e) => e.id === m.endpointId);
            return (
              <div key={m.id} className="flex items-center gap-2 px-2 py-1 bg-white/5 rounded text-[10px]">
                <span className="font-mono text-timeline flex-1 truncate">{resolveOscAddress(m, deviceAliases)}</span>
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
        {/* Output Type */}
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Output Type</label>
          <div className="flex gap-1">
            <button
              className={`flex-1 text-xs py-1 rounded border ${outputType === "osc" ? "bg-timeline/20 border-timeline/40 text-timeline" : "bg-elevated border-white/10 text-gray-500"}`}
              onClick={() => setOutputType("osc")}
            >OSC</button>
            <button
              className={`flex-1 text-xs py-1 rounded border ${outputType === "dmx" ? "bg-amber-500/15 border-amber-500/40 text-amber-300" : "bg-elevated border-white/10 text-gray-500"}`}
              onClick={() => setOutputType("dmx")}
            >DMX</button>
          </div>
        </div>

        {outputType === "dmx" ? (
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">DMX Effect</label>
            <select
              value={dmxEffectId}
              onChange={(e) => setDmxEffectId(e.target.value)}
              className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-timeline/18"
            >
              <option value="">None</option>
              {(dmxEffects ?? []).map((eff) => (
                <option key={eff.id} value={eff.id}>{eff.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <>
            {/* Endpoint */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Endpoint</label>
              <select
                value={endpointId}
                onChange={(e) => setEndpointId(e.target.value)}
                className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-timeline/18"
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
                className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-timeline/18"
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
                  className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-timeline/18"
                />
              </div>
            )}

            {/* Section — shown for all presets, only used in Unreal address */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Section</label>
              {sections.length > 0 ? (
                <select
                  value={sectionName}
                  onChange={(e) => setSectionName(e.target.value)}
                  className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-timeline/18"
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
                  className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-timeline/18"
                />
              )}
            </div>

            {preset === "resolume" && (
              <>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Mode</label>
                  <div className="flex gap-3">
                    {(["column", "clip"] as const).map((m) => (
                      <label key={m} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                        <input type="radio" checked={resolumeMode === m} onChange={() => setResolumeMode(m)} className="accent-timeline" />
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
                      className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-timeline/18"
                    />
                  </div>
                )}
                {resolumeMode === "clip" && (
                  <>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-[10px] text-gray-500 mb-1">Layer</label>
                        <input
                          type="number"
                          min={1}
                          value={resolumeLayer}
                          onChange={(e) => setResolumeLayer(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-timeline/18"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] text-gray-500 mb-1">Clip</label>
                        <input
                          type="number"
                          min={1}
                          value={resolumeClip}
                          onChange={(e) => setResolumeClip(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-timeline/18"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] text-gray-500 mb-1">Clip max</label>
                        <input
                          type="number"
                          min={0}
                          value={resolumeClipMax}
                          onChange={(e) => setResolumeClipMax(Math.max(0, parseInt(e.target.value) || 0))}
                          placeholder="—"
                          className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-timeline/18"
                        />
                      </div>
                    </div>
                    {resolumeClipMax > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {(["random", "sequential"] as const).map((m) => (
                            <button
                              key={m}
                              className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                                resolumeClipMode === m
                                  ? "bg-timeline/15 text-timeline border-timeline/30"
                                  : "text-gray-600 border-white/10 hover:text-gray-400 hover:border-white/20"
                              }`}
                              onClick={() => setResolumeClipMode(m)}
                            >
                              {m === "random" ? "Random" : "Sequential"}
                            </button>
                          ))}
                        </div>
                        <span className="text-[10px] text-gray-600">
                          clip {resolumeClip}–{resolumeClipMax}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* OSC Effect */}
            <div>
              <label className="block text-[10px] uppercase text-gray-500 mb-1">OSC Effect</label>
              <select
                className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none"
                value={oscEffectId}
                onChange={(e) => setOscEffectId(e.target.value)}
              >
                <option value="">None (single value)</option>
                {oscEffects.map((eff) => (
                  <option key={eff.id} value={eff.id}>{eff.name}</option>
                ))}
              </select>
            </div>

            {/* Address preview */}
            <div className="text-[10px] text-gray-600 font-mono truncate">{preview}</div>
          </>
        )}

        {/* Trigger (note groups only) */}
        {targetType === "noteGroup" && (
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Trigger</label>
            <div className="flex gap-3">
              {(["on", "off", "both"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                  <input type="radio" checked={trigger === t} onChange={() => setTrigger(t)} className="accent-timeline" />
                  {t}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Velocity filter */}
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Velocity</label>
          <div className="flex gap-3 mb-1">
            {(["all", "min", "exact"] as const).map((v) => (
              <label key={v} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                <input type="radio" checked={velocityFilter === v} onChange={() => setVelocityFilter(v)} className="accent-timeline" />
                {v === "all" ? "All" : v === "min" ? "≥ Min" : "Exact"}
              </label>
            ))}
          </div>
          {velocityFilter === "min" && (
            <input
              type="number"
              min={0}
              max={127}
              value={velocityMin}
              onChange={(e) => setVelocityMin(Math.max(0, Math.min(127, parseInt(e.target.value) || 0)))}
              className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-timeline/18"
            />
          )}
          {velocityFilter === "exact" && (
            <input
              type="number"
              min={0}
              max={127}
              value={velocityExact}
              onChange={(e) => setVelocityExact(Math.max(0, Math.min(127, parseInt(e.target.value) || 0)))}
              className="w-full bg-elevated border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-timeline/18"
            />
          )}
        </div>

        {/* Arg type */}
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Arg type</label>
          <div className="flex gap-3">
            {(["f", "i"] as const).map((t) => (
              <label key={t} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                <input type="radio" checked={argType === t} onChange={() => setArgType(t)} className="accent-timeline" />
                {t === "f" ? "Float" : "Int"}
              </label>
            ))}
          </div>
        </div>

        {editingMapping ? (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={(outputType === "osc" && !endpointId) || (outputType === "dmx" && !dmxEffectId)}
              className="flex-1 py-1.5 text-xs bg-timeline/20 text-timeline border border-timeline/30 hover:bg-timeline/30 rounded disabled:opacity-30 disabled:cursor-not-allowed"
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
            disabled={(outputType === "osc" && (!endpointId || endpoints.length === 0)) || (outputType === "dmx" && !dmxEffectId)}
            className="w-full py-1.5 text-xs bg-timeline/20 text-timeline border border-timeline/30 hover:bg-timeline/30 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            + Add Mapping
          </button>
        )}
      </div>
    </div>
  );
}
