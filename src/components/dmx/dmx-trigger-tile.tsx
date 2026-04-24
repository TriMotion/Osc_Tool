"use client";

import { motion } from "framer-motion";
import type { DmxTriggerConfig, DmxEffect } from "@/lib/dmx-types";

interface DmxTriggerTileProps {
  name: string;
  config: DmxTriggerConfig;
  effects: DmxEffect[];
  color: { bg: string; border: string; text: string; fill: string };
  onTrigger: (effectId: string) => void;
  editMode: boolean;
  onSelect?: () => void;
}

export function DmxTriggerTile({ name, config, effects, color, onTrigger, editMode, onSelect }: DmxTriggerTileProps) {
  const effect = effects.find((e) => e.id === config.dmxEffectId);

  const handleClick = () => {
    if (editMode) { onSelect?.(); return; }
    if (config.dmxEffectId) onTrigger(config.dmxEffectId);
  };

  return (
    <motion.button
      className="w-full h-full rounded-md flex flex-col justify-between p-2 text-left border overflow-hidden relative"
      style={{ background: color.bg, borderColor: color.border }}
      whileTap={editMode ? undefined : { scale: 0.96 }}
      onClick={handleClick}
    >
      <div>
        <div className="text-[11px] font-semibold truncate" style={{ color: color.text }}>{name}</div>
        <div className="text-[9px] text-gray-500 truncate">{effect?.name ?? "No effect"}</div>
      </div>
      {effect && effect.segments.length > 0 && (
        <svg width="100%" height="16" viewBox="0 0 80 16" preserveAspectRatio="none" className="opacity-40">
          <line x1="0" y1="14" x2="80" y2="2" stroke={color.fill} strokeWidth="1.5" />
        </svg>
      )}
    </motion.button>
  );
}
