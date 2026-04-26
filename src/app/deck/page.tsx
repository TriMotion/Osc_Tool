"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useDeck } from "@/hooks/use-deck";
import { useEndpoints } from "@/hooks/use-osc";
import { DeckTopbar } from "@/components/deck-topbar";
import { DeckToolbar } from "@/components/deck-toolbar";
import { DeckGrid } from "@/components/deck-grid";
import { DeckConfigPanel } from "@/components/deck-config-panel";
import type { DeckItem, ButtonConfig, SliderConfig, XYPadConfig } from "@/lib/types";
import { useDmx } from "@/hooks/use-dmx";
import { useOscEffects } from "@/hooks/use-osc-effects";
import type { DmxTriggerConfig, DmxFaderConfig, DmxFlashConfig } from "@/lib/dmx-types";
import { SectionSelector } from "@/components/live/section-selector";
import { DeviceStrip } from "@/components/live/device-strip";
import { ActivityFeed } from "@/components/live/activity-feed";
import { MappingConfigPanel } from "@/components/live/mapping-config-panel";
import { useLiveMonitor } from "@/hooks/use-live-monitor";
import { useOscTriggerMonitor } from "@/hooks/use-osc-trigger-monitor";
import { useRecorderContext } from "@/contexts/recorder-context";
import { useMidiControl } from "@/hooks/use-midi";


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

function defaultDmxTriggerConfig(): DmxTriggerConfig {
  return { dmxEffectId: "" };
}
function defaultDmxFaderConfig(): DmxFaderConfig {
  return { channel: 1, min: 0, max: 255 };
}
function defaultDmxFlashConfig(): DmxFlashConfig {
  return { channels: [1], value: 255 };
}

