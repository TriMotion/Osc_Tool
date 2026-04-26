"use client";

import { useCallback, useState, useEffect } from "react";
import type { Deck, DeckPage, DeckItem, DeckGroup, OscArg, Recording } from "@/lib/types";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

function uuid(): string {
  return crypto.randomUUID();
}

interface UseDeckArgs {
  recording: Recording | null;
  patchRecording: (patch: Partial<Recording>) => void;
}

export function useDeck({ recording, patchRecording }: UseDeckArgs) {
  const decks = recording?.deckPresets ?? [];
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  useEffect(() => {
    if (decks.length > 0 && !decks.find((d) => d.id === activeDeckId)) {
      setActiveDeckId(decks[0].id);
      setActivePageId(decks[0].pages[0]?.id ?? null);
    } else if (decks.length === 0) {
      setActiveDeckId(null);
      setActivePageId(null);
    }
  }, [decks, activeDeckId]);

  const activeDeck = decks.find((d) => d.id === activeDeckId) ?? null;
  const activePage = activeDeck?.pages.find((p) => p.id === activePageId) ?? null;

  const patchDecks = useCallback(
    (updater: (prev: Deck[]) => Deck[]) => {
      const updated = updater(decks);
      patchRecording({ deckPresets: updated });
    },
    [decks, patchRecording],
  );

  const selectDeck = useCallback((deckId: string) => {
    setActiveDeckId(deckId);
    const deck = decks.find((d) => d.id === deckId);
    setActivePageId(deck?.pages[0]?.id ?? null);
  }, [decks]);

  const selectPage = useCallback((pageId: string) => {
    setActivePageId(pageId);
  }, []);

  const createDeck = useCallback((name: string) => {
    const newDeck: Deck = {
      id: uuid(),
      name,
      gridColumns: 8,
      gridRows: 6,
      pages: [{ id: uuid(), name: "Main", items: [], groups: [] }],
    };
    patchDecks((prev) => [...prev, newDeck]);
    setActiveDeckId(newDeck.id);
    setActivePageId(newDeck.pages[0].id);
  }, [patchDecks]);

  const updateDeck = useCallback((id: string, updates: Partial<Pick<Deck, "name" | "gridColumns" | "gridRows">>) => {
    patchDecks((prev) => prev.map((d) => (d.id === id ? { ...d, ...updates } : d)));
  }, [patchDecks]);

  const deleteDeck = useCallback((id: string) => {
    patchDecks((prev) => prev.filter((d) => d.id !== id));
    if (activeDeckId === id) {
      setActiveDeckId(null);
      setActivePageId(null);
    }
  }, [patchDecks, activeDeckId]);

  const createPage = useCallback((name: string) => {
    if (!activeDeckId) return;
    const newPage: DeckPage = { id: uuid(), name, items: [], groups: [] };
    patchDecks((prev) =>
      prev.map((d) => (d.id === activeDeckId ? { ...d, pages: [...d.pages, newPage] } : d)),
    );
    setActivePageId(newPage.id);
  }, [activeDeckId, patchDecks]);

  const updatePage = useCallback((pageId: string, updates: Partial<Pick<DeckPage, "name">>) => {
    if (!activeDeckId) return;
    patchDecks((prev) =>
      prev.map((d) =>
        d.id === activeDeckId
          ? { ...d, pages: d.pages.map((p) => (p.id === pageId ? { ...p, ...updates } : p)) }
          : d,
      ),
    );
  }, [activeDeckId, patchDecks]);

  const deletePage = useCallback((pageId: string) => {
    if (!activeDeckId) return;
    patchDecks((prev) =>
      prev.map((d) => {
        if (d.id !== activeDeckId || d.pages.length <= 1) return d;
        return { ...d, pages: d.pages.filter((p) => p.id !== pageId) };
      }),
    );
    if (activePageId === pageId) setActivePageId(null);
  }, [activeDeckId, activePageId, patchDecks]);

  const addItem = useCallback((item: Omit<DeckItem, "id">) => {
    if (!activeDeckId || !activePageId) return;
    const newItem = { ...item, id: uuid() } as DeckItem;
    patchDecks((prev) =>
      prev.map((d) =>
        d.id === activeDeckId
          ? { ...d, pages: d.pages.map((p) => (p.id === activePageId ? { ...p, items: [...p.items, newItem] } : p)) }
          : d,
      ),
    );
  }, [activeDeckId, activePageId, patchDecks]);

  const updateItem = useCallback((itemId: string, updates: Partial<Omit<DeckItem, "id">>) => {
    if (!activeDeckId || !activePageId) return;
    patchDecks((prev) =>
      prev.map((d) =>
        d.id === activeDeckId
          ? {
              ...d,
              pages: d.pages.map((p) => {
                if (p.id !== activePageId) return p;
                const inLoose = p.items.some((i) => i.id === itemId);
                if (inLoose) {
                  return { ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)) };
                }
                return {
                  ...p,
                  groups: p.groups.map((g) => ({
                    ...g,
                    items: g.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)),
                  })),
                };
              }),
            }
          : d,
      ),
    );
  }, [activeDeckId, activePageId, patchDecks]);

  const removeItem = useCallback((itemId: string) => {
    if (!activeDeckId || !activePageId) return;
    patchDecks((prev) =>
      prev.map((d) =>
        d.id === activeDeckId
          ? {
              ...d,
              pages: d.pages.map((p) => {
                if (p.id !== activePageId) return p;
                return {
                  ...p,
                  items: p.items.filter((i) => i.id !== itemId),
                  groups: p.groups.map((g) => ({
                    ...g,
                    items: g.items.filter((i) => i.id !== itemId),
                  })),
                };
              }),
            }
          : d,
      ),
    );
  }, [activeDeckId, activePageId, patchDecks]);

  const addGroup = useCallback((group: Omit<DeckGroup, "id" | "items">) => {
    if (!activeDeckId || !activePageId) return;
    const newGroup = { ...group, id: uuid(), items: [] } as DeckGroup;
    patchDecks((prev) =>
      prev.map((d) =>
        d.id === activeDeckId
          ? { ...d, pages: d.pages.map((p) => (p.id === activePageId ? { ...p, groups: [...p.groups, newGroup] } : p)) }
          : d,
      ),
    );
  }, [activeDeckId, activePageId, patchDecks]);

  const updateGroup = useCallback((groupId: string, updates: Partial<Omit<DeckGroup, "id" | "items">>) => {
    if (!activeDeckId || !activePageId) return;
    patchDecks((prev) =>
      prev.map((d) =>
        d.id === activeDeckId
          ? {
              ...d,
              pages: d.pages.map((p) =>
                p.id === activePageId
                  ? { ...p, groups: p.groups.map((g) => (g.id === groupId ? { ...g, ...updates } : g)) }
                  : p,
              ),
            }
          : d,
      ),
    );
  }, [activeDeckId, activePageId, patchDecks]);

  const removeGroup = useCallback((groupId: string) => {
    if (!activeDeckId || !activePageId) return;
    patchDecks((prev) =>
      prev.map((d) =>
        d.id === activeDeckId
          ? {
              ...d,
              pages: d.pages.map((p) => {
                if (p.id !== activePageId) return p;
                const group = p.groups.find((g) => g.id === groupId);
                const extractedItems = group?.items ?? [];
                return {
                  ...p,
                  items: [...p.items, ...extractedItems],
                  groups: p.groups.filter((g) => g.id !== groupId),
                };
              }),
            }
          : d,
      ),
    );
  }, [activeDeckId, activePageId, patchDecks]);

  const moveItemToGroup = useCallback((itemId: string, groupId: string, absCol?: number, absRow?: number) => {
    if (!activeDeckId || !activePageId) return;
    patchDecks((prev) =>
      prev.map((d) =>
        d.id === activeDeckId
          ? {
              ...d,
              pages: d.pages.map((p) => {
                if (p.id !== activePageId) return p;
                let item: DeckItem | undefined;
                const filteredItems = p.items.filter((i) => {
                  if (i.id === itemId) { item = i; return false; }
                  return true;
                });
                const filteredGroups = p.groups.map((g) => ({
                  ...g,
                  items: g.items.filter((i) => {
                    if (i.id === itemId) { item = i; return false; }
                    return true;
                  }),
                }));
                if (!item) return p;
                const positioned = { ...item, col: absCol ?? item.col, row: absRow ?? item.row };
                return {
                  ...p,
                  items: filteredItems,
                  groups: filteredGroups.map((g) =>
                    g.id === groupId ? { ...g, items: [...g.items, positioned] } : g,
                  ),
                };
              }),
            }
          : d,
      ),
    );
  }, [activeDeckId, activePageId, patchDecks]);

  const moveItemOutOfGroup = useCallback((itemId: string, groupId: string, absCol?: number, absRow?: number) => {
    if (!activeDeckId || !activePageId) return;
    patchDecks((prev) =>
      prev.map((d) =>
        d.id === activeDeckId
          ? {
              ...d,
              pages: d.pages.map((p) => {
                if (p.id !== activePageId) return p;
                let item: DeckItem | undefined;
                const updatedGroups = p.groups.map((g) => {
                  if (g.id !== groupId) return g;
                  return {
                    ...g,
                    items: g.items.filter((i) => {
                      if (i.id === itemId) { item = i; return false; }
                      return true;
                    }),
                  };
                });
                if (!item) return p;
                const positioned = { ...item, col: absCol ?? item.col, row: absRow ?? item.row };
                return { ...p, items: [...p.items, positioned], groups: updatedGroups };
              }),
            }
          : d,
      ),
    );
  }, [activeDeckId, activePageId, patchDecks]);

  const sendOsc = useCallback(async (host: string, port: number, address: string, args: OscArg[]) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("deck:send-osc", host, port, address, args);
  }, []);

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
    api.invoke("deck:get-values").then((vals) => {
      if (vals) setItemValues(vals as Record<string, unknown>);
    });
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
    sendOsc, setValue, itemValues,
  };
}
