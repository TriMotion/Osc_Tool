# Live Tab — Design Spec

**Date:** 2026-04-19
**Branch:** feat/trigger-discovery

---

## Overview

A new top-level **Live** tab that provides real-time monitoring of incoming MIDI and its OSC output, plus a collapsible panel for editing OSC mappings in bulk. The tab requires a recording to be loaded — the recording provides the device→mapping links used to resolve which OSC signals to fire.

---

## Layout

Three vertical zones, top to bottom:

### Zone 1 — Device Strip (always visible)

A fixed-height row of device cards, one per connected MIDI device. Each card displays:

- Device name
- **MIDI flash indicator** (subtle blue/white pulse) — fires on any incoming MIDI event from this device
- **OSC flash indicator** (bright amber/green pulse) — fires when that input matches a mapping and triggers an OSC output

Both flashes use a brief CSS animation (e.g. 150ms fade-out). The two distinct colours let a performer instantly distinguish "MIDI received" from "OSC sent" at a glance.

---

### Zone 2 — Activity Feed (scrollable, fills remaining space)

A reverse-chronological event log. Each row represents one incoming MIDI event:

**Unmapped row (greyed out):**
`[device] · [note/CC + velocity] · [timestamp]`

**Mapped row (full colour, with flash on arrival):**
`[device] · [note/CC + velocity] · [timestamp] → [OSC address] · [host:port] · [value]`

Controls above the feed:
- **Toggle: Show unmapped events** (on/off) — when off, only rows that triggered OSC output are shown

Mapped rows flash briefly when they appear (same amber/green as the device strip indicator).

---

### Zone 3 — Mapping Config (collapsible panel, collapsed by default)

Collapsed by default so it is out of the way during live performance. A chevron/header bar toggles it open.

**When expanded:**

**Filter bar:**
- Filter by preset type: All / Resolume / Unreal / Custom
- Filter by endpoint: All / [list of saved endpoints by name]

**Mapping table** — one row per OSC mapping in the loaded recording:
- Columns: Device · Trigger (note/CC) · Preset · OSC Address · Endpoint
- All fields editable inline (except trigger — mapped notes are not changed here)
- Flash indicator per row when that mapping fires live

**Batch endpoint reassignment:**
- Checkbox column for row selection
- "Reassign endpoint" action appears when ≥1 row selected → dropdown to pick a saved endpoint → applies to all selected rows
- Changes are saved back to the recording's `oscMappings` array

---

## Data Flow

```
MIDI bridge (electron/midi-manager) 
  → IPC midi:events 
  → useLiveMonitor hook (new)
      → cross-references loaded recording.oscMappings via matchesMapping()
      → emits: { event, mapping | null, address | null, endpoint | null }
  → Live tab components consume this stream
```

The `useLiveMonitor` hook mirrors the matching logic from `useOscPlayback` but operates on real-time IPC events rather than a pre-computed playback queue. For each event it:
1. Matches against the loaded recording's `oscMappings` via `matchesMapping()`
2. Fires `osc:send` IPC for any matched mapping (resolving address + value the same way as `useOscPlayback`)
3. Emits an activity entry `{ event, mapping | null, address | null, endpoint | null }` for the UI to display

---

## OSC Mapping Edits

Editable fields in the Live tab config panel:
- **Custom preset:** OSC address string
- **Unreal preset:** section, parameter name, type (parameter/trigger)
- **Resolume preset:** mode (column/clip), indices
- **Endpoint:** which saved endpoint to send to

Not editable here (use Timeline tab for these):
- Trigger note / CC / pitch / velocity
- Preset type change

Batch endpoint reassignment updates `recording.oscMappings` and persists immediately via existing `recording:save` IPC.

---

## State & Hooks

| Hook | Responsibility |
|---|---|
| `useLiveMonitor` (new) | Subscribe to `midi:events` IPC, match against mappings, fire `osc:send`, emit activity entries |
| `useOscPlayback` (existing) | Unchanged — handles timeline playback mode only |

The activity feed is a bounded in-memory ring buffer (e.g. last 500 entries) to avoid memory growth during long sessions.

---

## Components

| Component | File (new unless noted) |
|---|---|
| `LivePage` | `src/app/live/page.tsx` |
| `DeviceStrip` | `src/components/live/device-strip.tsx` |
| `DeviceCard` | `src/components/live/device-card.tsx` |
| `ActivityFeed` | `src/components/live/activity-feed.tsx` |
| `ActivityRow` | `src/components/live/activity-row.tsx` |
| `MappingConfigPanel` | `src/components/live/mapping-config-panel.tsx` |
| `MappingTable` | `src/components/live/mapping-table.tsx` |

The existing `OscMappingEditor` modal is **not** reused here — the Live tab uses inline row editing for speed.

---

## Empty State

When no recording is loaded, the Live tab shows a prompt: "Load a recording in the Timeline tab to start live monitoring." All three zones are hidden until a recording is present.

---

## Out of Scope

- Changing which notes are mapped (use Timeline tab)
- Adding new mappings from scratch (use Timeline tab)
- Audio playback or timeline scrubbing
- Recording new MIDI in the Live tab
