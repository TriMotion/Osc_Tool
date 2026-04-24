"use client";

import { useCallback, useState } from "react";
import type { DmxFlashConfig } from "@/lib/dmx-types";

interface DmxFlashTileProps {
  name: string;
  config: DmxFlashConfig;
  color: { bg: string; border: string; text: string; fill: string };
  onFlash: (channels: number[], value: number) => void;
  onRelease: (channels: number[]) => void;
  editMode: boolean;
  onSelect?: () => void;
}

export function DmxFlashTile({ name, config, color, onFlash, onRelease, editMode, onSelect }: DmxFlashTileProps) {
  const [pressed, setPressed] = useState(false);

  const handleDown = useCallback((e: React.MouseEvent) => {
    if (editMode) { onSelect?.(); return; }
    e.preventDefault();
    setPressed(true);
    onFlash(config.channels, config.value);
    const onUp = () => {
      setPressed(false);
      onRelease(config.channels);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mouseup", onUp);
  }, [editMode, onSelect, onFlash, onRelease, config]);

  return (
    <div
      className="w-full h-full rounded-md flex flex-col justify-center items-center border cursor-pointer select-none transition-all"
      style={{
        background: pressed ? "#ef4444" : color.bg,
        borderColor: pressed ? "#ef4444" : color.border,
        boxShadow: pressed ? "0 0 20px #ef444480" : "none",
      }}
      onMouseDown={handleDown}
    >
      <div className="text-[11px] font-bold" style={{ color: pressed ? "#fff" : color.text }}>{name}</div>
      <div className="text-[9px]" style={{ color: pressed ? "rgba(255,255,255,0.7)" : "#6b7280" }}>
        {pressed ? `ACTIVE — ${config.value}` : `CH ${config.channels.join(",")}`}
      </div>
    </div>
  );
}
