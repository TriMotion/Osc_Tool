# Deck Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move decks from global storage into recordings, add section-deck linking, and a new mapping-toggle item type for enabling/disabling OSC and DMX mappings during live performance.

**Architecture:** Decks become part of the Recording data model (`deckPresets` array + `sectionDeckLinks` map). The global `deck-store.ts` and all its IPC handlers are removed. `use-deck.ts` is rewritten to operate on the recording via `patchRecording()`. A new `mapping-toggle` DeckItem type lets users toggle mappings on/off at runtime, with per-button state tracked in a new `use-deck-toggles.ts` hook that integrates with `use-live-monitor.ts`.

**Tech Stack:** TypeScript, React, Next.js, Electron IPC, Framer Motion

---

## File Structure

### New files
- `src/hooks/use-deck-toggles.ts` — runtime toggle state management (per-button on/off, disabled mapping resolution)
- `src/components/deck-mapping-picker.tsx` — mapping picker with note/tag/address filters for configuring mapping-toggle items

### Modified files
- `src/lib/types.ts` — add `MappingToggleConfig`, extend `DeckItem.type` union, add `deckPresets` and `sectionDeckLinks` to `Recording`
- `src/hooks/use-deck.ts` — rewrite from IPC-based to recording-based CRUD
- `src/hooks/use-live-monitor.ts` — add toggle-based mapping filtering (step 6 in pipeline)
- `src/components/deck-item.tsx` — render `mapping-toggle` item type
- `src/components/deck-config-panel.tsx` — add mapping-toggle config section with mapping picker
- `src/components/deck-toolbar.tsx` — add `mapping-toggle` to item type list
- `src/components/live/live-deck.tsx` — rewrite to show section-linked decks, stacked "All" view, toggle interaction
- `src/components/live/section-selector.tsx` — add deck-link dropdown per section
- `src/app/deck/page.tsx` — require loaded recording, deck preset management
- `electron/ipc-handlers.ts` — remove deck IPC handlers and deck-store import

### Removed files
- `electron/deck-store.ts` — global deck persistence eliminated

---

### Task 1: Update type definitions

**Files:**
- Modify: `src/lib/types.ts:74-86` (DeckItem type), `src/lib/types.ts:246-279` (Recording type)

- [ ] **Step 1: Add MappingToggleConfig interface and extend DeckItem**

In `src/lib/types.ts`, add the new config interface after `XYPadConfig` (after line 110) and extend the DeckItem type:

```typescript
export interface MappingToggleConfig {
  mappingIds: string[];
}
```

Update `DeckItem.type` union (line 78):
```typescript
type: "button" | "slider" | "xy-pad" | "dmx-trigger" | "dmx-fader" | "dmx-flash" | "mapping-toggle";
```

Update `DeckItem.config` union (line 86):
```typescript
config: ButtonConfig | SliderConfig | XYPadConfig | DmxTriggerConfig | DmxFaderConfig | DmxFlashConfig | MappingToggleConfig;
```

- [ ] **Step 2: Add deckPresets and sectionDeckLinks to Recording**

In `src/lib/types.ts`, add two new optional fields to the `Recording` interface (after line 278, before the closing brace):

```typescript
  deckPresets?: Deck[];
  sectionDeckLinks?: Record<string, string>;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors (existing warnings are OK)

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add MappingToggleConfig type and deck fields to Recording"
```

---

### Task 2: Remove global deck store and IPC handlers

**Files:**
- Remove: `electron/deck-store.ts`
- Modify: `electron/ipc-handlers.ts:77-93` (deck handlers), `electron/ipc-handlers.ts:95-120` (deck live values)

- [ ] **Step 1: Remove deck IPC handlers from ipc-handlers.ts**

