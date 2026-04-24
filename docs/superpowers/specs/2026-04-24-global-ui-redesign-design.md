# Oscilot Global UI Redesign — Design Spec

## Overview

A global UI overhaul of the Oscilot desktop app covering theme, navigation consolidation, and component consistency. The app moves from a dark blue-gray theme with a single cyan accent to a true black canvas with semantic domain-colored accents and a consolidated 5-item navigation.

## Theme & Color System

### Surfaces

| Token | Hex | Usage |
|-------|-----|-------|
| `bg-black` | `#000000` | Main canvas, sidebar, status bar |
| `bg-panel` | `#0a0a0a` | Cards, panels, message log containers |
| `bg-elevated` | `#111111` | Inputs, interactive areas |

### Domain Accents

| Domain | Name | Hex | Usage |
|--------|------|-----|-------|
| Input | Green | `#00ff8c` | OSC Listener, MIDI Devices |
| Output | Amber | `#f59e0b` | OSC Sender, DMX |
| Deck/Live | Blood | `#b91c1c` | Deck editor, live perform mode |
| Timeline | Blue | `#4488ff` | Timeline page |
| Diagnostics | Steel | `#555555` | Diagnostics page |

Each accent has three usage tiers:
- **Solid** — primary buttons, active indicators (full hex)
- **Ghost** — ghost buttons, tinted backgrounds (`{accent}/0c` fill + `{accent}/25` border)
- **Outline** — outline buttons, subtle borders (`{accent}/33` border only)

Glow effects use `box-shadow: 0 0 Npx {accent}` at ~25% opacity for active indicators.

### Borders

| Opacity | Usage |
|---------|-------|
| `#ffffff06` | Subtle dividers, panel separators |
| `#ffffff0a` | Panel borders |
| `{accent}/20` | Active/focused state borders |
| `{accent}/18` | Input focus borders |

### Text

| Color | Usage |
|-------|-------|
| `#ffffff` | Headings |
| `#aaaaaa` | Body text |
| `#666666` | Labels, secondary text |
| `#333333` | Disabled text |

### Replaces

All existing `bg-surface`, `bg-surface-light`, `bg-surface-lighter` Tailwind tokens are replaced. The single `accent` / `accent-dim` colors are replaced by per-domain tokens.

## Icons

- **No emojis anywhere in the UI.** Replace all emoji icons with flat SVG icons from a consistent icon set (e.g. Lucide, Phosphor, or Heroicons).
- Sidebar nav icons, toolbar buttons, status indicators, and all other icon usage must use flat SVG icons.
- Icon style: outline/line style, 1.5px stroke weight, consistent sizing (20px sidebar, 16px inline).
- Icon color inherits from parent text color (domain accent when active, muted when inactive).

## Navigation

### Structure

Sidebar consolidates from 8 items to 5:

| Nav Item | Domain Color | Contents |
|----------|-------------|----------|
| Input | Green `#00ff8c` | Tabs: OSC Listener, MIDI Devices |
| Output | Amber `#f59e0b` | Tabs: OSC Sender, DMX |
| Deck | Blood `#b91c1c` | Toggle: Edit mode, Perform mode |
| Timeline | Blue `#4488ff` | Unchanged scope |
| Diagnostics | Steel `#555555` | Unchanged scope |

### Sidebar Behavior

- Active nav item: `{accent}/10` background tint, `{accent}/25` border
- Inactive items: 40% opacity
- Existing Framer Motion `layoutId` shared animation retained for active indicator
- Domain-colored highlight replaces the current single cyan accent

### In-Page Tabs (Input & Output)

- Horizontal tab bar below the page header
- Active tab: domain accent color for text and 2px bottom border
- Inactive tabs: `#444` text
- Tab switching uses a subtle 150ms fade transition

## Deck Edit/Perform Toggle

### Edit Mode

Current Deck experience preserved:
- DeckTopbar with deck/page selector
- DeckToolbar with item placement buttons
- DeckGrid with drag/drop and resize
- DeckConfigPanel sidebar for selected item properties

