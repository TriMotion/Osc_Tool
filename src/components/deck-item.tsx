"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import type { DeckItem, ButtonConfig, SliderConfig, XYPadConfig, OscArg } from "@/lib/types";
import type { DmxTriggerConfig, DmxFaderConfig, DmxFlashConfig } from "@/lib/dmx-types";
import type { DmxEffect } from "@/lib/dmx-types";
import { DmxTriggerTile } from "./dmx/dmx-trigger-tile";
import { DmxFaderTile } from "./dmx/dmx-fader-tile";
import { DmxFlashTile } from "./dmx/dmx-flash-tile";

interface DeckItemProps {
  item: DeckItem;
  editMode: boolean;
  value?: unknown;
  onSendOsc: (host: string, port: number, address: string, args: OscArg[]) => void;
  onValueChange?: (itemId: string, value: unknown) => void;
  onSelect?: () => void;
  onDragStart?: (e: React.MouseEvent) => void;
  dmxEffects?: DmxEffect[];
  onDmxTrigger?: (effectId: string) => void;
  onDmxSetChannel?: (channel: number, value: number) => void;
  onDmxReleaseChannel?: (channel: number) => void;
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

export function DeckItemView({ item, editMode, value, onSendOsc, onValueChange, onSelect, onDragStart, dmxEffects, onDmxTrigger, onDmxSetChannel, onDmxReleaseChannel }: DeckItemProps) {
  const extVal = value as Record<string, unknown> | undefined;
  const toggled = !!(extVal?.toggled);
  const sliderValue = typeof extVal?.slider === "number" ? extVal.slider : 0.5;
  const xyValue = extVal?.xy as { x: number; y: number } | undefined ?? { x: 0.5, y: 0.5 };

  const colors = colorMap[item.color] ?? colorMap.gray;

  const handleButtonClick = () => {
    if (editMode) { onSelect?.(); return; }
    const config = item.config as ButtonConfig;
    if (config.mode === "trigger") {
      onSendOsc(item.oscTarget.host, item.oscTarget.port, item.oscAddress, [config.triggerValue]);
      onValueChange?.(item.id, { triggered: true });
    } else {
      const newToggled = !toggled;
      const val = newToggled ? config.toggleOnValue : config.toggleOffValue;
      onSendOsc(item.oscTarget.host, item.oscTarget.port, item.oscAddress, [val]);
      onValueChange?.(item.id, { toggled: newToggled });
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
      onSendOsc(item.oscTarget.host, item.oscTarget.port, item.oscAddress, [
        { type: config.valueType, value: rounded },
      ]);
      onValueChange?.(item.id, { slider: ratio });
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
      const xVal = config.xMin + xRatio * (config.xMax - config.xMin);
      const yVal = config.yMin + yRatio * (config.yMax - config.yMin);
      onSendOsc(item.oscTarget.host, item.oscTarget.port, config.xAddress, [
        { type: "f", value: parseFloat(xVal.toFixed(3)) },
      ]);
      onSendOsc(item.oscTarget.host, item.oscTarget.port, config.yAddress, [
        { type: "f", value: parseFloat(yVal.toFixed(3)) },
      ]);
      onValueChange?.(item.id, { xy: { x: xRatio, y: yRatio } });
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
    const isToggle = config.mode === "toggle";
    const isToggleOn = isToggle && toggled;
    const isToggleOff = isToggle && !toggled;
    return (
      <motion.div
        whileTap={editMode ? undefined : { scale: 0.95 }}
        onClick={handleButtonClick}
        onMouseDown={editMode ? onDragStart : undefined}
        className="h-full rounded-lg flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden relative p-3"
        style={{
          background: isToggleOff ? "rgba(255,255,255,0.02)" : colors.bg,
          border: `1px solid ${isToggleOff ? "rgba(255,255,255,0.06)" : colors.border}`,
          boxShadow: isToggleOn ? `0 0 16px ${colors.border}` : undefined,
          opacity: isToggleOff ? 0.5 : 1,
          transition: "all 0.15s ease",
        }}
      >
        {editMode && (
          <div className="absolute top-0 left-0 right-0 h-4 bg-white/5 cursor-move" />
        )}
        <div
          className="font-semibold text-center leading-tight"
          style={{
            color: isToggleOff ? "#4b5563" : colors.text,
            fontSize: "clamp(12px, 2.5vw, 18px)",
          }}
        >
          {item.name}
        </div>
        <div
          className="mt-1 truncate max-w-full px-1 text-center"
          style={{ fontSize: "clamp(8px, 1.5vw, 11px)", color: isToggleOff ? "#374151" : "#6b7280" }}
        >
          {item.oscAddress}
        </div>
        {isToggle && (
          <div
            className="mt-1.5 px-2 py-0.5 rounded font-semibold"
            style={{
              fontSize: "clamp(9px, 1.5vw, 12px)",
              color: isToggleOn ? colors.fill : "#4b5563",
              background: isToggleOn ? `${colors.fill}20` : "rgba(255,255,255,0.03)",
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
          className="h-full rounded-lg flex flex-col items-center p-2 gap-1 select-none overflow-hidden"
          style={{ background: "#222244", border: "1px solid rgba(255,255,255,0.08)" }}
          onClick={editMode ? onSelect : undefined}
          onMouseDown={editMode ? onDragStart : undefined}
        >
          <div className="text-[10px] font-medium" style={{ color: colors.text }}>{item.name}</div>
          <div
            data-slider-track
            className="flex-1 w-7 bg-black rounded-md relative overflow-hidden cursor-ns-resize"
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
        className="h-full rounded-lg flex items-center px-3 gap-2 select-none overflow-hidden"
        style={{ background: "#222244", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={editMode ? onSelect : undefined}
        onMouseDown={editMode ? onDragStart : undefined}
      >
        <div className="text-[10px] font-medium min-w-[40px]" style={{ color: colors.text }}>{item.name}</div>
        <div
          data-slider-track
          className="flex-1 h-6 bg-black rounded-md relative overflow-hidden cursor-ew-resize"
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
        className="h-full rounded-lg flex flex-col p-2 select-none overflow-hidden"
        style={{ background: "#222244", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={editMode ? onSelect : undefined}
        onMouseDown={editMode ? onDragStart : undefined}
      >
        <div className="text-[10px] font-medium mb-1" style={{ color: colors.text }}>{item.name}</div>
        <div
          data-xy-pad
          className="flex-1 bg-black rounded-lg relative cursor-crosshair border border-white/5"
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

  if (item.type === "dmx-trigger") {
    return (
      <DmxTriggerTile
        name={item.name}
        config={item.config as DmxTriggerConfig}
        effects={dmxEffects ?? []}
        color={colors}
        onTrigger={(id) => onDmxTrigger?.(id)}
        editMode={editMode}
        onSelect={onSelect}
      />
    );
  }

  if (item.type === "dmx-fader") {
    const faderConfig = item.config as DmxFaderConfig;
    const faderValue = typeof (extVal as any)?.dmxValue === "number" ? (extVal as any).dmxValue : faderConfig.min;
    return (
      <DmxFaderTile
        name={item.name}
        config={faderConfig}
        value={faderValue}
        color={colors}
        onValueChange={(ch, val) => {
          onDmxSetChannel?.(ch, val);
          onValueChange?.(item.id, { dmxValue: val });
        }}
        editMode={editMode}
        onSelect={onSelect}
      />
    );
  }

  if (item.type === "dmx-flash") {
    return (
      <DmxFlashTile
        name={item.name}
        config={item.config as DmxFlashConfig}
        color={colors}
        onFlash={(channels, value) => {
          for (const ch of channels) onDmxSetChannel?.(ch, value);
        }}
        onRelease={(channels) => {
          for (const ch of channels) onDmxReleaseChannel?.(ch);
        }}
        editMode={editMode}
        onSelect={onSelect}
      />
    );
  }

  return null;
}