In `electron/ipc-handlers.ts`, remove the deck store import at the top (find the `import` or instantiation of `DeckStore`). Then remove all `deck:*` IPC handlers (lines 78-93) and the deck live values section (lines 95-120, including `itemValues` Map, `broadcastValue`, `setValueChangeHandler`, `deck:send-osc`, `deck:set-value`, `deck:get-values`).

Also remove the `deckStore` from the `stores:get-seed-data` handler if present, and any `webServer.broadcastDeckUpdate` references in the endpoints handlers (lines 51-52).

Keep the `deck:send-osc` handler — it's still needed for OSC-sending deck items. Rewrite it to not use deckStore:

```typescript
ipcMain.handle("deck:send-osc", async (_e, host: string, port: number, address: string, args: OscArg[]) => {
  await oscManager.sendMessage({ host, port }, address, args);
  return { ok: true };
});
```

Also keep `deck:set-value`, `deck:get-values`, and the `broadcastValue` function and `deck:value` listener — these are needed for live value syncing of sliders/buttons across clients. Just remove the deckStore dependency from them.

- [ ] **Step 2: Delete electron/deck-store.ts**

```bash
rm electron/deck-store.ts
```

- [ ] **Step 3: Remove deckStore references from endpoints handler**

In `electron/ipc-handlers.ts`, the `endpoints:update` handler (around line 48-55) calls `deckStore.updateEndpointTargets()` and `webServer.broadcastDeckUpdate()`. Remove those two lines — endpoint updates no longer need to sync to a deck store since decks live in recordings now.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`
Expected: May show errors in `use-deck.ts` (expected — we rewrite it next). No errors in `electron/` files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove global deck-store and deck IPC handlers"
```

---

### Task 3: Rewrite use-deck hook for recording-based CRUD

**Files:**
- Modify: `src/hooks/use-deck.ts` (full rewrite, 190 lines → ~180 lines)

The hook currently calls `deck:*` IPC channels and manages its own state. It needs to instead read from `recording.deckPresets` and write via `patchRecording()` from the recorder context.

- [ ] **Step 1: Rewrite use-deck.ts**

Replace the entire file with a recording-based implementation. The hook takes `recording` and `patchRecording` as arguments (instead of using IPC):

