"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { DeckItem, DeckGroup, ButtonConfig, SliderConfig, XYPadConfig, OscArg, SavedEndpoint, MappingToggleConfig, OscMapping, NoteGroupTag, LaneBadge } from "@/lib/types";
import type { DmxTriggerConfig, DmxFaderConfig, DmxFlashConfig, DmxEffect } from "@/lib/dmx-types";
import { DeckMappingPicker } from "./deck-mapping-picker";
import { useEndpoints } from "@/hooks/use-osc";

function SavedEndpointRow({ endpoint, onSelect, onUpdate }: {
  endpoint: SavedEndpoint;
  onSelect: () => void;
  onUpdate: (updates: Partial<Omit<SavedEndpoint, "id">>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [host, setHost] = useState(endpoint.host);
  const [port, setPort] = useState(String(endpoint.port));

  useEffect(() => { setHost(endpoint.host); setPort(String(endpoint.port)); }, [endpoint]);

  const handleSave = () => {
    onUpdate({ host, port: parseInt(port, 10) });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 bg-black border border-deck/20 rounded-lg px-2 py-1">
        <span className="text-[10px] text-gray-400 min-w-[40px]">{endpoint.name}</span>
        <input type="text" value={host} onChange={(e) => setHost(e.target.value)}
          className="flex-1 bg-elevated border border-white/10 rounded px-1 py-0.5 text-[10px] w-20 focus:outline-none" />
        <span className="text-gray-600 text-[10px]">:</span>
        <input type="text" value={port} onChange={(e) => setPort(e.target.value)}
          className="bg-elevated border border-white/10 rounded px-1 py-0.5 text-[10px] w-12 focus:outline-none" />
        <button onClick={handleSave} className="text-[10px] text-deck hover:text-deck-dim">ok</button>
        <button onClick={() => setEditing(false)} className="text-[10px] text-gray-500 hover:text-gray-300">x</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 bg-black rounded-lg px-2 py-1 group hover:bg-elevated transition-colors">
      <button onClick={onSelect} className="flex-1 text-left text-[10px]">
        <span className="text-gray-400">{endpoint.name}</span>
        <span className="text-gray-600 ml-1">{endpoint.host}:{endpoint.port}</span>
        <span className="text-gray-700 ml-1">({endpoint.type})</span>
      </button>
      <button onClick={() => setEditing(true)}
        className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-500 hover:text-gray-300 transition-all">
        edit
      </button>
    </div>
  );
}

interface ConfigPanelProps {
  item?: DeckItem | null;
  group?: DeckGroup | null;
  onUpdateItem?: (updates: Partial<Omit<DeckItem, "id">>) => void;
  onUpdateGroup?: (updates: Partial<Omit<DeckGroup, "id" | "items">>) => void;
  onDelete?: () => void;
  onRemoveFromGroup?: () => void;
  inGroup?: boolean;
  onClose: () => void;
  dmxEffects?: DmxEffect[];
  oscMappings?: OscMapping[];
  noteTags?: NoteGroupTag[];
  laneBadges?: LaneBadge[];
  deviceAliases?: Record<string, string>;
}

const colorSwatches = ["blue", "green", "purple", "red", "orange", "yellow", "gray"];
const swatchColors: Record<string, string> = {
  blue: "#2563eb", green: "#00d4aa", purple: "#8b5cf6",
  red: "#ef4444", orange: "#f59e0b", yellow: "#eab308", gray: "#6b7280",
};

export function DeckConfigPanel({ item, group, onUpdateItem, onUpdateGroup, onDelete, onRemoveFromGroup, inGroup, onClose, dmxEffects, oscMappings, noteTags, laneBadges, deviceAliases }: ConfigPanelProps) {
  const { endpoints: senderEndpoints, update: updateSenderEndpoint } = useEndpoints("sender");
  const { endpoints: listenerEndpoints, update: updateListenerEndpoint } = useEndpoints("listener");
  const allEndpoints = [...senderEndpoints, ...listenerEndpoints];
  const [name, setName] = useState("");
  const [color, setColor] = useState("gray");
  const [oscAddress, setOscAddress] = useState("");
  const [targetHost, setTargetHost] = useState("127.0.0.1");
  const [targetPort, setTargetPort] = useState("8000");
  const [linkedEndpointId, setLinkedEndpointId] = useState<string | undefined>(undefined);

  const [buttonMode, setButtonMode] = useState<"trigger" | "toggle">("trigger");
  const [triggerValue, setTriggerValue] = useState("1");
  const [triggerType, setTriggerType] = useState<OscArg["type"]>("f");
  const [toggleOnValue, setToggleOnValue] = useState("1");
  const [toggleOffValue, setToggleOffValue] = useState("0");

  const [sliderOrientation, setSliderOrientation] = useState<"horizontal" | "vertical">("vertical");
  const [sliderMin, setSliderMin] = useState("0");
  const [sliderMax, setSliderMax] = useState("1");
  const [sliderValueType, setSliderValueType] = useState<"f" | "i">("f");

  const [xAddress, setXAddress] = useState("");
  const [yAddress, setYAddress] = useState("");
  const [xMin, setXMin] = useState("0");
  const [xMax, setXMax] = useState("1");
  const [yMin, setYMin] = useState("0");
  const [yMax, setYMax] = useState("1");

  const initialSnapshot = useRef<string | null>(null);
  const isInitializing = useRef(true);

  const loadFromItem = useCallback((src: DeckItem) => {
    setName(src.name);
    setColor(src.color);
    setOscAddress(src.oscAddress);
    setTargetHost(src.oscTarget.host);
    setTargetPort(String(src.oscTarget.port));
    setLinkedEndpointId(src.oscTargetEndpointId);
    if (src.type === "button") {
      const c = src.config as ButtonConfig;
      setButtonMode(c.mode);
      setTriggerValue(String(c.triggerValue.value));
      setTriggerType(c.triggerValue.type);
      setToggleOnValue(String(c.toggleOnValue.value));
      setToggleOffValue(String(c.toggleOffValue.value));
    } else if (src.type === "slider") {
      const c = src.config as SliderConfig;
      setSliderOrientation(c.orientation);
      setSliderMin(String(c.min));
      setSliderMax(String(c.max));
      setSliderValueType(c.valueType);
    } else if (src.type === "xy-pad") {
      const c = src.config as XYPadConfig;
      setXAddress(c.xAddress);
      setYAddress(c.yAddress);
      setXMin(String(c.xMin));
      setXMax(String(c.xMax));
      setYMin(String(c.yMin));
      setYMax(String(c.yMax));
    }
  }, []);

  useEffect(() => {
    isInitializing.current = true;
    if (item) {
      initialSnapshot.current = JSON.stringify(item);
      loadFromItem(item);
    } else if (group) {
      initialSnapshot.current = JSON.stringify(group);
      setName(group.name);
      setColor(group.color);
    }
    // Allow auto-save after initial load settles
    const timer = setTimeout(() => { isInitializing.current = false; }, 50);
    return () => clearTimeout(timer);
  }, [item?.id, group?.id, loadFromItem]);

  const handleReset = () => {
    if (!initialSnapshot.current) return;
    isInitializing.current = true;
    if (item) {
      const original = JSON.parse(initialSnapshot.current) as DeckItem;
      loadFromItem(original);
      onUpdateItem?.(original);
    } else if (group) {
      const original = JSON.parse(initialSnapshot.current) as DeckGroup;
      setName(original.name);
      setColor(original.color);
      onUpdateGroup?.({ name: original.name, color: original.color });
    }
    setTimeout(() => { isInitializing.current = false; }, 50);
  };

  const buildAndSave = useCallback(() => {
    if (group && onUpdateGroup) {
      onUpdateGroup({ name, color });
      return;
    }
    if (!item || !onUpdateItem) return;

    const base: Partial<Omit<DeckItem, "id">> = {
      name, color, oscAddress,
      oscTarget: { host: targetHost, port: parseInt(targetPort, 10) },
      oscTargetEndpointId: linkedEndpointId,
    };

    if (item.type === "button") {
      base.config = {
        mode: buttonMode,
        triggerValue: { type: triggerType, value: triggerType === "s" ? triggerValue : Number(triggerValue) },
        toggleOnValue: { type: triggerType, value: triggerType === "s" ? toggleOnValue : Number(toggleOnValue) },
        toggleOffValue: { type: triggerType, value: triggerType === "s" ? toggleOffValue : Number(toggleOffValue) },
      } satisfies ButtonConfig;
    } else if (item.type === "slider") {
      base.config = {
        orientation: sliderOrientation,
        min: Number(sliderMin),
        max: Number(sliderMax),
        valueType: sliderValueType,
      } satisfies SliderConfig;
    } else if (item.type === "xy-pad") {
      base.config = {
        xAddress, yAddress,
        xMin: Number(xMin), xMax: Number(xMax),
        yMin: Number(yMin), yMax: Number(yMax),
      } satisfies XYPadConfig;
    }

    onUpdateItem(base);
  }, [group, item, onUpdateGroup, onUpdateItem, name, color, oscAddress, targetHost, targetPort, linkedEndpointId,
      buttonMode, triggerValue, triggerType, toggleOnValue, toggleOffValue,
      sliderOrientation, sliderMin, sliderMax, sliderValueType,
      xAddress, yAddress, xMin, xMax, yMin, yMax]);

  // Auto-save on any field change
  useEffect(() => {
    if (isInitializing.current) return;
    buildAndSave();
  }, [buildAndSave]);

  const isGroup = !!group;

  return (
    <div className="w-72 bg-panel border-l border-white/5 flex flex-col h-full overflow-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <span className="text-sm font-medium">
          {isGroup ? "Group Settings" : `${item?.type} Settings`}
        </span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm">x</button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-deck/18" />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Color</label>
          <div className="flex gap-2">
            {colorSwatches.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-colors ${color === c ? "border-white" : "border-transparent"}`}
                style={{ background: swatchColors[c] }} />
            ))}
          </div>
        </div>

        {!isGroup && (
          <>
            {!item?.type.startsWith("dmx-") && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">OSC Address</label>
              <input type="text" value={oscAddress} onChange={(e) => setOscAddress(e.target.value)} placeholder="/address"
                className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-deck/18" />
            </div>
            )}

            {!item?.type.startsWith("dmx-") && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Target</label>
              <div className="flex gap-2">
                <input type="text" value={targetHost} onChange={(e) => { setTargetHost(e.target.value); setLinkedEndpointId(undefined); }}
                  className="flex-1 bg-black border border-white/10 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-deck/18" />
                <input type="text" value={targetPort} onChange={(e) => { setTargetPort(e.target.value); setLinkedEndpointId(undefined); }}
                  className="w-20 bg-black border border-white/10 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-deck/18" />
              </div>
              {linkedEndpointId && (
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-[10px] text-deck">Linked to: {allEndpoints.find(e => e.id === linkedEndpointId)?.name ?? "unknown"}</span>
                  <button onClick={() => setLinkedEndpointId(undefined)} className="text-[10px] text-gray-500 hover:text-gray-300">unlink</button>
                </div>
              )}
              {allEndpoints.length > 0 && (
                <div className="mt-2">
                  <label className="block text-xs text-gray-500 mb-1">Saved Endpoints</label>
                  <div className="flex flex-col gap-1">
                    {allEndpoints.map((ep) => (
                      <SavedEndpointRow
                        key={ep.id}
                        endpoint={ep}
                        onSelect={() => { setTargetHost(ep.host); setTargetPort(String(ep.port)); setLinkedEndpointId(ep.id); }}
                        onUpdate={(updates) => {
                          const updater = ep.type === "sender" ? updateSenderEndpoint : updateListenerEndpoint;
                          updater(ep.id, updates);
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

            {item?.type === "button" && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Mode</label>
                  <div className="flex gap-2">
                    {(["trigger", "toggle"] as const).map((m) => (
                      <button key={m} onClick={() => setButtonMode(m)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${buttonMode === m ? "bg-deck/20 text-deck" : "bg-black text-gray-400"}`}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Value Type</label>
                  <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as OscArg["type"])}
                    className="w-full bg-black border border-white/10 rounded-lg px-2 py-2 text-sm">
                    <option value="f">Float</option><option value="i">Int</option><option value="s">String</option>
                    <option value="T">True</option><option value="F">False</option>
                  </select>
                </div>
                {buttonMode === "trigger" ? (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Send Value</label>
                    <input type="text" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">ON Value</label>
                      <input type="text" value={toggleOnValue} onChange={(e) => setToggleOnValue(e.target.value)}
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">OFF Value</label>
                      <input type="text" value={toggleOffValue} onChange={(e) => setToggleOffValue(e.target.value)}
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                    </div>
                  </>
                )}
              </div>
            )}

            {item?.type === "slider" && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Orientation</label>
                  <div className="flex gap-2">
                    {(["vertical", "horizontal"] as const).map((o) => (
                      <button key={o} onClick={() => setSliderOrientation(o)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${sliderOrientation === o ? "bg-deck/20 text-deck" : "bg-black text-gray-400"}`}>
                        {o.charAt(0).toUpperCase() + o.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Min</label>
                    <input type="number" value={sliderMin} onChange={(e) => setSliderMin(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Max</label>
                    <input type="number" value={sliderMax} onChange={(e) => setSliderMax(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Output Type</label>
                  <div className="flex gap-2">
                    {(["f", "i"] as const).map((t) => (
                      <button key={t} onClick={() => setSliderValueType(t)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${sliderValueType === t ? "bg-deck/20 text-deck" : "bg-black text-gray-400"}`}>
                        {t === "f" ? "Float" : "Int"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {item?.type === "xy-pad" && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">X Address</label>
                  <input type="text" value={xAddress} onChange={(e) => setXAddress(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Y Address</label>
                  <input type="text" value={yAddress} onChange={(e) => setYAddress(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">X Min</label>
                    <input type="number" value={xMin} onChange={(e) => setXMin(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">X Max</label>
                    <input type="number" value={xMax} onChange={(e) => setXMax(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Y Min</label>
                    <input type="number" value={yMin} onChange={(e) => setYMin(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Y Max</label>
                    <input type="number" value={yMax} onChange={(e) => setYMax(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                </div>
              </div>
            )}

            {item?.type === "dmx-trigger" && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Effect</label>
                <select
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm"
                  value={(item.config as DmxTriggerConfig).dmxEffectId ?? ""}
                  onChange={(e) => onUpdateItem?.({ config: { dmxEffectId: e.target.value } as DmxTriggerConfig })}
                >
                  <option value="">None</option>
                  {(dmxEffects ?? []).map((eff) => (
                    <option key={eff.id} value={eff.id}>{eff.name}</option>
                  ))}
                </select>
              </div>
            )}

            {item?.type === "dmx-fader" && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">DMX Channel</label>
                  <input
                    type="number" min={1} max={512}
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm"
                    value={(item.config as DmxFaderConfig).channel}
                    onChange={(e) => onUpdateItem?.({ config: { ...(item.config as DmxFaderConfig), channel: parseInt(e.target.value) || 1 } as DmxFaderConfig })}
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Min</label>
                    <input type="number" min={0} max={255}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm"
                      value={(item.config as DmxFaderConfig).min}
                      onChange={(e) => onUpdateItem?.({ config: { ...(item.config as DmxFaderConfig), min: parseInt(e.target.value) || 0 } as DmxFaderConfig })}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Max</label>
                    <input type="number" min={0} max={255}
                      className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm"
                      value={(item.config as DmxFaderConfig).max}
                      onChange={(e) => onUpdateItem?.({ config: { ...(item.config as DmxFaderConfig), max: parseInt(e.target.value) || 255 } as DmxFaderConfig })}
                    />
                  </div>
                </div>
              </div>
            )}

            {item?.type === "dmx-flash" && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">DMX Channels (comma-separated)</label>
                  <input
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm"
                    value={(item.config as DmxFlashConfig).channels.join(", ")}
                    onChange={(e) => {
                      const channels = e.target.value.split(",").map((s) => parseInt(s.trim())).filter((n) => n >= 1 && n <= 512);
                      onUpdateItem?.({ config: { ...(item.config as DmxFlashConfig), channels } as DmxFlashConfig });
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Flash Value</label>
                  <input type="number" min={0} max={255}
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm"
                    value={(item.config as DmxFlashConfig).value}
                    onChange={(e) => onUpdateItem?.({ config: { ...(item.config as DmxFlashConfig), value: parseInt(e.target.value) || 255 } as DmxFlashConfig })}
                  />
                </div>
              </div>
            )}

            {item?.type === "mapping-toggle" && (
              <div className="space-y-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Controlled Mappings</div>
                <DeckMappingPicker
                  mappings={oscMappings ?? []}
                  selectedIds={(item.config as MappingToggleConfig).mappingIds}
                  onChange={(ids) => onUpdateItem?.({ config: { mappingIds: ids } as MappingToggleConfig })}
                  noteTags={noteTags}
                  laneBadges={laneBadges}
                  aliases={deviceAliases}
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-auto p-4 border-t border-white/5 flex flex-col gap-2">
        {inGroup && onRemoveFromGroup && (
          <button onClick={onRemoveFromGroup}
            className="w-full py-2 bg-black border border-white/10 text-gray-400 hover:text-deck rounded-lg text-sm font-medium transition-colors">
            Remove from group
          </button>
        )}
        <div className="flex gap-2">
          <button onClick={handleReset}
            className="flex-1 py-2 bg-black border border-white/10 text-gray-400 hover:text-gray-200 rounded-lg text-sm font-medium transition-colors">
            Reset
          </button>
          <button onClick={onDelete}
            className="px-4 py-2 text-red-400 hover:bg-red-500/10 rounded-lg text-sm transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
