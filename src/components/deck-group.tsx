"use client";

import type { DeckGroup, OscArg } from "@/lib/types";
import { DeckItemView } from "./deck-item";

interface DeckGroupProps {
  group: DeckGroup;
  editMode: boolean;
  onSendOsc: (host: string, port: number, address: string, args: OscArg[]) => void;
  onSelectItem?: (itemId: string) => void;
  onSelectGroup?: () => void;
  onDragStart?: (e: React.MouseEvent) => void;
}

const colorMap: Record<string, { bg: string; border: string; text: string }> = {
  blue:   { bg: "rgba(37,99,235,0.06)", border: "rgba(37,99,235,0.2)", text: "#93c5fd" },
  green:  { bg: "rgba(0,212,170,0.06)", border: "rgba(0,212,170,0.2)", text: "#6ee7b7" },
  purple: { bg: "rgba(139,92,246,0.06)", border: "rgba(139,92,246,0.2)", text: "#c4b5fd" },
  red:    { bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.2)", text: "#fca5a5" },
  orange: { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.2)", text: "#fcd34d" },
  yellow: { bg: "rgba(234,179,8,0.06)", border: "rgba(234,179,8,0.2)", text: "#fde68a" },
  gray:   { bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.08)", text: "#9ca3af" },
};

export function DeckGroupView({ group, editMode, onSendOsc, onSelectItem, onSelectGroup, onDragStart }: DeckGroupProps) {
  const colors = colorMap[group.color] ?? colorMap.gray;

  return (
    <div
      className="h-full rounded-xl relative overflow-hidden"
      style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
      onClick={editMode ? onSelectGroup : undefined}
      onMouseDown={editMode ? onDragStart : undefined}
    >
      <div
        className="absolute top-0 left-0 px-2 py-1 text-[10px] font-medium rounded-br-lg"
        style={{ color: colors.text, background: colors.bg }}
      >
        {group.name}
      </div>
      <div
        className="h-full pt-6 p-1"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${group.colSpan}, 1fr)`,
          gridTemplateRows: `repeat(${Math.max(1, group.rowSpan - 1)}, 1fr)`,
          gap: "4px",
        }}
      >
        {group.items.map((item) => (
          <div
            key={item.id}
            style={{
              gridColumn: `${item.col + 1} / span ${item.colSpan}`,
              gridRow: `${item.row + 1} / span ${item.rowSpan}`,
            }}
          >
            <DeckItemView
              item={item}
              editMode={editMode}
              onSendOsc={onSendOsc}
              onSelect={() => onSelectItem?.(item.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
