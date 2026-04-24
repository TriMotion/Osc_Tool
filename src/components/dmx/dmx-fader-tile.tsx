"use client";

import { useCallback } from "react";
import type { DmxFaderConfig } from "@/lib/dmx-types";

interface DmxFaderTileProps {
  name: string;
  config: DmxFaderConfig;
  value: number;
  color: { bg: string; border: string; text: string; fill: string };
  onValueChange: (channel: number, value: number) => void;
  editMode: boolean;
  onSelect?: () => void;
}

export function DmxFaderTile({ name, config, value, color, onValueChange, editMode, onSelect }: DmxFaderTileProps) {
  const ratio = config.max !== config.min ? (value - config.min) / (config.max - config.min) : 0;

  const handleDrag = useCallback((e: React.MouseEvent) => {
    if (editMode) { onSelect?.(); return; }
    const track = (e.currentTarget as HTMLElement).closest("[data-dmx-fader]") as HTMLElement;
    if (!track) return;
    const rect = track.getBoundingClientRect();

    const update = (clientY: number) => {
      const r = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const dmxValue = Math.round(config.min + r * (config.max - config.min));
      onValueChange(config.channel, dmxValue);
    };

    update(e.clientY);
    const onMove = (ev: MouseEvent) => update(ev.clientY);
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [editMode, onSelect, onValueChange, config]);

  return (
    <div
      className="w-full h-full rounded-md flex flex-col items-center p-2 border"
      style={{ background: color.bg, borderColor: color.border }}
    >
      <div className="text-[9px] font-bold truncate mb-1" style={{ color: color.text }}>{name}</div>
      <div
        data-dmx-fader
        className="flex-1 w-5 bg-black/40 rounded-full relative cursor-pointer"
        onMouseDown={handleDrag}
      >
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full"
          style={{
            height: `${ratio * 100}%`,
            background: `linear-gradient(to top, ${color.fill}80, ${color.fill}30)`,
          }}
        />
        <div
          className="absolute left-1/2 -translate-x-1/2 translate-y-1/2 w-6 h-2 rounded"
          style={{
            bottom: `${ratio * 100}%`,
            background: color.fill,
            boxShadow: `0 0 6px ${color.fill}60`,
          }}
        />
      </div>
      <div className="text-[10px] font-bold mt-1" style={{ color: color.text }}>{Math.round(value)}</div>
    </div>
  );
}