```typescript
"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import type { Deck, DeckPage, DeckItem, DeckGroup, OscArg, Recording } from "@/lib/types";
import { v4 as uuid } from "uuid";

function getAPI() {
  return typeof window !== "undefined" ? window.electronAPI : undefined;
}

interface UseDeckArgs {
  recording: Recording | null;
  patchRecording: (patch: Partial<Recording>) => void;
}

export function useDeck({ recording, patchRecording }: UseDeckArgs) {
  const decks = recording?.deckPresets ?? [];
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  // Auto-select first deck/page when recording loads
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

  // OSC sending still uses IPC — it talks to the OSC manager
  const sendOsc = useCallback(async (host: string, port: number, address: string, args: OscArg[]) => {
    const api = getAPI();
    if (!api) return;
    await api.invoke("deck:send-osc", host, port, address, args);
  }, []);

  // Live value syncing still uses IPC for multi-client broadcast
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`
Expected: Errors in consumers of `useDeck()` that need to pass the new arguments — those are fixed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-deck.ts
git commit -m "refactor: rewrite use-deck hook to operate on recording data"
```

---

### Task 4: Create use-deck-toggles hook

**Files:**
- Create: `src/hooks/use-deck-toggles.ts`

This hook manages the runtime toggle state for mapping-toggle items. It tracks which toggle buttons are "on" or "off" and computes which mapping IDs are currently disabled.

- [ ] **Step 1: Create use-deck-toggles.ts**

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`
Expected: Clean compile for this file (no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-deck-toggles.ts
git commit -m "feat: add use-deck-toggles hook for runtime mapping toggle state"
```

---

### Task 5: Integrate toggle filtering into use-live-monitor

**Files:**
- Modify: `src/hooks/use-live-monitor.ts:40-50` (args interface), `src/hooks/use-live-monitor.ts:74-76` (filtering pipeline)

- [ ] **Step 1: Add disabledMappingIds to hook args**

In `src/hooks/use-live-monitor.ts`, find the `UseLiveMonitorArgs` interface (around line 12-16) and add:

```typescript
disabledMappingIds?: Set<string>;
```

Update the destructuring in the hook function to include it, and store it in a ref (same pattern as `activeSectionIdRef`):

```typescript
const disabledMappingIdsRef = useRef(disabledMappingIds);
useEffect(() => { disabledMappingIdsRef.current = disabledMappingIds; }, [disabledMappingIds]);
```

- [ ] **Step 2: Add toggle filter after section filter**

In the mapping loop (around line 75, after the `sectionFilter` check), add:

```typescript
if (disabledMappingIdsRef.current?.has(mapping.id)) continue;
```

This goes right after:
```typescript
if (sectionFilter && mapping.sectionId && mapping.sectionId !== sectionFilter) continue;
```

And before:
```typescript
if (!matchesMapping(fakeEvt, mapping)) continue;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`
Expected: Clean or only pre-existing warnings

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-live-monitor.ts
git commit -m "feat: add toggle-based mapping filter to live monitor pipeline"
```

---

### Task 6: Add mapping-toggle rendering to deck-item.tsx

**Files:**
- Modify: `src/components/deck-item.tsx:36` (component function), add new handler and render branch

- [ ] **Step 1: Add MappingToggleConfig import and onToggle prop**

In `src/components/deck-item.tsx`, add to imports:

```typescript
import type { MappingToggleConfig } from "@/lib/types";
```

Add to `DeckItemProps` interface:

```typescript
onToggle?: (itemId: string) => void;
isToggleOn?: boolean;
```

- [ ] **Step 2: Add mapping-toggle render branch**

In the `DeckItemView` component, add a handler:

```typescript
const handleToggleClick = () => {
  if (editMode) { onSelect?.(); return; }
  onToggle?.(item.id);
};
```

Add a render branch for `mapping-toggle` type. Find the pattern where the component switches on `item.type` to render different UIs. Add alongside the existing button/slider/xy-pad/dmx branches:

```typescript
if (item.type === "mapping-toggle") {
  const config = item.config as MappingToggleConfig;
  const isOn = isToggleOn ?? true;
  return (
    <motion.div
      className="relative w-full h-full rounded-lg flex flex-col items-center justify-center cursor-pointer select-none overflow-hidden"
      style={{
        background: isOn ? colors.bg : "#1a1a2e",
        border: `1px solid ${isOn ? colors.border : "rgba(255,255,255,0.05)"}`,
      }}
      whileTap={editMode ? undefined : { scale: 0.95 }}
      onClick={handleToggleClick}
      onMouseDown={editMode ? onDragStart : undefined}
    >
      <div
        className="w-2 h-2 rounded-full mb-1"
        style={{ background: isOn ? "#22c55e" : "#ef4444" }}
      />
      <span
        className="text-[10px] font-medium leading-tight text-center px-1"
        style={{ color: isOn ? colors.text : "#6b7280" }}
      >
        {item.name}
      </span>
      <span className="text-[8px] text-gray-500 mt-0.5">
        {config.mappingIds.length} mapping{config.mappingIds.length !== 1 ? "s" : ""}
      </span>
    </motion.div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src/components/deck-item.tsx
git commit -m "feat: add mapping-toggle rendering to DeckItemView"
```

---

### Task 7: Create deck-mapping-picker component

**Files:**
- Create: `src/components/deck-mapping-picker.tsx`

This is the mapping filter/selection UI used in the config panel for mapping-toggle items.

- [ ] **Step 1: Create deck-mapping-picker.tsx**

```typescript
"use client";

import { useState, useMemo } from "react";
import type { OscMapping, NoteGroupTag, LaneBadge } from "@/lib/types";
import { resolveOscAddress } from "@/lib/osc-mapping";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiNoteToName(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

interface DeckMappingPickerProps {
  mappings: OscMapping[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  noteTags?: NoteGroupTag[];
  laneBadges?: LaneBadge[];
  aliases?: Record<string, string>;
}

export function DeckMappingPicker({
  mappings,
  selectedIds,
  onChange,
  noteTags,
  laneBadges,
  aliases,
}: DeckMappingPickerProps) {
  const [noteFilter, setNoteFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [addressFilter, setAddressFilter] = useState("");

  const filtered = useMemo(() => {
    return mappings.filter((m) => {
      if (noteFilter) {
        const lower = noteFilter.toLowerCase();
        if (m.targetType === "noteGroup") {
          const [pitchStr] = m.targetId.split("|");
          const pitch = parseInt(pitchStr, 10);
          const name = midiNoteToName(pitch).toLowerCase();
          if (!name.includes(lower) && !pitchStr.includes(lower)) return false;
        } else {
          return false;
        }
      }
      if (tagFilter) {
        const lower = tagFilter.toLowerCase();
        const matchesNoteTag = noteTags?.some(
          (t) => t.label.toLowerCase().includes(lower) && m.targetType === "noteGroup" && m.targetId.startsWith(`${t.pitch}|`),
        );
        const matchesLaneBadge = laneBadges?.some(
          (b) => b.label.toLowerCase().includes(lower) && m.targetType === "lane" && m.targetId === b.laneKey,
        );
        if (!matchesNoteTag && !matchesLaneBadge) return false;
      }
      if (addressFilter) {
        const address = resolveOscAddress(m, aliases) ?? "";
        if (!address.toLowerCase().includes(addressFilter.toLowerCase())) return false;
      }
      return true;
    });
  }, [mappings, noteFilter, tagFilter, addressFilter, noteTags, laneBadges, aliases]);

  const selectedSet = new Set(selectedIds);

  const toggleMapping = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectAll = () => {
    const allFilteredIds = filtered.map((m) => m.id);
    const merged = new Set([...selectedIds, ...allFilteredIds]);
    onChange(Array.from(merged));
  };

  const deselectAll = () => {
    const filteredSet = new Set(filtered.map((m) => m.id));
    onChange(selectedIds.filter((id) => !filteredSet.has(id)));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="Note..."
          value={noteFilter}
          onChange={(e) => setNoteFilter(e.target.value)}
          className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-deck/40"
        />
        <input
          type="text"
          placeholder="Tag..."
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-deck/40"
        />
        <input
          type="text"
          placeholder="Address..."
          value={addressFilter}
          onChange={(e) => setAddressFilter(e.target.value)}
          className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-deck/40"
        />
      </div>

      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <span>{filtered.length} mapping{filtered.length !== 1 ? "s" : ""}</span>
        <div className="flex gap-2">
          <button onClick={selectAll} className="hover:text-gray-300 transition-colors">Select all</button>
          <button onClick={deselectAll} className="hover:text-gray-300 transition-colors">Deselect all</button>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto border border-white/5 rounded">
        {filtered.map((m) => {
          const checked = selectedSet.has(m.id);
          const device = aliases?.[m.deviceId] ?? m.deviceId;
          const address = resolveOscAddress(m, aliases) ?? "(no address)";
          let target = m.targetId;
          if (m.targetType === "noteGroup") {
            const [pitchStr, velStr] = m.targetId.split("|");
            target = `${midiNoteToName(parseInt(pitchStr, 10))} v${velStr}`;
          }
          return (
            <label
              key={m.id}
              className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-white/5 transition-colors ${
                checked ? "text-gray-200" : "text-gray-500"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleMapping(m.id)}
                className="accent-deck"
              />
              <span className="truncate flex-1">
                <span className="text-gray-400">{device}</span>
                {" "}
                <span>{target}</span>
                {" "}
                <span className="text-gray-600">→ {address}</span>
              </span>
            </label>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-xs text-gray-600 text-center py-3">No mappings match filters</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add src/components/deck-mapping-picker.tsx
git commit -m "feat: add DeckMappingPicker component with note/tag/address filters"
```

---

### Task 8: Add mapping-toggle config to deck-config-panel

**Files:**
- Modify: `src/components/deck-config-panel.tsx`

- [ ] **Step 1: Add mapping-toggle props and imports**

In `src/components/deck-config-panel.tsx`, add imports:

```typescript
import type { MappingToggleConfig, OscMapping, NoteGroupTag, LaneBadge } from "@/lib/types";
import { DeckMappingPicker } from "./deck-mapping-picker";
```

Add to `ConfigPanelProps`:

```typescript
oscMappings?: OscMapping[];
noteTags?: NoteGroupTag[];
laneBadges?: LaneBadge[];
deviceAliases?: Record<string, string>;
```

- [ ] **Step 2: Add mapping-toggle config section**

Find the section where different item types render their config (around line 280-430, the switch on `item.type`). Add a new branch for `mapping-toggle`:

```typescript
{item?.type === "mapping-toggle" && (
  <div className="space-y-3">
    <div className="text-[10px] uppercase tracking-wider text-gray-500">Controlled Mappings</div>
    <DeckMappingPicker
      mappings={oscMappings ?? []}
      selectedIds={(item.config as MappingToggleConfig).mappingIds}
      onChange={(ids) => onUpdateItem?.({ config: { ...item.config, mappingIds: ids } as MappingToggleConfig })}
      noteTags={noteTags}
      laneBadges={laneBadges}
      aliases={deviceAliases}
    />
  </div>
)}
```

- [ ] **Step 3: Update auto-save to handle MappingToggleConfig**

In the `buildAndSave()` function, ensure the mapping-toggle config is passed through. Since the config panel uses a generic `onUpdateItem` that spreads updates, the `MappingToggleConfig` should flow through the existing `config` field. Verify the auto-save mechanism handles this — the `onChange` callback in the picker calls `onUpdateItem` with `{ config: { mappingIds: ids } }`, which will be captured by the existing `buildAndSave` flow.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/components/deck-config-panel.tsx src/components/deck-mapping-picker.tsx
git commit -m "feat: add mapping-toggle configuration section to DeckConfigPanel"
```

---

### Task 9: Add mapping-toggle to deck toolbar

**Files:**
- Modify: `src/components/deck-toolbar.tsx:5-17` (items array and type)

- [ ] **Step 1: Add mapping-toggle to toolbar items and type**

In `src/components/deck-toolbar.tsx`, update the `onStartPlace` type in `DeckToolbarProps` (line 5):

```typescript
onStartPlace: (type: "button" | "slider" | "xy-pad" | "group" | "dmx-trigger" | "dmx-fader" | "dmx-flash" | "mapping-toggle") => void;
```

Add to the `items` array (line 10-18):

```typescript
{ type: "mapping-toggle" as const, label: "+ Toggle" },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add src/components/deck-toolbar.tsx
git commit -m "feat: add mapping-toggle to deck toolbar"
```

---

### Task 10: Add deck-link dropdown to section-selector

**Files:**
- Modify: `src/components/live/section-selector.tsx`

- [ ] **Step 1: Extend SectionSelectorProps**

Add new props to `SectionSelectorProps`:

```typescript
interface SectionSelectorProps {
  sections: TimelineSection[];
  activeSectionId: string | null;
  onSelect: (sectionId: string | null) => void;
  deckPresets?: Deck[];
  sectionDeckLinks?: Record<string, string>;
  onLinkDeck?: (sectionId: string, deckId: string | null) => void;
}
```

Add import:
```typescript
import type { TimelineSection, Deck } from "@/lib/types";
```

- [ ] **Step 2: Add deck-link dropdown per section**

In the section button rendering (inside the `.map()` at line 37), add a small dropdown below or beside each section button. This dropdown shows when hovering or when a config icon is clicked:

```typescript
{sections.map((section) => {
  const isActive = activeSectionId === section.id;
  const color = section.color ?? "#6b7280";
  const linkedDeckId = sectionDeckLinks?.[section.id];
  const linkedDeck = deckPresets?.find((d) => d.id === linkedDeckId);
  return (
    <div key={section.id} className="flex flex-col items-center gap-0.5 shrink-0">
      <button
        onClick={() => onSelect(section.id)}
        className={`relative text-xs px-3 py-1 rounded-md border transition-colors ${
          isActive
            ? "text-white"
            : "border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300"
        }`}
        style={
          isActive
            ? { borderColor: `${color}80`, background: `${color}20`, color }
            : undefined
        }
      >
        {section.name}
        {isActive && (
          <motion.div
            layoutId="section-indicator"
            className="absolute inset-0 rounded-md border"
            style={{ borderColor: `${color}80` }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        )}
      </button>
      {onLinkDeck && deckPresets && (
        <select
          value={linkedDeckId ?? "__none__"}
          onChange={(e) => {
            const val = e.target.value;
            onLinkDeck(section.id, val === "__none__" ? null : val);
          }}
          className="bg-black border border-white/5 rounded text-[9px] text-gray-500 px-1 py-0 outline-none w-16 text-center"
        >
          <option value="__none__">None</option>
          {deckPresets.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      )}
    </div>
  );
})}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src/components/live/section-selector.tsx
git commit -m "feat: add deck-link dropdown to section selector"
```

---

### Task 11: Rewrite live-deck.tsx for section-linked decks

**Files:**
- Modify: `src/components/live/live-deck.tsx` (full rewrite)

This component now:
- Receives section-linked deck data instead of using the global `useDeck()` hook
- Shows the linked deck for the active section
- Shows all decks stacked when "All" is selected
- Shows "No deck linked" empty state
- Supports mapping-toggle interaction

- [ ] **Step 1: Rewrite live-deck.tsx**

```typescript
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useDmx } from "@/hooks/use-dmx";
import { DeckGrid } from "@/components/deck-grid";
import type { Deck, DeckPage, OscArg } from "@/lib/types";

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

  // Determine which decks to show
  let visibleDecks: Deck[];
  if (activeSectionId === null) {
    // "All" — show every deck
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`
Expected: DeckGrid will need `onToggle` and `isToggleOn` props added — handled in Task 12.

- [ ] **Step 3: Commit**

```bash
git add src/components/live/live-deck.tsx
git commit -m "feat: rewrite LiveDeck for section-linked decks with toggle support"
```

---

### Task 12: Thread toggle props through DeckGrid

**Files:**
- Modify: `src/components/deck-grid.tsx` (DeckGridProps, pass through to DeckItemView)

- [ ] **Step 1: Add toggle props to DeckGridProps**

In `src/components/deck-grid.tsx`, add to `DeckGridProps`:

```typescript
onToggle?: (itemId: string) => void;
isToggleOn?: (itemId: string) => boolean;
```

Destructure them in the component.

- [ ] **Step 2: Pass toggle props to DeckItemView**

In the grid rendering where `DeckItemView` is instantiated (both for loose items and group items), pass through:

```typescript
onToggle={onToggle}
isToggleOn={isToggleOn?.(item.id)}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src/components/deck-grid.tsx
git commit -m "feat: thread toggle props through DeckGrid to DeckItemView"
```

---

### Task 13: Update deck/page.tsx for recording-based decks

**Files:**
- Modify: `src/app/deck/page.tsx`

This is the big wiring task. The deck page must:
- Pass `recording` and `patchRecording` to the rewritten `useDeck`
- Show empty state when no recording is loaded
- Add `mapping-toggle` to the placingType handling
- Pass mapping data to DeckConfigPanel for mapping-toggle config

- [ ] **Step 1: Update useDeck call**

Find the `useDeck()` call (around line 82) and change it to pass recording context:

```typescript
const recorder = useRecorderContext();
const deck = useDeck({
  recording: recorder.recording,
  patchRecording: recorder.patchRecording,
});
```

Update destructuring to match the new return shape (same fields, minus `refresh`).

- [ ] **Step 2: Add recording-required empty state**

At the top of the page render (before the main layout), add:

```typescript
if (!recorder.recording) {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
      Load a recording to manage deck presets
    </div>
  );
}
```

- [ ] **Step 3: Update placingType to include mapping-toggle**

Find the `placingType` state and `onStartPlace` handler. Update the type to include `"mapping-toggle"`. In the `onPlaceItem` handler where default configs are created per type, add:

```typescript
case "mapping-toggle":
  return {
    name: "Toggle",
    type: "mapping-toggle" as const,
    col, row, colSpan: 1, rowSpan: 1,
    oscAddress: "",
    oscTarget: { host: "127.0.0.1", port: 7000 },
    color: "green",
    config: { mappingIds: [] },
  };
```

- [ ] **Step 4: Pass mapping data to DeckConfigPanel**

Where `DeckConfigPanel` is rendered (around line 340-355), add the new props:

```typescript
<DeckConfigPanel
  // ... existing props ...
  oscMappings={recorder.recording?.oscMappings}
  noteTags={recorder.recording?.noteTags}
  laneBadges={recorder.recording?.badges}
  deviceAliases={recorder.recording?.deviceAliases}
/>
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 6: Commit**

```bash
git add src/app/deck/page.tsx
git commit -m "feat: wire deck page to recording context with mapping-toggle support"
```

---

### Task 14: Wire everything in the Live tab (deck/page.tsx live mode)

**Files:**
- Modify: `src/app/deck/page.tsx` (live mode section)

The deck page has a live mode that renders `SectionSelector`, `DeviceStrip`, `LiveDeck`, etc. This task wires up the section-deck linking, toggle state, and live monitor integration.

- [ ] **Step 1: Add deck-toggles hook and section-deck state**

In the deck page component, add:

```typescript
import { useDeckToggles } from "@/hooks/use-deck-toggles";
```

Compute visible decks based on active section:

```typescript
const sectionDeckLinks = recorder.recording?.sectionDeckLinks ?? {};
const allDecks = recorder.recording?.deckPresets ?? [];

const visibleDecks = useMemo(() => {
  if (activeSectionId === null) return allDecks;
  const linkedId = sectionDeckLinks[activeSectionId];
  if (!linkedId) return [];
  const d = allDecks.find((dk) => dk.id === linkedId);
  return d ? [d] : [];
}, [activeSectionId, sectionDeckLinks, allDecks]);

const deckToggles = useDeckToggles(visibleDecks);
```

- [ ] **Step 2: Reset toggles on section switch**

Add an effect that resets toggles when the active section changes:

```typescript
useEffect(() => {
  deckToggles.resetAll();
}, [activeSectionId]);
```

- [ ] **Step 3: Pass disabledMappingIds to useLiveMonitor**

Update the `useLiveMonitor` call to include the disabled set:

```typescript
const liveMonitor = useLiveMonitor({
  recording: recorder.recording,
  endpoints: senderEndpoints,
  activeSectionId,
  disabledMappingIds: deckToggles.disabledMappingIds,
});
```

- [ ] **Step 4: Wire SectionSelector with deck linking**

Add a handler for deck linking:

```typescript
const handleLinkDeck = useCallback((sectionId: string, deckId: string | null) => {
  const current = recorder.recording?.sectionDeckLinks ?? {};
  const next = { ...current };
  if (deckId === null) {
    delete next[sectionId];
  } else {
    next[sectionId] = deckId;
  }
  recorder.patchRecording({ sectionDeckLinks: next });
}, [recorder]);
```

Pass to SectionSelector:

```typescript
<SectionSelector
  sections={recorder.recording?.sections ?? []}
  activeSectionId={activeSectionId}
  onSelect={setActiveSectionId}
  deckPresets={allDecks}
  sectionDeckLinks={sectionDeckLinks}
  onLinkDeck={handleLinkDeck}
/>
```

- [ ] **Step 5: Wire LiveDeck with new props**

Replace the existing `<LiveDeck />` with the new props:

```typescript
<LiveDeck
  decks={allDecks}
  activeSectionId={activeSectionId}
  sectionDeckLinks={sectionDeckLinks}
  sendOsc={deck.sendOsc}
  setValue={deck.setValue}
  itemValues={deck.itemValues}
  onToggle={deckToggles.toggle}
  isToggleOn={deckToggles.isToggleOn}
/>
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 7: Commit**

```bash
git add src/app/deck/page.tsx
git commit -m "feat: wire Live tab with section-deck linking and toggle integration"
```

---

### Task 15: Verify and fix remaining TypeScript errors

**Files:**
- Potentially any of the modified files

- [ ] **Step 1: Run full type check**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1`

Review all errors and fix them. Common issues to expect:
- `DeckGrid` props not matching (toggle props optional, should be fine)
- `DeckConfigPanel` new props being optional
- Any other consumers of `useDeck()` that haven't been updated
- Import paths for removed `MappingToggleConfig`

- [ ] **Step 2: Search for other useDeck consumers**

```bash
grep -rn "useDeck()" src/ --include="*.tsx" --include="*.ts"
```

Any file still calling `useDeck()` without arguments needs to be updated to pass `{ recording, patchRecording }`. The main consumers are:
- `src/app/deck/page.tsx` (updated in Task 13)
- `src/components/live/live-deck.tsx` (no longer uses useDeck — updated in Task 11)

- [ ] **Step 3: Fix any remaining issues**

Address each TypeScript error. If a consumer needs recording context, either:
- Thread it as props
- Use `useRecorderContext()` directly

- [ ] **Step 4: Verify clean compile**

Run: `cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1`
Expected: Clean (only pre-existing warnings if any)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: resolve TypeScript errors from deck overhaul"
```

---

### Task 16: Manual testing

**Files:** None (testing only)

- [ ] **Step 1: Start dev server**

```bash
cd /Users/rense/Projects/osc_tool && pnpm dev
```

- [ ] **Step 2: Test deck creation flow**

1. Load a recording
2. Navigate to Deck page
3. Verify "Load a recording" message when no recording is loaded
4. Create a new deck preset
5. Add items: button, slider, mapping-toggle
6. Configure mapping-toggle with the mapping picker
7. Verify filters (note, tag, address) work

- [ ] **Step 3: Test section-deck linking**

1. Navigate to Live tab
2. Verify section selector shows deck-link dropdowns
3. Link a deck to a section
4. Switch sections — verify correct deck appears
5. Select "All" — verify all decks stacked
6. Set a section to "None" — verify empty state
7. Verify deck saves with recording (save and reload)

- [ ] **Step 4: Test mapping toggles**

1. Create a mapping-toggle item with multiple mappings
2. Switch to Live mode
3. Press toggle — verify visual state change (green/red)
4. Send MIDI — verify disabled mappings don't fire
5. Switch sections — verify toggles reset to "on"
6. Test multiple toggles controlling the same mapping — verify the union rule (disabled if any toggle is off)

- [ ] **Step 5: Test edge cases**

1. Recording with no deckPresets (fresh/old recordings) — should show empty
2. Delete a deck preset — verify section links are cleaned
3. Delete a mapping that's referenced by a toggle — verify graceful handling (toggle just controls fewer mappings)
