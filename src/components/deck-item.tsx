"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import type { DeckItem, ButtonConfig, SliderConfig, XYPadConfig, OscArg } from "@/lib/types";

interface DeckItemProps {
  item: DeckItem;
  editMode: boolean;
  onSendOsc: (host: string, port: number, address: string, args: OscArg[]) => void;
  onSelect?: () => void;
  onDragStart?: (e: React.MouseEvent) => void;
}

const colorMap: Record<string, { bg: string; border: string; text: string; fill: string }> = {
  blue:   { bg: "#1e3a5f", border: "#2563eb40", text: "#93c5fd", fill: "#2563eb" },
  green:  { bg: "#164e3a", border: "#00d4aa40", text: "#6ee7b7", fill: "#00d4aa" },
  purple: { bg: "#3b1f4e", border: "#8b5cf640", text: "#c4b5fd", fill: "#8b5cf6" },
  red:    { bg: "#4a2020", border: "#ef444440", text: "#fca5a5", fill: "#ef4444" },
  orange: { bg: "#4a3920", border: "#f59e0b40", text: "#fcd34d", fill: "#f59e0b" },
  yellow: { bg: "#4a4520", border: "#eab30840", text: "#fde68a", fill: "#eab308" },
  gray:   { bg: "#222244", border: "rgba(255,255,255,0.08)", text: "#9ca3af", fill: "#6b7280" },
};

