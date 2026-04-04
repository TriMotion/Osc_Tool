"use client";

import { useState, useEffect } from "react";
import type { DeckItem, DeckGroup, ButtonConfig, SliderConfig, XYPadConfig, OscArg } from "@/lib/types";
import { useEndpoints } from "@/hooks/use-osc";

interface ConfigPanelProps {
  item?: DeckItem | null;
  group?: DeckGroup | null;
  onUpdateItem?: (updates: Partial<Omit<DeckItem, "id">>) => void;
  onUpdateGroup?: (updates: Partial<Omit<DeckGroup, "id" | "items">>) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const colorSwatches = ["blue", "green", "purple", "red", "orange", "yellow", "gray"];
const swatchColors: Record<string, string> = {
  blue: "#2563eb", green: "#00d4aa", purple: "#8b5cf6",
  red: "#ef4444", orange: "#f59e0b", yellow: "#eab308", gray: "#6b7280",
};

export function DeckConfigPanel({ item, group, onUpdateItem, onUpdateGroup, onDelete, onClose }: ConfigPanelProps) {
  const { endpoints } = useEndpoints("sender");
  const [name, setName] = useState("");
  const [color, setColor] = useState("gray");
  const [oscAddress, setOscAddress] = useState("");
  const [targetHost, setTargetHost] = useState("127.0.0.1");
  const [targetPort, setTargetPort] = useState("8000");

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

  useEffect(() => {
    if (item) {
      setName(item.name);
      setColor(item.color);
      setOscAddress(item.oscAddress);
      setTargetHost(item.oscTarget.host);
      setTargetPort(String(item.oscTarget.port));
      if (item.type === "button") {
        const c = item.config as ButtonConfig;
        setButtonMode(c.mode);
        setTriggerValue(String(c.triggerValue.value));
        setTriggerType(c.triggerValue.type);
        setToggleOnValue(String(c.toggleOnValue.value));
        setToggleOffValue(String(c.toggleOffValue.value));
      } else if (item.type === "slider") {
        const c = item.config as SliderConfig;
        setSliderOrientation(c.orientation);
        setSliderMin(String(c.min));
        setSliderMax(String(c.max));
        setSliderValueType(c.valueType);
      } else if (item.type === "xy-pad") {
        const c = item.config as XYPadConfig;
        setXAddress(c.xAddress);
        setYAddress(c.yAddress);
        setXMin(String(c.xMin));
        setXMax(String(c.xMax));
        setYMin(String(c.yMin));
        setYMax(String(c.yMax));
      }
    } else if (group) {
      setName(group.name);
      setColor(group.color);
    }
  }, [item, group]);

  const handleSave = () => {
    if (group && onUpdateGroup) {
      onUpdateGroup({ name, color });
      return;
    }
    if (!item || !onUpdateItem) return;

    const base: Partial<Omit<DeckItem, "id">> = {
      name, color, oscAddress,
      oscTarget: { host: targetHost, port: parseInt(targetPort, 10) },
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
  };

  const isGroup = !!group;

  return (
    <div className="w-72 bg-surface-light border-l border-white/5 flex flex-col h-full overflow-auto">
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
            className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50" />
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
            <div>
              <label className="block text-xs text-gray-500 mb-1">OSC Address</label>
              <input type="text" value={oscAddress} onChange={(e) => setOscAddress(e.target.value)} placeholder="/address"
                className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent/50" />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Target</label>
              <div className="flex gap-2">
                <input type="text" value={targetHost} onChange={(e) => setTargetHost(e.target.value)}
                  className="flex-1 bg-surface border border-white/10 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-accent/50" />
                <input type="text" value={targetPort} onChange={(e) => setTargetPort(e.target.value)}
                  className="w-20 bg-surface border border-white/10 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-accent/50" />
              </div>
              {endpoints.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {endpoints.map((ep) => (
                    <button key={ep.id} onClick={() => { setTargetHost(ep.host); setTargetPort(String(ep.port)); }}
                      className="text-[10px] text-gray-500 hover:text-accent bg-surface px-1.5 py-0.5 rounded transition-colors">
                      {ep.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {item?.type === "button" && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Mode</label>
                  <div className="flex gap-2">
                    {(["trigger", "toggle"] as const).map((m) => (
                      <button key={m} onClick={() => setButtonMode(m)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${buttonMode === m ? "bg-accent/20 text-accent" : "bg-surface text-gray-400"}`}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Value Type</label>
                  <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as OscArg["type"])}
                    className="w-full bg-surface border border-white/10 rounded-lg px-2 py-2 text-sm">
                    <option value="f">Float</option><option value="i">Int</option><option value="s">String</option>
                    <option value="T">True</option><option value="F">False</option>
                  </select>
                </div>
                {buttonMode === "trigger" ? (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Send Value</label>
                    <input type="text" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">ON Value</label>
                      <input type="text" value={toggleOnValue} onChange={(e) => setToggleOnValue(e.target.value)}
                        className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">OFF Value</label>
                      <input type="text" value={toggleOffValue} onChange={(e) => setToggleOffValue(e.target.value)}
                        className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
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
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${sliderOrientation === o ? "bg-accent/20 text-accent" : "bg-surface text-gray-400"}`}>
                        {o.charAt(0).toUpperCase() + o.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Min</label>
                    <input type="number" value={sliderMin} onChange={(e) => setSliderMin(e.target.value)}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Max</label>
                    <input type="number" value={sliderMax} onChange={(e) => setSliderMax(e.target.value)}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Output Type</label>
                  <div className="flex gap-2">
                    {(["f", "i"] as const).map((t) => (
                      <button key={t} onClick={() => setSliderValueType(t)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${sliderValueType === t ? "bg-accent/20 text-accent" : "bg-surface text-gray-400"}`}>
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
                    className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Y Address</label>
                  <input type="text" value={yAddress} onChange={(e) => setYAddress(e.target.value)}
                    className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">X Min</label>
                    <input type="number" value={xMin} onChange={(e) => setXMin(e.target.value)}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">X Max</label>
                    <input type="number" value={xMax} onChange={(e) => setXMax(e.target.value)}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Y Min</label>
                    <input type="number" value={yMin} onChange={(e) => setYMin(e.target.value)}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Y Max</label>
                    <input type="number" value={yMax} onChange={(e) => setYMax(e.target.value)}
                      className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-auto p-4 border-t border-white/5 flex gap-2">
        <button onClick={handleSave}
          className="flex-1 py-2 bg-accent text-surface rounded-lg text-sm font-medium hover:bg-accent-dim transition-colors">
          Save
        </button>
        <button onClick={onDelete}
          className="px-4 py-2 text-red-400 hover:bg-red-500/10 rounded-lg text-sm transition-colors">
          Delete
        </button>
      </div>
    </div>
  );
}
