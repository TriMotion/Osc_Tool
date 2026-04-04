"use client";

import type { DeckPage, OscArg } from "@/lib/types";
import { DeckItemView } from "./deck-item";
import { DeckGroupView } from "./deck-group";

interface DeckGridProps {
  page: DeckPage;
  gridColumns: number;
  gridRows: number;
  editMode: boolean;
  placingType: string | null;
  onSendOsc: (host: string, port: number, address: string, args: OscArg[]) => void;
  onSelectItem: (itemId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onPlaceItem: (col: number, row: number) => void;
  onMoveItem: (itemId: string, col: number, row: number) => void;
}

export function DeckGrid({
  page, gridColumns, gridRows, editMode, placingType,
  onSendOsc, onSelectItem, onSelectGroup, onPlaceItem, onMoveItem,
}: DeckGridProps) {

  const handleCellClick = (col: number, row: number) => {
    if (!editMode || !placingType) return;
    onPlaceItem(col, row);
  };

  const emptyCells: { col: number; row: number }[] = [];
  if (editMode) {
    const occupied = new Set<string>();
    for (const item of page.items) {
      for (let c = item.col; c < item.col + item.colSpan; c++) {
        for (let r = item.row; r < item.row + item.rowSpan; r++) {
          occupied.add(`${c},${r}`);
        }
      }
    }
    for (const group of page.groups) {
      for (let c = group.col; c < group.col + group.colSpan; c++) {
        for (let r = group.row; r < group.row + group.rowSpan; r++) {
          occupied.add(`${c},${r}`);
        }
      }
    }
    for (let c = 0; c < gridColumns; c++) {
      for (let r = 0; r < gridRows; r++) {
        if (!occupied.has(`${c},${r}`)) {
          emptyCells.push({ col: c, row: r });
        }
      }
    }
  }

  return (
    <div
      className="flex-1 p-4"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${gridColumns}, 1fr)`,
        gridTemplateRows: `repeat(${gridRows}, 1fr)`,
        gap: "8px",
      }}
    >
      {emptyCells.map(({ col, row }) => (
        <div
          key={`empty-${col}-${row}`}
          onClick={() => handleCellClick(col, row)}
          className={`rounded-lg transition-colors ${
            placingType
              ? "border border-dashed border-accent/30 hover:bg-accent/5 cursor-pointer"
              : "border border-dashed border-white/5"
          }`}
          style={{
            gridColumn: `${col + 1} / span 1`,
            gridRow: `${row + 1} / span 1`,
          }}
        />
      ))}

      {page.groups.map((group) => (
        <div
          key={group.id}
          style={{
            gridColumn: `${group.col + 1} / span ${group.colSpan}`,
            gridRow: `${group.row + 1} / span ${group.rowSpan}`,
          }}
        >
          <DeckGroupView
            group={group}
            editMode={editMode}
            onSendOsc={onSendOsc}
            onSelectItem={(itemId) => onSelectItem(itemId)}
            onSelectGroup={() => onSelectGroup(group.id)}
          />
        </div>
      ))}

      {page.items.map((item) => (
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
            onSelect={() => onSelectItem(item.id)}
          />
        </div>
      ))}
    </div>
  );
}
