"use client";

import { useState, useCallback, useMemo } from "react";
import type { Deck, DeckItem, MappingToggleConfig } from "@/lib/types";

export interface DeckToggleState {
  toggleStates: Map<string, boolean>;
  disabledMappingIds: Set<string>;
  toggle: (itemId: string) => void;
  isToggleOn: (itemId: string) => boolean;
  resetAll: () => void;
}

function collectToggleItems(decks: Deck[]): DeckItem[] {
  const items: DeckItem[] = [];
  for (const deck of decks) {
    for (const page of deck.pages) {
      for (const item of page.items) {
        if (item.type === "mapping-toggle") items.push(item);
      }
      for (const group of page.groups) {
        for (const item of group.items) {
          if (item.type === "mapping-toggle") items.push(item);
        }
      }
    }
  }
  return items;
}

export function useDeckToggles(visibleDecks: Deck[]): DeckToggleState {
  const [toggleStates, setToggleStates] = useState<Map<string, boolean>>(new Map());

  const toggleItems = useMemo(() => collectToggleItems(visibleDecks), [visibleDecks]);

  const disabledMappingIds = useMemo(() => {
    const disabled = new Set<string>();
    for (const item of toggleItems) {
      const isOn = toggleStates.get(item.id) ?? true;
      if (!isOn) {
        const config = item.config as MappingToggleConfig;
        for (const mappingId of config.mappingIds) {
          disabled.add(mappingId);
        }
      }
    }
    return disabled;
  }, [toggleItems, toggleStates]);

  const toggle = useCallback((itemId: string) => {
    setToggleStates((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? true;
      next.set(itemId, !current);
      return next;
    });
  }, []);

  const isToggleOn = useCallback(
    (itemId: string) => toggleStates.get(itemId) ?? true,
    [toggleStates],
  );

  const resetAll = useCallback(() => {
    setToggleStates(new Map());
  }, []);

  return { toggleStates, disabledMappingIds, toggle, isToggleOn, resetAll };
}
