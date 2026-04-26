"use client";

import { useDmx } from "@/hooks/use-dmx";
import { DeckGrid } from "@/components/deck-grid";
import type { Deck, OscArg } from "@/lib/types";

interface LiveDeckProps {
  decks: Deck[];
  activeSectionId: string | null;
  sectionDeckLinks: Record<string, string>;
  sendOsc: (host: string, port: number, address: string, args: OscArg[]) => void;
  setValue: (itemId: string, value: unknown) => void;
  itemValues: Record<string, unknown>;
  onToggle: (itemId: string) => void;
  isToggleOn: (itemId: string) => boolean;
  className?: string;
}

export function LiveDeck({
  decks,
  activeSectionId,
  sectionDeckLinks,
  sendOsc,
  setValue,
  itemValues,
  onToggle,
  isToggleOn,
  className,
}: LiveDeckProps) {
  const { effects: dmxEffects, triggerEffect, setChannel, releaseChannel } = useDmx();

  let visibleDecks: Deck[];
  if (activeSectionId === null) {
    visibleDecks = decks;
  } else {
    const linkedDeckId = sectionDeckLinks[activeSectionId];
    if (linkedDeckId) {
      const deck = decks.find((d) => d.id === linkedDeckId);
      visibleDecks = deck ? [deck] : [];
    } else {
      visibleDecks = [];
    }
  }

  if (visibleDecks.length === 0) {
    return (
      <div className={`flex items-center justify-center py-6 text-xs text-gray-500 border-t border-white/5 ${className ?? ""}`}>
        No deck linked
      </div>
    );
  }

  return (
    <div className={`flex flex-col border-t border-white/5 overflow-y-auto ${className ?? ""}`}>
      {visibleDecks.map((deck) => {
        const page = deck.pages[0];
        if (!page) return null;
        return (
          <div key={deck.id} className="flex flex-col">
            <div className="flex items-center gap-2 px-4 py-1.5 bg-panel/30 shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">
                {deck.name}
              </span>
            </div>
            <div style={{ height: Math.max(200, deck.gridRows * 64) }}>
              <DeckGrid
                page={page}
                gridColumns={deck.gridColumns}
                gridRows={deck.gridRows}
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
                onMoveItemOutOfGroup={() => {}}
                onPushItems={() => {}}
                dmxEffects={dmxEffects}
                onDmxTrigger={triggerEffect}
                onDmxSetChannel={setChannel}
                onDmxReleaseChannel={releaseChannel}
                onToggle={onToggle}
                isToggleOn={isToggleOn}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
