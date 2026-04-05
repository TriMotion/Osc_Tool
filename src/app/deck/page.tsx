"use client";

import { useState, useCallback, useRef } from "react";
import { useDeck } from "@/hooks/use-deck";
import { useEndpoints } from "@/hooks/use-osc";
import { DeckTopbar } from "@/components/deck-topbar";
import { DeckToolbar } from "@/components/deck-toolbar";
import { DeckGrid } from "@/components/deck-grid";
import { DeckConfigPanel } from "@/components/deck-config-panel";
import type { DeckItem, ButtonConfig, SliderConfig, XYPadConfig } from "@/lib/types";

function defaultButtonConfig(): ButtonConfig {
  return {
    mode: "trigger",
    triggerValue: { type: "f", value: 1 },
    toggleOnValue: { type: "f", value: 1 },
    toggleOffValue: { type: "f", value: 0 },
  };
}

function defaultSliderConfig(): SliderConfig {
  return { orientation: "vertical", min: 0, max: 1, valueType: "f" };
}

function defaultXYPadConfig(): XYPadConfig {
  return {
    xAddress: "/x", yAddress: "/y",
    xMin: 0, xMax: 1, yMin: 0, yMax: 1,
  };
}

export default function DeckPage() {
  const {
    decks, activeDeck, activePage,
    selectDeck, selectPage,
    createDeck, updateDeck, deleteDeck,
    createPage, updatePage, deletePage,
    addItem, updateItem, removeItem,
    addGroup, updateGroup, removeGroup,
    sendOsc, setValue, itemValues,
  } = useDeck();

  const { endpoints: senderEndpoints } = useEndpoints("sender");
  const { endpoints: listenerEndpoints } = useEndpoints("listener");
  const allEndpoints = [...senderEndpoints, ...listenerEndpoints];

  const [editMode, setEditMode] = useState(false);
  const [placingType, setPlacingType] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const lastUsedEndpointId = useRef<string | undefined>(undefined);

  const selectedItem = activePage
    ? activePage.items.find((i) => i.id === selectedItemId) ??
      activePage.groups.flatMap((g) => g.items).find((i) => i.id === selectedItemId) ??
      null
    : null;

  const selectedGroup = activePage?.groups.find((g) => g.id === selectedGroupId) ?? null;

  const handlePlaceItem = useCallback(async (col: number, row: number) => {
    if (!placingType) return;

    if (placingType === "group") {
      await addGroup({
        name: "Group",
        color: "gray",
        col, row, colSpan: 3, rowSpan: 3,
      });
    } else {
      const configs: Record<string, ButtonConfig | SliderConfig | XYPadConfig> = {
        button: defaultButtonConfig(),
        slider: defaultSliderConfig(),
        "xy-pad": defaultXYPadConfig(),
      };
      const spans: Record<string, { colSpan: number; rowSpan: number }> = {
        button: { colSpan: 2, rowSpan: 1 },
        slider: { colSpan: 1, rowSpan: 3 },
        "xy-pad": { colSpan: 3, rowSpan: 3 },
      };
      const s = spans[placingType] ?? { colSpan: 1, rowSpan: 1 };
      const lastEp = lastUsedEndpointId.current
        ? allEndpoints.find((e) => e.id === lastUsedEndpointId.current)
        : undefined;
      await addItem({
        name: placingType.charAt(0).toUpperCase() + placingType.slice(1),
        type: placingType as DeckItem["type"],
        col, row, ...s,
        oscAddress: "/address",
        oscTarget: lastEp
          ? { host: lastEp.host, port: lastEp.port }
          : { host: "127.0.0.1", port: 8000 },
        oscTargetEndpointId: lastEp?.id,
        color: "gray",
        config: configs[placingType],
      });
    }
    setPlacingType(null);
  }, [placingType, addItem, addGroup, allEndpoints]);

  const handleSelectItem = useCallback((itemId: string) => {
    if (!editMode) return;
    setSelectedItemId(itemId);
    setSelectedGroupId(null);
  }, [editMode]);

  const handleSelectGroup = useCallback((groupId: string) => {
    if (!editMode) return;
    setSelectedGroupId(groupId);
    setSelectedItemId(null);
  }, [editMode]);

  const handleCloseConfig = () => {
    setSelectedItemId(null);
    setSelectedGroupId(null);
  };

  return (
    <div className="flex flex-col h-full">
      <DeckTopbar
        decks={decks}
        activeDeck={activeDeck}
        activePage={activePage}
        editMode={editMode}
        onSelectDeck={selectDeck}
        onSelectPage={selectPage}
        onCreateDeck={createDeck}
        onDeleteDeck={deleteDeck}
        onRenameDeck={(id, name) => updateDeck(id, { name })}
        onCreatePage={createPage}
        onDeletePage={deletePage}
        onRenamePage={(id, name) => updatePage(id, { name })}
        onToggleEdit={() => {
          setEditMode(!editMode);
          setPlacingType(null);
          handleCloseConfig();
        }}
      />

      {editMode && (
        <DeckToolbar
          placingType={placingType}
          onStartPlace={(type) => setPlacingType(type)}
          onCancelPlace={() => setPlacingType(null)}
        />
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {activePage && activeDeck ? (
          <DeckGrid
            page={activePage}
            gridColumns={activeDeck.gridColumns}
            gridRows={activeDeck.gridRows}
            editMode={editMode}
            placingType={placingType}
            onSendOsc={sendOsc}
            onValueChange={setValue}
            itemValues={itemValues}
            onSelectItem={handleSelectItem}
            onSelectGroup={handleSelectGroup}
            onPlaceItem={handlePlaceItem}
            onMoveItem={(itemId, col, row) => updateItem(itemId, { col, row })}
            onResizeItem={(itemId, colSpan, rowSpan) => updateItem(itemId, { colSpan, rowSpan })}
            onMoveGroup={(groupId, col, row) => updateGroup(groupId, { col, row })}
            onResizeGroup={(groupId, colSpan, rowSpan) => updateGroup(groupId, { colSpan, rowSpan })}
            onMoveItemToGroup={(itemId, groupId, absCol, absRow) => moveItemToGroup(itemId, groupId, absCol, absRow)}
            onMoveItemOutOfGroup={(itemId, groupId, absCol, absRow) => moveItemOutOfGroup(itemId, groupId, absCol, absRow)}
            onPushItems={(draggedId, dropCol, dropRow, dropColSpan, dropRowSpan) => {
              if (!activePage || !activeDeck) return;
              const cols = activeDeck.gridColumns;
              const rows = activeDeck.gridRows;

              // Build a list of items to process (excluding the dragged one)
              type Pos = { id: string; col: number; row: number; colSpan: number; rowSpan: number };
              const positions: Pos[] = activePage.items
                .filter(i => i.id !== draggedId)
                .map(i => ({ id: i.id, col: i.col, row: i.row, colSpan: i.colSpan, rowSpan: i.rowSpan }));

              const overlaps = (a: Pos, b: Pos) =>
                a.col < b.col + b.colSpan && a.col + a.colSpan > b.col &&
                a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row;

              const isOccupied = (pos: Pos, exclude: string) => {
                const dragged = { id: draggedId, col: dropCol, row: dropRow, colSpan: dropColSpan, rowSpan: dropRowSpan };
                if (overlaps(pos, dragged)) return true;
                return positions.some(p => p.id !== exclude && overlaps(pos, p));
              };

              const fitsInGrid = (p: Pos) =>
                p.col >= 0 && p.row >= 0 && p.col + p.colSpan <= cols && p.row + p.rowSpan <= rows;

              const dropArea: Pos = { id: draggedId, col: dropCol, row: dropRow, colSpan: dropColSpan, rowSpan: dropRowSpan };

              // Find all overlapping items and try to resolve
              for (const item of positions) {
                if (!overlaps(item, dropArea)) continue;

                // 1. Try pushing right
                const rightPos = { ...item, col: dropCol + dropColSpan };
                if (fitsInGrid(rightPos) && !isOccupied(rightPos, item.id)) {
                  updateItem(item.id, { col: rightPos.col, row: rightPos.row });
                  item.col = rightPos.col;
                  continue;
                }

                // 2. Try pushing left
                const leftPos = { ...item, col: dropCol - item.colSpan };
                if (fitsInGrid(leftPos) && !isOccupied(leftPos, item.id)) {
                  updateItem(item.id, { col: leftPos.col, row: leftPos.row });
                  item.col = leftPos.col;
                  continue;
                }

                // 3. Try pushing down
                const downPos = { ...item, row: dropRow + dropRowSpan };
                if (fitsInGrid(downPos) && !isOccupied(downPos, item.id)) {
                  updateItem(item.id, { col: downPos.col, row: downPos.row });
                  item.row = downPos.row;
                  continue;
                }

                // 4. Find any free spot (scan right-to-left, top-to-bottom)
                let placed = false;
                for (let r = 0; r <= rows - item.rowSpan && !placed; r++) {
                  for (let c = 0; c <= cols - item.colSpan && !placed; c++) {
                    const candidate = { ...item, col: c, row: r };
                    if (!isOccupied(candidate, item.id)) {
                      updateItem(item.id, { col: c, row: r });
                      item.col = c;
                      item.row = r;
                      placed = true;
                    }
                  }
                }
              }
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-600">
            No deck selected. Create one to get started.
          </div>
        )}

        {editMode && (selectedItem || selectedGroup) && (
          <DeckConfigPanel
            item={selectedItem}
            group={selectedGroup}
            onUpdateItem={selectedItemId ? (updates) => {
              if (updates.oscTargetEndpointId) {
                lastUsedEndpointId.current = updates.oscTargetEndpointId;
              }
              updateItem(selectedItemId, updates);
            } : undefined}
            onUpdateGroup={selectedGroupId ? (updates) => updateGroup(selectedGroupId, updates) : undefined}
            onDelete={() => {
              if (selectedItemId) removeItem(selectedItemId);
              if (selectedGroupId) removeGroup(selectedGroupId);
              handleCloseConfig();
            }}
            onClose={handleCloseConfig}
          />
        )}
      </div>
    </div>
  );
}
