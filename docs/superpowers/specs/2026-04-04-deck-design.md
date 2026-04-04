# OSC Deck — Design Spec

## Overview

Replace the current Presets view with a grid-based Deck system for creating custom OSC control surfaces. The deck supports buttons (trigger/toggle), sliders (horizontal/vertical), XY pads, and groups — all arranged on a snap-to-grid layout. Multiple decks with pages allow organizing large setups. The web UI gets a fully interactive version of the deck for remote performance control.

## What It Replaces

The current Presets view (`src/app/presets/page.tsx`, `src/components/preset-card.tsx`, `src/components/osc-input.tsx` as used by presets) is removed entirely. The sidebar label changes from "Presets" to "Deck". The `PresetsStore`, its IPC handlers, and the `usePresets` hook are removed. The `OscInput` component stays — it's still used by the Sender view.

## Data Model

### Deck

```ts
interface Deck {
  id: string;
  name: string;
  gridColumns: number;  // default 8
  gridRows: number;     // default 6
  pages: DeckPage[];
}

interface DeckPage {
  id: string;
  name: string;
  items: DeckItem[];
  groups: DeckGroup[];
}
```

### DeckGroup

A container that visually wraps related items with a title. Items inside a group are positioned relative to the group's internal grid. Groups can be moved as a unit. Items can be dragged in and out of groups.

```ts
interface DeckGroup {
  id: string;
  name: string;
  color: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  items: DeckItem[];  // positioned relative to group's top-left
}
```

### DeckItem

```ts
interface DeckItem {
  id: string;
  name: string;
  type: "button" | "slider" | "xy-pad";
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  oscAddress: string;
  oscTarget: { host: string; port: number };
  color: string;
  config: ButtonConfig | SliderConfig | XYPadConfig;
}

interface ButtonConfig {
  mode: "trigger" | "toggle";
  triggerValue: OscArg;
  toggleOnValue: OscArg;
  toggleOffValue: OscArg;
}

interface SliderConfig {
  orientation: "horizontal" | "vertical";
  min: number;
  max: number;
  valueType: "f" | "i";
}

interface XYPadConfig {
  xAddress: string;
  yAddress: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}
```

### Storage

All decks stored in a single JSON file at `app.getPath("userData")/decks.json`. Loaded into memory on startup, saved on every mutation.

## UI Design

### Layout

The Presets sidebar item becomes "Deck" (icon: 🎛). The deck view has three zones:

1. **Top bar:** Deck selector dropdown, page tabs with add/rename/delete, edit mode toggle button
2. **Grid area:** The snap-to-grid deck surface (CSS Grid, default 8 columns x 6 rows)
3. **Status bar:** Existing throughput counter and web server toggle (shared with all views)

### Grid Rendering

- CSS Grid with `grid-template-columns: repeat(N, 1fr)` and `grid-template-rows: repeat(M, 1fr)`
- Items placed via `grid-column` and `grid-row` using their `col`, `row`, `colSpan`, `rowSpan`
- Empty cells are invisible in live mode, shown with dashed borders in edit mode
- Gap of 8px between cells

### Item Appearance (Live Mode)

**Buttons:**
- Rounded rectangle with colored background (subtle, not garish)
- Name in the center, bold
- OSC address below the name in small gray text
- Toggle buttons show an ON/OFF indicator badge when active
- Visual feedback on press (brief scale or glow)

**Sliders:**
- Vertical: name at top, fill bar from bottom, current value below the bar, OSC address at bottom
- Horizontal: name on left, fill bar in center, value on right
- Fill color matches the item's color setting
- Smooth drag interaction, value updates sent as OSC while dragging

**XY Pads:**
- Name at top
- Square area with subtle crosshair grid lines
- Draggable dot showing current position
- X and Y addresses shown at bottom
- Current X,Y values displayed
- Sends both X and Y OSC messages while dragging

**Groups:**
- Background rectangle with subtle colored border and fill
- Group name as a label at the top-left of the group
- Items inside render normally, positioned relative to the group's grid area

### Edit Mode

Toggled by the "Edit Mode" button in the top bar. When active:

**Visual changes:**
- All items show drag handles (top edge) and resize handles (bottom-right corner)
- Empty grid cells show dashed borders as drop targets
- A toolbar appears below the top bar: **+ Button**, **+ Slider**, **+ XY Pad**, **+ Group**
- The edit mode button changes to an active/highlighted state

**Interactions:**
- **Drag items** to reposition on the grid (snap to cells)
- **Resize items** by dragging the corner handle (snap to cell boundaries)
- **Click an item** to open its config panel
- **Click "+ Button/Slider/XY Pad/Group"** then click an empty cell to place it
- **Drag items in/out of groups** to reparent them
- **Drag a group** to move it and all its children together

**Config panel** (slides in as a right side panel, overlaying part of the grid):
- Name text field
- OSC Address text field
- Target host:port (with saved endpoints dropdown from the existing EndpointsStore)
- Color selector (preset swatches: blue, green, purple, red, orange, yellow, gray)
- Type-specific settings:
  - Button: trigger vs toggle radio, value fields for each state
  - Slider: orientation toggle, min/max number inputs, float vs int toggle
  - XY Pad: X address, Y address, X/Y min/max inputs
  - Group: name, color only (no OSC config)
- Delete button at the bottom

