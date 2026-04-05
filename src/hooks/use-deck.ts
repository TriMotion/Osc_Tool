"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import type { Deck, DeckPage, DeckItem, DeckGroup, OscArg } from "@/lib/types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

export function useDeck() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const all = (await api.invoke("deck:get-all")) as Deck[];
    setDecks(all);
    if (!activeDeckId && all.length > 0) {
      setActiveDeckId(all[0].id);
      setActivePageId(all[0].pages[0]?.id ?? null);
    }
  }, [activeDeckId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeDeck = decks.find((d) => d.id === activeDeckId) ?? null;
  const activePage = activeDeck?.pages.find((p) => p.id === activePageId) ?? null;

  const selectDeck = useCallback((deckId: string) => {
    setActiveDeckId(deckId);
    const deck = decks.find((d) => d.id === deckId);
    setActivePageId(deck?.pages[0]?.id ?? null);
  }, [decks]);

  const selectPage = useCallback((pageId: string) => {
    setActivePageId(pageId);
  }, []);

  const createDeck = useCallback(async (name: string) => {
    const api = getAPI();
    if (!api) return;
    const deck = (await api.invoke("deck:create", name)) as Deck;
    await refresh();
    setActiveDeckId(deck.id);
    setActivePageId(deck.pages[0]?.id ?? null);
  }, [refresh]);

  const updateDeck = useCallback(async (id: string, updates: Partial<Pick<Deck, "name" | "gridColumns" | "gridRows">>) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("deck:update", id, updates);
    await refresh();
  }, [refresh]);

  const deleteDeck = useCallback(async (id: string) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("deck:delete", id);
    setActiveDeckId(null);
    setActivePageId(null);
    await refresh();
  }, [refresh]);

  const createPage = useCallback(async (name: string) => {
    const api = getAPI();
    if (!api || !activeDeckId) return;
    const page = (await api.invoke("deck:create-page", activeDeckId, name)) as DeckPage;
    await refresh();
    setActivePageId(page.id);
  }, [activeDeckId, refresh]);

  const updatePage = useCallback(async (pageId: string, updates: Partial<Pick<DeckPage, "name">>) => {
    const api = getAPI();
    if (!api || !activeDeckId) return;
    await api.invoke("deck:update-page", activeDeckId, pageId, updates);
    await refresh();
  }, [activeDeckId, refresh]);

  const deletePage = useCallback(async (pageId: string) => {
    const api = getAPI();
    if (!api || !activeDeckId) return;
    const success = (await api.invoke("deck:delete-page", activeDeckId, pageId)) as boolean;
    if (success && activePageId === pageId) {
      setActivePageId(null);
    }
    await refresh();
  }, [activeDeckId, activePageId, refresh]);

  const addItem = useCallback(async (item: Omit<DeckItem, "id">) => {
    const api = getAPI();
    if (!api || !activeDeckId || !activePageId) return;
    await api.invoke("deck:add-item", activeDeckId, activePageId, item);
    await refresh();
  }, [activeDeckId, activePageId, refresh]);

  const updateItem = useCallback(async (itemId: string, updates: Partial<Omit<DeckItem, "id">>) => {
    const api = getAPI();
    if (!api || !activeDeckId || !activePageId) return;
    await api.invoke("deck:update-item", activeDeckId, activePageId, itemId, updates);
    await refresh();
  }, [activeDeckId, activePageId, refresh]);

  const removeItem = useCallback(async (itemId: string) => {
    const api = getAPI();
    if (!api || !activeDeckId || !activePageId) return;
    await api.invoke("deck:remove-item", activeDeckId, activePageId, itemId);
    await refresh();
  }, [activeDeckId, activePageId, refresh]);

  const addGroup = useCallback(async (group: Omit<DeckGroup, "id" | "items">) => {
    const api = getAPI();
    if (!api || !activeDeckId || !activePageId) return;
    await api.invoke("deck:add-group", activeDeckId, activePageId, group);
    await refresh();
  }, [activeDeckId, activePageId, refresh]);

  const updateGroup = useCallback(async (groupId: string, updates: Partial<Omit<DeckGroup, "id" | "items">>) => {
    const api = getAPI();
    if (!api || !activeDeckId || !activePageId) return;
    await api.invoke("deck:update-group", activeDeckId, activePageId, groupId, updates);
    await refresh();
  }, [activeDeckId, activePageId, refresh]);

  const removeGroup = useCallback(async (groupId: string) => {
    const api = getAPI();
    if (!api || !activeDeckId || !activePageId) return;
    await api.invoke("deck:remove-group", activeDeckId, activePageId, groupId);
    await refresh();
  }, [activeDeckId, activePageId, refresh]);

  const moveItemToGroup = useCallback(async (itemId: string, groupId: string, absCol?: number, absRow?: number) => {
    const api = getAPI();
    if (!api || !activeDeckId || !activePageId) return;
    await api.invoke("deck:move-item-to-group", activeDeckId, activePageId, itemId, groupId, absCol, absRow);
    await refresh();
  }, [activeDeckId, activePageId, refresh]);

  const moveItemOutOfGroup = useCallback(async (itemId: string, groupId: string, absCol?: number, absRow?: number) => {
    const api = getAPI();
    if (!api || !activeDeckId || !activePageId) return;
    await api.invoke("deck:move-item-out-of-group", activeDeckId, activePageId, itemId, groupId, absCol, absRow);
    await refresh();
  }, [activeDeckId, activePageId, refresh]);

  const sendOsc = useCallback(async (host: string, port: number, address: string, args: OscArg[]) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("deck:send-osc", host, port, address, args);
  }, []);

  // --- Live value syncing ---
  const [itemValues, setItemValues] = useState<Record<string, unknown>>({});

  const setValue = useCallback(async (itemId: string, value: unknown) => {
    const api = getAPI();
    if (!api) return;
    setItemValues((prev) => ({ ...prev, [itemId]: value }));
    await api.invoke("deck:set-value", itemId, value);
  }, []);

  useEffect(() => {
    const api = getAPI();
    if (!api) return;
    // Load initial values
    api.invoke("deck:get-values").then((vals) => {
      if (vals) setItemValues(vals as Record<string, unknown>);
    });
    // Listen for value updates from other clients
    const unsub = api.on("deck:value", (payload) => {
      const { itemId, value } = payload as { itemId: string; value: unknown };
      setItemValues((prev) => ({ ...prev, [itemId]: value }));
    });
    return unsub;
  }, []);

  return {
    decks, activeDeck, activePage,
    selectDeck, selectPage,
    createDeck, updateDeck, deleteDeck,
    createPage, updatePage, deletePage,
    addItem, updateItem, removeItem,
    addGroup, updateGroup, removeGroup,
    moveItemToGroup, moveItemOutOfGroup,
    sendOsc, setValue, itemValues, refresh,
  };
}