export function DeckItemView({ item, editMode, onSendOsc, onSelect, onDragStart }: DeckItemProps) {
  const [toggled, setToggled] = useState(false);
  const [sliderValue, setSliderValue] = useState(0.5);
  const [xyValue, setXyValue] = useState({ x: 0.5, y: 0.5 });

  const colors = colorMap[item.color] ?? colorMap.gray;

  const handleButtonClick = () => {
    if (editMode) { onSelect?.(); return; }
    const config = item.config as ButtonConfig;
    if (config.mode === "trigger") {
      onSendOsc(item.oscTarget.host, item.oscTarget.port, item.oscAddress, [config.triggerValue]);
    } else {
      const newToggled = !toggled;
      setToggled(newToggled);
      const val = newToggled ? config.toggleOnValue : config.toggleOffValue;
      onSendOsc(item.oscTarget.host, item.oscTarget.port, item.oscAddress, [val]);
    }
  };

  const handleSliderDrag = useCallback((e: React.MouseEvent) => {
    if (editMode) { onSelect?.(); return; }
    const config = item.config as SliderConfig;
    const target = (e.currentTarget as HTMLElement).closest("[data-slider-track]") as HTMLElement;
    if (!target) return;
    const rect = target.getBoundingClientRect();

    const updateValue = (clientX: number, clientY: number) => {
      let ratio: number;
      if (config.orientation === "vertical") {
        ratio = 1 - (clientY - rect.top) / rect.height;
      } else {
        ratio = (clientX - rect.left) / rect.width;
      }
      ratio = Math.max(0, Math.min(1, ratio));
      const value = config.min + ratio * (config.max - config.min);
      const rounded = config.valueType === "i" ? Math.round(value) : parseFloat(value.toFixed(3));
      setSliderValue(ratio);
      onSendOsc(item.oscTarget.host, item.oscTarget.port, item.oscAddress, [
        { type: config.valueType, value: rounded },
      ]);
    };

    const onMouseMove = (ev: MouseEvent) => updateValue(ev.clientX, ev.clientY);
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    updateValue(e.clientX, e.clientY);
  }, [editMode, item, onSendOsc, onSelect]);

  const handleXYDrag = useCallback((e: React.MouseEvent) => {
    if (editMode) { onSelect?.(); return; }
    const config = item.config as XYPadConfig;
    const target = (e.currentTarget as HTMLElement).closest("[data-xy-pad]") as HTMLElement;
    if (!target) return;
    const rect = target.getBoundingClientRect();

    const updateValue = (clientX: number, clientY: number) => {
      const xRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const yRatio = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      setXyValue({ x: xRatio, y: yRatio });
      const xVal = config.xMin + xRatio * (config.xMax - config.xMin);
      const yVal = config.yMin + yRatio * (config.yMax - config.yMin);
      onSendOsc(item.oscTarget.host, item.oscTarget.port, config.xAddress, [
        { type: "f", value: parseFloat(xVal.toFixed(3)) },
      ]);
      onSendOsc(item.oscTarget.host, item.oscTarget.port, config.yAddress, [
        { type: "f", value: parseFloat(yVal.toFixed(3)) },
      ]);
    };

    const onMouseMove = (ev: MouseEvent) => updateValue(ev.clientX, ev.clientY);
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    updateValue(e.clientX, e.clientY);
  }, [editMode, item, onSendOsc, onSelect]);

  if (item.type === "button") {
    const config = item.config as ButtonConfig;
    const isToggleOn = config.mode === "toggle" && toggled;
    return (
      <motion.div
        whileTap={editMode ? undefined : { scale: 0.95 }}
        onClick={handleButtonClick}
        onMouseDown={editMode ? onDragStart : undefined}
        className="h-full rounded-xl flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden relative"
        style={{
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          boxShadow: isToggleOn ? `0 0 12px ${colors.border}` : undefined,
        }}
      >
        {editMode && (
          <div className="absolute top-0 left-0 right-0 h-4 bg-white/5 cursor-move" />
        )}
        <div className="text-sm font-semibold" style={{ color: colors.text }}>{item.name}</div>
        <div className="text-[9px] text-gray-500 mt-1 truncate max-w-full px-2">{item.oscAddress}</div>
        {config.mode === "toggle" && (
          <div
            className="text-[8px] mt-1 px-1.5 py-0.5 rounded"
            style={{
              color: isToggleOn ? colors.fill : "#6b7280",
              background: isToggleOn ? `${colors.fill}20` : "transparent",
            }}
          >
            {isToggleOn ? "ON" : "OFF"}
          </div>
        )}
      </motion.div>
    );
  }

  if (item.type === "slider") {
    const config = item.config as SliderConfig;
    const currentValue = config.min + sliderValue * (config.max - config.min);
    const displayValue = config.valueType === "i" ? Math.round(currentValue) : currentValue.toFixed(2);

    if (config.orientation === "vertical") {
      return (
        <div
          className="h-full rounded-xl flex flex-col items-center p-2 gap-1 select-none overflow-hidden"
          style={{ background: "#222244", border: "1px solid rgba(255,255,255,0.08)" }}
          onClick={editMode ? onSelect : undefined}
          onMouseDown={editMode ? onDragStart : undefined}
        >
          <div className="text-[10px] font-medium" style={{ color: colors.text }}>{item.name}</div>
          <div
            data-slider-track
            className="flex-1 w-7 bg-surface rounded-md relative overflow-hidden cursor-ns-resize"
            onMouseDown={handleSliderDrag}
          >
            <div
              className="absolute bottom-0 w-full rounded-md transition-[height] duration-75"
              style={{ height: `${sliderValue * 100}%`, background: `linear-gradient(to top, ${colors.fill}, ${colors.fill}80)` }}
            />
          </div>
          <div className="text-[10px] font-semibold" style={{ color: colors.text }}>{displayValue}</div>
          <div className="text-[8px] text-gray-600 truncate max-w-full">{item.oscAddress}</div>
        </div>
      );
    }

    return (
      <div
        className="h-full rounded-xl flex items-center px-3 gap-2 select-none overflow-hidden"
        style={{ background: "#222244", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={editMode ? onSelect : undefined}
        onMouseDown={editMode ? onDragStart : undefined}
      >
        <div className="text-[10px] font-medium min-w-[40px]" style={{ color: colors.text }}>{item.name}</div>
        <div
          data-slider-track
          className="flex-1 h-6 bg-surface rounded-md relative overflow-hidden cursor-ew-resize"
          onMouseDown={handleSliderDrag}
        >
          <div
            className="absolute left-0 h-full rounded-md transition-[width] duration-75"
            style={{ width: `${sliderValue * 100}%`, background: `linear-gradient(to right, ${colors.fill}, ${colors.fill}80)` }}
          />
        </div>
        <div className="text-[10px] font-semibold min-w-[30px] text-right" style={{ color: colors.text }}>{displayValue}</div>
      </div>
    );
  }

  if (item.type === "xy-pad") {
    const config = item.config as XYPadConfig;
    return (
      <div
        className="h-full rounded-xl flex flex-col p-2 select-none overflow-hidden"
        style={{ background: "#222244", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={editMode ? onSelect : undefined}
        onMouseDown={editMode ? onDragStart : undefined}
      >
        <div className="text-[10px] font-medium mb-1" style={{ color: colors.text }}>{item.name}</div>
        <div
          data-xy-pad
          className="flex-1 bg-surface rounded-lg relative cursor-crosshair border border-white/5"
          onMouseDown={handleXYDrag}
        >
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/5" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-white/5" />
          <div
            className="absolute w-3.5 h-3.5 rounded-full -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${xyValue.x * 100}%`,
              top: `${(1 - xyValue.y) * 100}%`,
              background: colors.fill,
              boxShadow: `0 0 8px ${colors.fill}80`,
            }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <div className="text-[8px] text-gray-600 truncate">{config.xAddress}</div>
          <div className="text-[9px]" style={{ color: colors.text }}>
            {xyValue.x.toFixed(2)}, {xyValue.y.toFixed(2)}
          </div>
          <div className="text-[8px] text-gray-600 truncate">{config.yAddress}</div>
        </div>
      </div>
    );
  }

  return null;
}
