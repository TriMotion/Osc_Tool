"use client";

import { useEffect, useState } from "react";
import { useFlash } from "@/hooks/use-flash";
import { resolveOscAddress } from "@/lib/osc-mapping";
import type { OscMapping, OscPreset, SavedEndpoint } from "@/lib/types";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiNoteToName(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function formatTrigger(mapping: OscMapping): string {
  if (mapping.targetType === "noteGroup") {
    const [pitchStr, velocityStr] = mapping.targetId.split("|");
    return `${midiNoteToName(parseInt(pitchStr, 10))} v${velocityStr}`;
  }
  return mapping.targetId;
}

// ─── MappingRow ────────────────────────────────────────────────────────────────

interface MappingRowProps {
  mapping: OscMapping;
  endpoints: SavedEndpoint[];
  aliases?: Record<string, string>;
  isSelected: boolean;
  isEditing: boolean;
  flashTrigger: number;
  onToggleSelect: () => void;
  onToggleEdit: () => void;
  onUpdate: (mapping: OscMapping) => void;
}

function MappingRow({
  mapping,
  endpoints,
  aliases,
  isSelected,
  isEditing,
  flashTrigger,
  onToggleSelect,
  onToggleEdit,
  onUpdate,
}: MappingRowProps) {
  const isFlashing = useFlash(flashTrigger);
  const displayDevice = aliases?.[mapping.deviceId] ?? mapping.deviceId;
  const endpoint = endpoints.find((e) => e.id === mapping.endpointId);
  const address = resolveOscAddress(mapping, aliases);

  return (
    <div className={`border-b border-white/5 transition-colors ${isFlashing ? "bg-deck/5" : ""}`}>
      {/* Summary row */}
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="accent-deck shrink-0"
        />
        <div
          className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-150 ${
            isFlashing ? "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.8)]" : "bg-white/10"
          }`}
        />
        <span className="text-gray-400 w-28 truncate shrink-0">{displayDevice}</span>
        <span className="text-gray-500 w-24 truncate shrink-0 font-mono">{formatTrigger(mapping)}</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
            mapping.preset === "resolume"
              ? "bg-orange-500/20 text-orange-400"
              : mapping.preset === "unreal"
              ? "bg-blue-500/20 text-blue-400"
              : "bg-gray-500/20 text-gray-400"
          }`}
        >
          {mapping.preset}
        </span>
        <span className="text-deck font-mono flex-1 truncate">{address}</span>
        <span className="text-gray-500 shrink-0 truncate max-w-[160px]">
          {endpoint ? endpoint.name : <span className="text-red-400/80">missing</span>}
          {(mapping.extraEndpointIds?.length ?? 0) > 0 && (
            <span className="ml-1 text-[10px] text-deck/80">
              +{mapping.extraEndpointIds!.length}
            </span>
          )}
        </span>
        <button
          onClick={onToggleEdit}
          className="text-gray-600 hover:text-gray-300 shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-white/5 hover:border-white/10 transition-colors"
        >
          {isEditing ? "close" : "edit"}
        </button>
      </div>

      {/* Inline edit section */}
      {isEditing && (
        <div className="px-4 pb-3 pt-1 bg-panel border-t border-white/5 flex flex-col gap-2">
          {/* Endpoint — always shown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-24 shrink-0">Endpoint</span>
            <select
              value={mapping.endpointId}
              onChange={(e) => onUpdate({ ...mapping, endpointId: e.target.value })}
              className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300 flex-1"
            >
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.name} — {ep.host}:{ep.port}
                </option>
              ))}
            </select>
          </div>

          {(mapping.extraEndpointIds ?? []).map((epId, idx) => {
            const ep = endpoints.find((e) => e.id === epId);
            return (
              <div key={`${epId}-${idx}`} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">+ Endpoint</span>
                <select
                  value={epId}
                  onChange={(e) => {
                    const next = [...(mapping.extraEndpointIds ?? [])];
                    next[idx] = e.target.value;
                    onUpdate({ ...mapping, extraEndpointIds: next });
                  }}
                  className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300 flex-1"
                >
                  {!ep && <option value={epId}>(missing endpoint)</option>}
                  {endpoints.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} — {e.host}:{e.port}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const next = (mapping.extraEndpointIds ?? []).filter((_, i) => i !== idx);
                    onUpdate({
                      ...mapping,
                      extraEndpointIds: next.length > 0 ? next : undefined,
                    });
                  }}
                  className="text-xs text-gray-500 hover:text-red-400 shrink-0 px-1.5 py-0.5 rounded border border-white/5 hover:border-red-400/30 transition-colors"
                  title="Remove endpoint"
                >
                  ✕
                </button>
              </div>
            );
          })}

          {(() => {
            const used = new Set([mapping.endpointId, ...(mapping.extraEndpointIds ?? [])]);
            const available = endpoints.filter((e) => !used.has(e.id));
            if (available.length === 0) return null;
            return (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0" />
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    onUpdate({
                      ...mapping,
                      extraEndpointIds: [...(mapping.extraEndpointIds ?? []), e.target.value],
                    });
                  }}
                  className="text-xs bg-black border border-dashed border-white/10 rounded px-2 py-1 text-gray-500 flex-1"
                >
                  <option value="">+ Add another endpoint…</option>
                  {available.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.name} — {ep.host}:{ep.port}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}

          {/* Custom preset */}
          {mapping.preset === "custom" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 shrink-0">Address</span>
              <input
                type="text"
                value={mapping.address ?? ""}
                onChange={(e) => onUpdate({ ...mapping, address: e.target.value })}
                className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300 flex-1 font-mono"
                placeholder="/osc/address"
              />
            </div>
          )}

          {/* Unreal preset */}
          {mapping.preset === "unreal" && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">Section</span>
                <input
                  type="text"
                  value={mapping.sectionName ?? ""}
                  onChange={(e) => onUpdate({ ...mapping, sectionName: e.target.value })}
                  className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300 flex-1 font-mono"
                  placeholder="default"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">Param name</span>
                <input
                  type="text"
                  value={mapping.unrealName ?? ""}
                  onChange={(e) => onUpdate({ ...mapping, unrealName: e.target.value })}
                  className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300 flex-1 font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">Type</span>
                <select
                  value={mapping.unrealType ?? "parameter"}
                  onChange={(e) =>
                    onUpdate({ ...mapping, unrealType: e.target.value as "parameter" | "trigger" })
                  }
                  className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300"
                >
                  <option value="parameter">Parameter</option>
                  <option value="trigger">Trigger</option>
                </select>
              </div>
            </>
          )}

          {/* Resolume preset */}
          {mapping.preset === "resolume" && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">Mode</span>
                <select
                  value={mapping.resolumeMode ?? "column"}
                  onChange={(e) =>
                    onUpdate({ ...mapping, resolumeMode: e.target.value as "column" | "clip" })
                  }
                  className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300"
                >
                  <option value="column">Column</option>
                  <option value="clip">Clip</option>
                </select>
              </div>
              {(mapping.resolumeMode ?? "column") === "column" ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-24 shrink-0">Column</span>
                  <input
                    type="number"
                    min={1}
                    value={mapping.resolumeColumn ?? 1}
                    onChange={(e) =>
                      onUpdate({ ...mapping, resolumeColumn: parseInt(e.target.value) || 1 })
                    }
                    className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300 w-16"
                  />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-24 shrink-0">Layer</span>
                    <input
                      type="number"
                      min={1}
                      value={mapping.resolumeLayer ?? 1}
                      onChange={(e) =>
                        onUpdate({ ...mapping, resolumeLayer: parseInt(e.target.value) || 1 })
                      }
                      className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300 w-16"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-24 shrink-0">Clip</span>
                    <input
                      type="number"
                      min={1}
                      value={mapping.resolumeClip ?? 1}
                      onChange={(e) =>
                        onUpdate({ ...mapping, resolumeClip: parseInt(e.target.value) || 1 })
                      }
                      className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300 w-16"
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MappingConfigPanel ────────────────────────────────────────────────────────

interface MappingConfigPanelProps {
  mappings: OscMapping[];
  endpoints: SavedEndpoint[];
  aliases?: Record<string, string>;
  flashTriggers: Record<string, number>;
  onUpdateMappings: (mappings: OscMapping[]) => void;
  recordingId?: string;
}

export function MappingConfigPanel({
  mappings,
  endpoints,
  aliases,
  flashTriggers,
  onUpdateMappings,
  recordingId,
}: MappingConfigPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterPreset, setFilterPreset] = useState<OscPreset | "all">("all");
  const [filterEndpointId, setFilterEndpointId] = useState<"all" | string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [localMappings, setLocalMappings] = useState<OscMapping[]>(mappings);
  const [batchEndpointId, setBatchEndpointId] = useState<string>("");

  // Reset all local state when a different recording is loaded
  useEffect(() => {
    setLocalMappings(mappings);
    setSelectedIds(new Set());
    setEditingId(null);
    setFilterPreset("all");
    setFilterEndpointId("all");
  }, [recordingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = localMappings.filter((m) => {
    if (filterPreset !== "all" && m.preset !== filterPreset) return false;
    if (filterEndpointId !== "all" && m.endpointId !== filterEndpointId) return false;
    return true;
  });

  const updateMapping = (updated: OscMapping) => {
    const next = localMappings.map((m) => (m.id === updated.id ? updated : m));
    setLocalMappings(next);
    onUpdateMappings(next);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const applyBatchEndpoint = () => {
    if (!batchEndpointId) return;
    const next = localMappings.map((m) => {
      if (!selectedIds.has(m.id)) return m;
      if (m.endpointId === batchEndpointId) return m;
      const extras = m.extraEndpointIds ?? [];
      if (extras.includes(batchEndpointId)) return m;
      return { ...m, extraEndpointIds: [...extras, batchEndpointId] };
    });
    setLocalMappings(next);
    onUpdateMappings(next);
    setSelectedIds(new Set());
    setBatchEndpointId("");
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((m) => m.id)));
  };

  return (
    <div className="border-t border-white/5 shrink-0">
      {/* Collapsible header */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span>
          OSC Mapping Config
          <span className="ml-2 text-gray-600">({localMappings.length})</span>
        </span>
        <span className="text-gray-600 text-[10px]">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="flex flex-col" style={{ maxHeight: "40vh" }}>
          {/* Filter bar */}
          <div className="flex items-center gap-3 px-4 py-2 border-t border-white/5 bg-panel shrink-0">
            <span className="text-xs text-gray-500">Filter:</span>
            <select
              value={filterPreset}
              onChange={(e) => setFilterPreset(e.target.value as OscPreset | "all")}
              className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300"
            >
              <option value="all">All types</option>
              <option value="custom">Custom</option>
              <option value="unreal">Unreal</option>
              <option value="resolume">Resolume</option>
            </select>
            <select
              value={filterEndpointId}
              onChange={(e) => setFilterEndpointId(e.target.value)}
              className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300"
            >
              <option value="all">All endpoints</option>
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.name} ({ep.host}:{ep.port})
                </option>
              ))}
            </select>
            <div className="flex-1" />
            <button
              onClick={selectAllFiltered}
              disabled={filtered.length === 0}
              className="text-xs px-2 py-1 rounded border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Select all ({filtered.length})
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs px-2 py-1 text-gray-500 hover:text-gray-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Mapping rows */}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="text-center text-sm text-gray-600 py-6">
                No mappings match the filter
              </div>
            ) : (
              filtered.map((mapping) => (
                <MappingRow
                  key={mapping.id}
                  mapping={mapping}
                  endpoints={endpoints}
                  aliases={aliases}
                  isSelected={selectedIds.has(mapping.id)}
                  isEditing={editingId === mapping.id}
                  flashTrigger={flashTriggers[mapping.id] ?? 0}
                  onToggleSelect={() => toggleSelect(mapping.id)}
                  onToggleEdit={() =>
                    setEditingId((prev) => (prev === mapping.id ? null : mapping.id))
                  }
                  onUpdate={updateMapping}
                />
              ))
            )}
          </div>

          {/* Batch action bar — visible when ≥1 row selected */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 border-t border-white/5 bg-panel shrink-0">
              <span className="text-xs text-gray-400">{selectedIds.size} selected</span>
              <span className="text-xs text-gray-600">Add endpoint:</span>
              <select
                value={batchEndpointId}
                onChange={(e) => setBatchEndpointId(e.target.value)}
                className="text-xs bg-black border border-white/10 rounded px-2 py-1 text-gray-300 flex-1 max-w-[220px]"
              >
                <option value="">Choose endpoint…</option>
                {endpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name} — {ep.host}:{ep.port}
                  </option>
                ))}
              </select>
              <button
                onClick={applyBatchEndpoint}
                disabled={!batchEndpointId}
                className="text-xs px-3 py-1 rounded bg-deck/80 hover:bg-deck text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Add this endpoint as an extra send target on all selected mappings"
              >
                Add to selected
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs px-2 py-1 text-gray-500 hover:text-gray-300 transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