### Perform Mode

Strips editor chrome, adds live components:
- No toolbar, no config panel
- Deck grid goes full width
- SectionSelector for timeline sections
- DeviceStrip with activity indicators
- ActivityFeed for mapped/unmapped events
- MIDI bridge bar visible in both modes

### Toggle UI

Segmented control in the deck top bar: `Edit | Live`. Styled in blood red accent. Crossfade transition (200ms) between modes.

### Implementation

The existing `useLiveMonitor` hook and section filtering logic carry over directly into perform mode. No new state management — just a different layout around the same deck grid.

## Component Styling

### Panels & Cards

- Background: `#0a0a0a`
- Border: `#ffffff06`
- Border radius: `rounded-lg` (8px) standardized everywhere (no `rounded-xl`)

### Inputs

- Background: `#111`
- No visible border at rest
- Focus: `{domain-accent}/18` border
- Focus outline: none

### Buttons

- **Primary:** Solid domain accent fill, white or black text (based on contrast), glow shadow (`box-shadow: 0 0 12px {accent}25`)
- **Ghost:** `{accent}/0c` fill, `{accent}/25` border, accent text
- **Outline:** Border-only at `{accent}/33`, accent text
- Press feedback: `whileTap={{ scale: 0.97 }}`

### Message Log

- Row background: `#0a0a0a`
- Left border: domain accent color, fading opacity for older messages
- Monospace font for OSC addresses and values
- Timestamp in `#333`

### Activity Indicators

- Dots with `box-shadow` glow in relevant domain accent
- Pulse animation on activity
- 200ms `transition-colors` for state changes

### Status Bar

- Background: `#000` (same as canvas)
- Top border: `#ffffff06`
- Content: activity dots, local IP, throughput counter
- Text: `#444`

### Scrollbars

- Thin track: `#222`
- Thumb: `#444`
- Hidden until hover

## Animation & Transitions

### Timing Standards

| Category | Duration | Usage |
|----------|----------|-------|
| Micro-interactions | 150ms | Hover states, tab switches, button feedback |
| Layout changes | 200ms | Panel collapse/expand, mode toggle, activity flashes |

### Specific Animations

- **Page transitions:** None — instant swap between nav items
- **Tab transitions:** 150ms fade within Input/Output pages
- **Sidebar active indicator:** Framer Motion `layoutId` spring animation, domain-colored highlight
- **Mode toggle (Deck):** 200ms crossfade between Edit and Perform layouts
- **Buttons:** `whileTap={{ scale: 0.97 }}` retained
- **Collapsible panels:** Existing `AnimatePresence` height animations (200ms) retained
- **Activity flashes:** CSS `transition-colors 200ms`
- **Hover states:** `transition-colors 150ms` on all interactive elements, color shift only (no scale)

## Modals & Overlays

- **No semi-transparent backdrops.** All modals and popups render on a solid `#000` or `#0a0a0a` background — no `bg-black/50` or opacity overlays.
- Modals are full panels that slide in or appear in place, not floating dialogs over dimmed content.
- Confirmation dialogs and editors (badge editor, OSC mapping editor, note tag editor) use solid panel backgrounds with `#ffffff06` borders.

## Text Overflow & Accessibility

- **All text must be fully readable.** Where content is truncated (`text-ellipsis`, `overflow-hidden`), provide one of:
  - A `title` attribute tooltip showing the full text on hover
  - An expand-on-click or expand-on-hover mechanism
  - A resizable container (e.g. drag handle)
- This applies to: OSC addresses, file paths, device names, mapping labels, log messages, and any user-generated content.
- **All buttons must be reachable.** No button may be hidden behind overflow, clipped by a parent container, or only accessible via scroll without a visible scroll indicator. If a panel has more actions than fit, use a scrollable area with visible scrollbar or a "more" menu.
- Minimum touch/click target: 32px height for all interactive elements.
