"use client";

import { useRef, useCallback, useState } from "react";
import type { DeckPage, DeckItem, DeckGroup, OscArg } from "@/lib/types";
import { DeckItemView } from "./deck-item";
import { DeckGroupView } from "./deck-group";

interface DeckGridProps {
  page: DeckPage;
  gridColumns: number;
  gridRows: number;
  editMode: boolean;
  placingType: string | null;
  onSendOsc: (host: string, port: number, address: string, args: OscArg[]) => void;
  onValueChange: (itemId: string, value: unknown) => void;
  itemValues: Record<string, unknown>;
  onSelectItem: (itemId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onPlaceItem: (col: number, row: number) => void;
  onMoveItem: (itemId: string, col: number, row: number) => void;
  onResizeItem: (itemId: string, colSpan: number, rowSpan: number) => void;
  onMoveGroup: (groupId: string, col: number, row: number) => void;
  onResizeGroup: (groupId: string, colSpan: number, rowSpan: number) => void;
}

export function DeckGrid({
  page, gridColumns, gridRows, editMode, placingType,
  onSendOsc, onValueChange, itemValues, onSelectItem, onSelectGroup,
  onPlaceItem, onMoveItem, onResizeItem, onMoveGroup, onResizeGroup,
}: DeckGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [dragPreview, setDragPreview] = useState<{ col: number; row: number; colSpan: number; rowSpan: number } | null>(null);

  const getCellFromMouse = useCallback((clientX: number, clientY: number) => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const cellW = rect.width / gridColumns;
    const cellH = rect.height / gridRows;
    const col = Math.max(0, Math.min(gridColumns - 1, Math.floor(x / cellW)));
    const row = Math.max(0, Math.min(gridRows - 1, Math.floor(y / cellH)));
    return { col, row };
  }, [gridColumns, gridRows]);

  const handleDragStart = useCallback((
    e: React.MouseEvent,
    id: string,
    isGroup: boolean,
    startCol: number,
    startRow: number,
    colSpan: number,
    rowSpan: number,
  ) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();

    const startCell = getCellFromMouse(e.clientX, e.clientY);
    if (!startCell) return;
    const offsetCol = startCell.col - startCol;
    const offsetRow = startCell.row - startRow;

    setDragPreview({ col: startCol, row: startRow, colSpan, rowSpan });

    const onMove = (ev: MouseEvent) => {
      const cell = getCellFromMouse(ev.clientX, ev.clientY);
      if (!cell) return;
      const newCol = Math.max(0, Math.min(gridColumns - colSpan, cell.col - offsetCol));
      const newRow = Math.max(0, Math.min(gridRows - rowSpan, cell.row - offsetRow));
      setDragPreview({ col: newCol, row: newRow, colSpan, rowSpan });
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const cell = getCellFromMouse(ev.clientX, ev.clientY);
      if (cell) {
        const newCol = Math.max(0, Math.min(gridColumns - colSpan, cell.col - offsetCol));
        const newRow = Math.max(0, Math.min(gridRows - rowSpan, cell.row - offsetRow));
        if (isGroup) onMoveGroup(id, newCol, newRow);
        else onMoveItem(id, newCol, newRow);
      }
      setDragPreview(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [editMode, getCellFromMouse, gridColumns, gridRows, onMoveItem, onMoveGroup]);

  const handleResizeStart = useCallback((
    e: React.MouseEvent,
    id: string,
    isGroup: boolean,
    startCol: number,
    startRow: number,
    colSpan: number,
    rowSpan: number,
  ) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();

    setDragPreview({ col: startCol, row: startRow, colSpan, rowSpan });

    const onMove = (ev: MouseEvent) => {
      const cell = getCellFromMouse(ev.clientX, ev.clientY);
      if (!cell) return;
      const newColSpan = Math.max(1, cell.col - startCol + 1);
      const newRowSpan = Math.max(1, cell.row - startRow + 1);
      setDragPreview({ col: startCol, row: startRow, colSpan: newColSpan, rowSpan: newRowSpan });
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const cell = getCellFromMouse(ev.clientX, ev.clientY);
      if (cell) {
        const newColSpan = Math.max(1, cell.col - startCol + 1);
        const newRowSpan = Math.max(1, cell.row - startRow + 1);
        if (isGroup) onResizeGroup(id, newColSpan, newRowSpan);
        else onResizeItem(id, newColSpan, newRowSpan);
      }
      setDragPreview(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [editMode, getCellFromMouse, onResizeItem, onResizeGroup]);

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
      ref={gridRef}
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

      {/* Drag preview */}
      {dragPreview && (
        <div
          className="rounded-xl border-2 border-dashed border-accent/50 bg-accent/5 pointer-events-none"
          style={{
            gridColumn: `${dragPreview.col + 1} / span ${dragPreview.colSpan}`,
            gridRow: `${dragPreview.row + 1} / span ${dragPreview.rowSpan}`,
            zIndex: 50,
          }}
        />
      )}

      {page.groups.map((group) => (
        <div
          key={group.id}
          className="relative"
          style={{
            gridColumn: `${group.col + 1} / span ${group.colSpan}`,
            gridRow: `${group.row + 1} / span ${group.rowSpan}`,
          }}
        >
          <DeckGroupView
            group={group}
            editMode={editMode}
            onSendOsc={onSendOsc}
            onValueChange={onValueChange}
            itemValues={itemValues}
            onSelectItem={(itemId) => onSelectItem(itemId)}
            onSelectGroup={() => onSelectGroup(group.id)}
            onDragStart={(e) => handleDragStart(e, group.id, true, group.col, group.row, group.colSpan, group.rowSpan)}
          />
          {editMode && (
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
              style={{ background: "linear-gradient(135deg, transparent 50%, rgba(0,212,170,0.5) 50%)", borderRadius: "0 0 10px 0" }}
              onMouseDown={(e) => handleResizeStart(e, group.id, true, group.col, group.row, group.colSpan, group.rowSpan)}
            />
          )}
        </div>
      ))}

      {page.items.map((item) => (
        <div
          key={item.id}
          className="relative"
          style={{
            gridColumn: `${item.col + 1} / span ${item.colSpan}`,
            gridRow: `${item.row + 1} / span ${item.rowSpan}`,
          }}
        >
          <DeckItemView
            item={item}
            editMode={editMode}
            value={itemValues[item.id]}
            onSendOsc={onSendOsc}
            onValueChange={onValueChange}
            onSelect={() => onSelectItem(item.id)}
            onDragStart={(e) => handleDragStart(e, item.id, false, item.col, item.row, item.colSpan, item.rowSpan)}
          />
          {editMode && (
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
              style={{ background: "linear-gradient(135deg, transparent 50%, rgba(0,212,170,0.5) 50%)", borderRadius: "0 0 10px 0" }}
              onMouseDown={(e) => handleResizeStart(e, item.id, false, item.col, item.row, item.colSpan, item.rowSpan)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
