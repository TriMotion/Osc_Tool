# Deck Overhaul Design

## Overview

Overhaul the deck system so decks live inside recordings, can be linked to sections, and gain a new `mapping-toggle` item type that enables/disables OSC and DMX mappings during live performance.

## Goals

1. Decks are stored inside recordings (not globally)
2. Multiple deck presets per recording
3. Each section links to a deck preset — switching sections auto-loads the linked deck
4. New `mapping-toggle` item type for toggling mappings on/off
5. Mapping picker with note/tag/address filtering for configuring toggles
6. Clear visual indication of enabled/disabled state
7. Runtime-only toggle state — resets on section switch or recording load

## Data Model

### New types

```typescript
interface MappingToggleConfig {
  mappingIds: string[];  // OscMapping IDs this button controls
}
```

### Modified types

**DeckItem** — extend `type` union and `config` union:

```typescript
interface DeckItem {
  // ... existing fields ...
  type: "button" | "slider" | "xy-pad" | "dmx-trigger" | "dmx-fader" | "dmx-flash" | "mapping-toggle";
  config: ButtonConfig | SliderConfig | XYPadConfig | DmxTriggerConfig | DmxFaderConfig | DmxFlashConfig | MappingToggleConfig;
}
```

**Recording** — two new optional fields:

```typescript
interface Recording {
  // ... existing fields ...
  deckPresets?: Deck[];                      // all deck presets for this recording
  sectionDeckLinks?: Record<string, string>; // sectionId → deckId
}
```

### Runtime state (not persisted)

```typescript
// Per-toggle-button state: true = on (mappings enabled), false = off (mappings disabled)
toggleStates: Map<string, boolean>  // toggleItemId → on/off
```

A mapping is disabled if **any** toggle button that controls it is in the "off" state. The mapping only fires when **all** toggle buttons referencing it are "on".

Toggle states are scoped to currently visible decks only. Decks from other (non-active) sections have no influence on mapping state. When "All" is selected, each visible deck maintains its own independent toggle states — a toggle in deck A only affects mappings it controls, independent of deck B's toggles. A mapping is disabled if any toggle in any visible deck that references it is "off".

## Deck Storage Migration

- Remove `electron/deck-store.ts` — global deck persistence is eliminated
- `use-deck.ts` hook rewires to read/write `recording.deckPresets` via the existing recording context
- Deck CRUD (create, rename, delete, duplicate) operates on the recording's `deckPresets` array
- No migration of old `decks.json` data — standalone decks are abandoned
- The deck page requires a loaded recording; without one it shows: "Load a recording to manage deck presets"

## Section-Deck Linkage

### Configuration

In the Live tab's section selector, each section gets a dropdown to assign a deck preset. Options:
- All available deck presets from the recording
- **"None"** — this section has no deck (shows empty state when active)

### Runtime behavior

1. User switches section → look up `sectionDeckLinks[sectionId]` → load that deck
2. User selects "All" → show **all** deck presets stacked vertically, scrollable if they overflow
3. No deck linked to active section → show "No deck linked" message
4. `toggleStates` resets entirely on section switch (all toggles back to "on")

### "None" and "All" semantics

- A deck set to "None" for all sections still appears in the "All" view — "None" only controls per-section visibility
- To fully remove a deck (including from "All"), delete it
- "All" = every deck that exists in the recording, regardless of section linkage

## Mapping Toggle Item

### Rendering

- Displayed as a button with clear on/off visual state (green = enabled, dimmed/red = disabled)
- Shows the item name and a badge with the count of controlled mappings
- Pressing toggles all its `mappingIds` as one batch

### Configuration (edit mode)

The config panel shows a mapping picker with filters:
- **Note filter** — pitch number or note name (e.g. "C3", "60")
- **Tag filter** — matches against `NoteGroupTag` labels and `LaneBadge` labels
- **Address filter** — matches against the mapping's OSC address string

The filtered list shows matching mappings with checkboxes. Each row shows: device, target (note/lane), address, and any tags.

### Per-button state model

Each toggle button tracks its own on/off state independently. A mapping is disabled if any controlling toggle is "off":

- Button A=on, Button B=on → mapping fires
- Button A=off, Button B=on → mapping disabled
- Button A=on, Button B=off → mapping disabled
- Button A=off, Button B=off → mapping disabled

The toggle button visual reflects its own state, not the resolved state of individual mappings.

## Live Monitor Integration

`use-live-monitor` gains one additional filter step in the mapping evaluation pipeline:

1. Incoming MIDI event arrives
2. Resolve live device link → recording device name
3. Skip if device is in `disabledLiveDevices`
4. Find matching `OscMapping`s (existing logic)
5. Filter by `activeSectionId` (existing logic)
6. **Skip if mapping ID is disabled by any active toggle button**
7. Fire OSC/DMX/effect

Step 6: for each matched mapping, check all toggle buttons in the active deck(s) that reference this mapping ID. If any toggle is "off", skip the mapping.

## Deck Page Changes

### Recording dependency

- Deck page requires a loaded recording
- Without one: "Load a recording to manage deck presets"
- Deck CRUD operates on `recording.deckPresets`

### Preset management

- Top bar shows dropdown/tabs to switch between deck presets
- "New deck" button creates a new preset
- Each deck has name, grid dimensions, pages — same structure as today

### Edit vs. live modes

- Deck page: full edit mode (rearrange, add items, configure)
- Live tab deck area: performance mode only (interact with items, no editing)

## Files Affected

### Remove

- `electron/deck-store.ts` — global deck persistence
- Related IPC handlers for old deck store

### Modify

- `src/lib/types.ts` — add `MappingToggleConfig`, extend `DeckItem.type` union, add `deckPresets` and `sectionDeckLinks` to `Recording`
- `src/hooks/use-deck.ts` — rewire from IPC to recording context
- `src/hooks/use-live-monitor.ts` — add toggle-based mapping filter
- `src/app/deck/page.tsx` — recording dependency, preset management
- `src/components/live/section-selector.tsx` — deck link picker per section
- `src/components/live/live-deck.tsx` — render active deck with toggle support, stacked "All" view
- Deck grid/config components — support new `mapping-toggle` type

### No changes

- Recording store serialization — new fields follow existing optional-field pattern
- `OscMapping` type — no `enabled` field, toggle state is runtime-only
- Timeline page — decks are Live tab / deck page only