**Auto-save:** All changes persist immediately. No explicit save button.

### Deck & Page Management

**Deck selector (dropdown in top bar):**
- Lists all decks by name
- "New Deck" option at the bottom to create a new one
- Right-click or context menu on a deck name to rename or delete

**Page tabs:**
- Horizontal tabs next to the deck selector
- Click to switch pages
- "+" tab to add a new page
- In edit mode: right-click a tab to rename or delete the page
- Minimum one page per deck (can't delete the last one)

## Architecture

### Main Process

**DeckStore** (`electron/deck-store.ts`):
- Manages decks.json file (load, save)
- CRUD for decks, pages, items, groups
- Methods: `getDecks()`, `getDeck(id)`, `createDeck(name)`, `deleteDeck(id)`, `updateDeck(id, updates)`, `createPage(deckId, name)`, `deletePage(deckId, pageId)`, `addItem(deckId, pageId, item)`, `updateItem(deckId, pageId, itemId, updates)`, `removeItem(deckId, pageId, itemId)`, `addGroup(deckId, pageId, group)`, `updateGroup(...)`, `removeGroup(...)`, `moveItemToGroup(deckId, pageId, itemId, groupId)`, `moveItemOutOfGroup(deckId, pageId, itemId, groupId)`

**IPC handlers** (added to `electron/ipc-handlers.ts`):
- `deck:get-all` → returns all decks
- `deck:get` → returns single deck
- `deck:create`, `deck:update`, `deck:delete`
- `deck:create-page`, `deck:update-page`, `deck:delete-page`
- `deck:add-item`, `deck:update-item`, `deck:remove-item`
- `deck:add-group`, `deck:update-group`, `deck:remove-group`
- `deck:move-item-to-group`, `deck:move-item-out-of-group`

Existing presets IPC handlers are removed.

### Renderer

**New files:**
- `src/app/deck/page.tsx` — deck page (replaces `src/app/presets/page.tsx`)
- `src/components/deck-grid.tsx` — the CSS Grid surface, renders items and groups
- `src/components/deck-item.tsx` — renders a single item (button/slider/xy-pad) in live and edit modes
- `src/components/deck-group.tsx` — renders a group container with its children
- `src/components/deck-toolbar.tsx` — edit mode toolbar (add item buttons)
- `src/components/deck-config-panel.tsx` — item/group configuration panel
- `src/components/deck-topbar.tsx` — deck selector, page tabs, edit toggle
- `src/hooks/use-deck.ts` — IPC hooks for deck CRUD and state management

**Removed files:**
- `src/app/presets/page.tsx`
- `src/components/preset-card.tsx`

**Modified files:**
- `src/components/sidebar.tsx` — rename "Presets" to "Deck", update icon and href
- `src/app/page.tsx` — if it references presets, update redirect

### Web UI

**Changes to `web/index.html`:**
- Add deck rendering alongside the existing listener/sender UI
- Deck data sent from main process via WebSocket on connection and on every change
- Web client renders the same grid layout using CSS Grid
- Buttons clickable, sliders draggable, XY pads draggable — all interactions sent back via WebSocket to main process which fires OSC
- No edit mode in web UI
- Deck selector and page tabs included

**WebSocket protocol additions:**
- Server → Client: `{ type: "deck-state", data: Deck[] }` — full deck data
- Server → Client: `{ type: "deck-update", data: Deck }` — single deck changed
- Client → Server: `{ type: "deck-trigger", deckId, pageId, itemId }` — button press
- Client → Server: `{ type: "deck-toggle", deckId, pageId, itemId }` — toggle flip
- Client → Server: `{ type: "deck-slider", deckId, pageId, itemId, value: number }` — slider change
- Client → Server: `{ type: "deck-xy", deckId, pageId, itemId, x: number, y: number }` — XY pad change

### Data Flow

```
Electron App (Edit Mode)
    ↓ IPC
Main Process (DeckStore) → save to decks.json
    ↓ IPC (deck-update)
Renderer (live deck)
    ↓ WebSocket (deck-state / deck-update)
Web Client (live deck)

User Interaction (button/slider/xy)
    ↓ IPC or WebSocket
Main Process → OscManager.sendMessage()
    ↓ UDP
External App (Resolume/Unreal)
```

## Project Structure Changes

```
electron/
├── deck-store.ts          # NEW: deck CRUD and persistence
├── ipc-handlers.ts        # MODIFIED: add deck handlers, remove presets handlers
├── presets-store.ts        # REMOVED
src/
├── app/
│   ├── deck/
│   │   └── page.tsx        # NEW: replaces presets/page.tsx
│   ├── presets/            # REMOVED
├── components/
│   ├── deck-grid.tsx       # NEW
│   ├── deck-item.tsx       # NEW
│   ├── deck-group.tsx      # NEW
│   ├── deck-toolbar.tsx    # NEW
│   ├── deck-config-panel.tsx # NEW
│   ├── deck-topbar.tsx     # NEW
│   ├── preset-card.tsx     # REMOVED
│   ├── sidebar.tsx         # MODIFIED: Presets → Deck
├── hooks/
│   ├── use-deck.ts         # NEW
│   ├── use-osc.ts          # MODIFIED: remove usePresets
├── lib/
│   └── types.ts            # MODIFIED: add Deck types, remove Preset type
web/
│   └── index.html          # MODIFIED: add deck UI
```
