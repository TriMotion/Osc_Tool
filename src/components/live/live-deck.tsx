"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDeck } from "@/hooks/use-deck";
import { useDmx } from "@/hooks/use-dmx";
import { DeckGrid } from "@/components/deck-grid";
import type { Deck } from "@/lib/types";

interface LiveDeckProps {
  className?: string;
}

export function LiveDeck({ className }: LiveDeckProps) {
  const {
    decks, activeDeck, activePage,
    selectDeck, selectPage,
    sendOsc, setValue, itemValues,
  } = useDeck();

  const { effects: dmxEffects, triggerEffect, setChannel, releaseChannel } = useDmx();

  const [collapsed, setCollapsed] = useState(false);

  if (decks.length === 0) return null;

  return (
    <div className={`flex flex-col border-t border-white/5 ${className ?? ""}`}>
      {/* Deck header bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-panel/30 shrink-0">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-500 hover:text-gray-300 transition-colors text-xs"
        >
          {collapsed ? "▶" : "▼"}
        </button>
        <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1">
          Deck
        </span>

        {/* Deck selector */}
        <select
          value={activeDeck?.id ?? ""}
          onChange={(e) => selectDeck(e.target.value)}
          className="bg-black border border-white/10 rounded text-xs text-gray-300 px-2 py-0.5 outline-none focus:border-deck/18"
        >
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        {/* Page tabs */}
        {activeDeck && activeDeck.pages.length > 1 && (
          <div className="flex items-center gap-1 ml-2">
            {activeDeck.pages.map((page) => (
              <button
                key={page.id}
                onClick={() => selectPage(page.id)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  activePage?.id === page.id
                    ? "bg-deck/15 text-deck border border-deck/30"
                    : "text-gray-500 hover:text-gray-300 border border-transparent"
                }`}
              >
                {page.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Deck grid */}
      <AnimatePresence initial={false}>
        {!collapsed && activeDeck && activePage && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div style={{ height: Math.max(200, activeDeck.gridRows * 64) }}>
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
                onMoveItemOutOfGroup={() => {}}
                onPushItems={() => {}}
                dmxEffects={dmxEffects}
                onDmxTrigger={triggerEffect}
                onDmxSetChannel={setChannel}
                onDmxReleaseChannel={releaseChannel}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