export default function DeckPage() {
  const {
    decks, activeDeck, activePage,
    selectDeck, selectPage,
    createDeck, updateDeck, deleteDeck,
    createPage, updatePage, deletePage,
    addItem, updateItem, removeItem,
    addGroup, updateGroup, removeGroup,
    moveItemToGroup, moveItemOutOfGroup,
    sendOsc, setValue, itemValues,
  } = useDeck();

  const { endpoints: senderEndpoints } = useEndpoints("sender");
  const { endpoints: listenerEndpoints } = useEndpoints("listener");
  const allEndpoints = [...senderEndpoints, ...listenerEndpoints];

  const { effects: dmxEffects, triggers: dmxTriggers, triggerEffect, setChannel, releaseChannel } = useDmx();
  const { effects: oscEffects, triggers: oscEffectTriggers } = useOscEffects();

  const [mode, setMode] = useState<"edit" | "live">("live");
  const [editMode, setEditMode] = useState(false);
  const [placingType, setPlacingType] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const lastUsedEndpointId = useRef<string | undefined>(undefined);

  // Live mode hooks
  const recorder = useRecorderContext();
  const { devices: connectedPorts } = useMidiControl();
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [showUnmapped, setShowUnmapped] = useState(false);

  const { entries, deviceActivity } = useLiveMonitor({
    recording: recorder.recording,
    endpoints: senderEndpoints,
    activeSectionId,
  });

  useOscTriggerMonitor({
    recording: recorder.recording,
    activeSectionId,
  });

  const flashTriggers = useMemo(() => {
    const triggers: Record<string, number> = {};
    for (const entry of entries) {
      if (entry.mapping) {
        triggers[entry.mapping.id] = (triggers[entry.mapping.id] ?? 0) + 1;
      }
    }
    return triggers;
  }, [entries]);

  const handleUpdateMappings = useCallback((mappings: import("@/lib/types").OscMapping[]) => {
    recorder.patchRecording({ oscMappings: mappings });
  }, [recorder]);

  const handleUpdateDeviceLinks = useCallback((links: Record<string, string>) => {
    recorder.patchRecording({ liveDeviceLinks: links });
  }, [recorder]);

  const handleToggleDevice = useCallback((deviceName: string, disabled: boolean) => {
    const current = recorder.recording?.disabledLiveDevices ?? [];
    const next = disabled
      ? [...current, deviceName]
      : current.filter((d) => d !== deviceName);
    recorder.patchRecording({ disabledLiveDevices: next });
  }, [recorder]);

  const selectedItem = activePage
    ? activePage.items.find((i) => i.id === selectedItemId) ??
      activePage.groups.flatMap((g) => g.items).find((i) => i.id === selectedItemId) ??
      null
    : null;

  const selectedGroup = activePage?.groups.find((g) => g.id === selectedGroupId) ?? null;
  const selectedItemParentGroup = selectedItemId && activePage
    ? activePage.groups.find((g) => g.items.some((i) => i.id === selectedItemId)) ?? null
    : null;

  const handlePlaceItem = useCallback(async (col: number, row: number) => {
    if (!placingType) return;

    if (placingType === "group") {
      await addGroup({
        name: "Group",
        color: "gray",
        col, row, colSpan: 3, rowSpan: 3,
      });
    } else {
      const configs: Record<string, any> = {
        button: defaultButtonConfig(),
        slider: defaultSliderConfig(),
        "xy-pad": defaultXYPadConfig(),
        "dmx-trigger": defaultDmxTriggerConfig(),
        "dmx-fader": defaultDmxFaderConfig(),
        "dmx-flash": defaultDmxFlashConfig(),
      };
      const spans: Record<string, { colSpan: number; rowSpan: number }> = {
        button: { colSpan: 2, rowSpan: 1 },
        slider: { colSpan: 1, rowSpan: 3 },
        "xy-pad": { colSpan: 3, rowSpan: 3 },
        "dmx-trigger": { colSpan: 2, rowSpan: 1 },
        "dmx-fader": { colSpan: 1, rowSpan: 3 },
        "dmx-flash": { colSpan: 2, rowSpan: 1 },
      };
      const s = spans[placingType] ?? { colSpan: 1, rowSpan: 1 };
      const lastEp = lastUsedEndpointId.current
        ? allEndpoints.find((e) => e.id === lastUsedEndpointId.current)
        : undefined;
      await addItem({
        name: placingType.charAt(0).toUpperCase() + placingType.slice(1),
        type: placingType as DeckItem["type"],
        col, row, ...s,
        oscAddress: placingType.startsWith("dmx-") ? "" : "/address",
        oscTarget: placingType.startsWith("dmx-")
          ? { host: "", port: 0 }
          : lastEp ? { host: lastEp.host, port: lastEp.port } : { host: "127.0.0.1", port: 8000 },
        oscTargetEndpointId: placingType.startsWith("dmx-") ? undefined : lastEp?.id,
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
      <div className="flex items-center gap-2 shrink-0">
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
        <div className="ml-auto flex bg-elevated rounded-lg p-0.5 border border-white/[0.06] mr-4">
          <button
            onClick={() => setMode("live")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === "live"
                ? "bg-deck text-white"
                : "text-[#666] hover:text-[#aaa]"
            }`}
          >
            Live
          </button>
          <button
            onClick={() => setMode("edit")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === "edit"
                ? "bg-deck text-white"
                : "text-[#666] hover:text-[#aaa]"
            }`}
          >
            Edit
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <>
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
            dmxEffects={dmxEffects}
            onDmxTrigger={triggerEffect}
            onDmxSetChannel={setChannel}
            onDmxReleaseChannel={releaseChannel}
            onMoveItemOutOfGroup={(itemId, groupId, absCol, absRow) => moveItemOutOfGroup(itemId, groupId, absCol, absRow)}
            onPushItems={(draggedId, dropCol, dropRow, dropColSpan, dropRowSpan) => {
              if (!activePage || !activeDeck) return;
              const cols = activeDeck.gridColumns;
              const rows = activeDeck.gridRows;

              type Pos = { id: string; col: number; row: number; colSpan: number; rowSpan: number; isGroup: boolean };
              const positions: Pos[] = [
                ...activePage.items.filter(i => i.id !== draggedId).map(i => ({ id: i.id, col: i.col, row: i.row, colSpan: i.colSpan, rowSpan: i.rowSpan, isGroup: false })),
                ...activePage.groups.filter(g => g.id !== draggedId).map(g => ({ id: g.id, col: g.col, row: g.row, colSpan: g.colSpan, rowSpan: g.rowSpan, isGroup: true })),
              ];

              const overlaps = (a: Pos, b: Pos) =>
                a.col < b.col + b.colSpan && a.col + a.colSpan > b.col &&
                a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row;

              const isOccupied = (pos: Pos, exclude: string) => {
                const dragged: Pos = { id: draggedId, col: dropCol, row: dropRow, colSpan: dropColSpan, rowSpan: dropRowSpan, isGroup: false };
                if (overlaps(pos, dragged)) return true;
                return positions.some(p => p.id !== exclude && overlaps(pos, p));
              };

              const fitsInGrid = (p: Pos) =>
                p.col >= 0 && p.row >= 0 && p.col + p.colSpan <= cols && p.row + p.rowSpan <= rows;

              const dropArea: Pos = { id: draggedId, col: dropCol, row: dropRow, colSpan: dropColSpan, rowSpan: dropRowSpan, isGroup: false };
              const move = (item: Pos, col: number, row: number) => {
                if (item.isGroup) updateGroup(item.id, { col, row });
                else updateItem(item.id, { col, row });
                item.col = col;
                item.row = row;
              };

              for (const item of positions) {
                if (!overlaps(item, dropArea)) continue;

                const rightPos = { ...item, col: dropCol + dropColSpan };
                if (fitsInGrid(rightPos) && !isOccupied(rightPos, item.id)) { move(item, rightPos.col, rightPos.row); continue; }

                const leftPos = { ...item, col: dropCol - item.colSpan };
                if (fitsInGrid(leftPos) && !isOccupied(leftPos, item.id)) { move(item, leftPos.col, leftPos.row); continue; }

                const downPos = { ...item, row: dropRow + dropRowSpan };
                if (fitsInGrid(downPos) && !isOccupied(downPos, item.id)) { move(item, downPos.col, downPos.row); continue; }

                for (let r = 0; r <= rows - item.rowSpan; r++) {
                  let placed = false;
                  for (let c = 0; c <= cols - item.colSpan; c++) {
                    const candidate = { ...item, col: c, row: r };
                    if (!isOccupied(candidate, item.id)) { move(item, c, r); placed = true; break; }
                  }
                  if (placed) break;
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
            dmxEffects={dmxEffects}
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
            inGroup={!!selectedItemParentGroup}
            onRemoveFromGroup={selectedItemParentGroup && selectedItemId ? () => {
              moveItemOutOfGroup(selectedItemId, selectedItemParentGroup.id);
              handleCloseConfig();
            } : undefined}
            onClose={handleCloseConfig}
          />
        )}
        </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <SectionSelector
            sections={recorder.recording?.sections ?? []}
            activeSectionId={activeSectionId}
            onSelect={setActiveSectionId}
          />
          <DeviceStrip
            devices={connectedPorts}
            deviceActivity={deviceActivity}
            aliases={recorder.recording?.deviceAliases}
            liveDeviceLinks={recorder.recording?.liveDeviceLinks}
            connectedLivePorts={connectedPorts}
            disabledDevices={recorder.recording?.disabledLiveDevices}
            onUpdateLinks={handleUpdateDeviceLinks}
            onToggleDevice={handleToggleDevice}
          />
          <div className="flex-1 overflow-hidden">
            {activePage && activeDeck ? (
              <div className="h-full overflow-auto">
                <DeckGrid
                  page={activePage}
                  gridColumns={activeDeck.gridColumns}
                  gridRows={activeDeck.gridRows}
                  editMode={false}
                  placingType={null}
                  onSendOsc={sendOsc}
                  onValueChange={setValue}
                  itemValues={itemValues}
                  onSelectItem={() => {}}
                  onSelectGroup={() => {}}
                  onPlaceItem={() => {}}
                  onMoveItem={() => {}}
                  onResizeItem={() => {}}
                  onMoveGroup={() => {}}
                  onResizeGroup={() => {}}
                  onMoveItemToGroup={() => {}}
                  dmxEffects={dmxEffects}
                  onDmxTrigger={triggerEffect}
                  onDmxSetChannel={setChannel}
                  onDmxReleaseChannel={releaseChannel}
                  onMoveItemOutOfGroup={() => {}}
                  onPushItems={() => {}}
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-600">
                No deck selected.
              </div>
            )}
          </div>
          <ActivityFeed
            entries={entries}
            showUnmapped={showUnmapped}
            onToggleUnmapped={setShowUnmapped}
            endpoints={senderEndpoints}
          />
          {recorder.recording?.oscMappings && recorder.recording.oscMappings.length > 0 && (
            <MappingConfigPanel
              mappings={recorder.recording.oscMappings}
              endpoints={senderEndpoints}
              aliases={recorder.recording.deviceAliases}
              flashTriggers={flashTriggers}
              onUpdateMappings={handleUpdateMappings}
              recordingId={recorder.recording.id}
              activeSectionId={activeSectionId}
              dmxTriggers={dmxTriggers}
              dmxEffects={dmxEffects}
              oscEffectTriggers={oscEffectTriggers}
              oscEffects={oscEffects}
              sections={recorder.recording.sections}
            />
          )}
        </div>
      )}
    </div>
  );
}
