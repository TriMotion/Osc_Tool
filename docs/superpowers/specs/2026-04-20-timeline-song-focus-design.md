# Timeline — Song-focused redesign

**Date:** 2026-04-20
**Status:** Draft for implementation
**Area:** `src/app/timeline/page.tsx`, `src/components/timeline/**`

## Problem

The Timeline tab shows everything at once: the full multi-song recording, every
device/lane, every badge, every analysis overlay, every OSC mapping. Real
recordings contain multiple songs, segmented via `recording.sections`, but the
frontend doesn't reflect that. The user almost always works on **one song at a
time** — analysing it and mapping OSC from its events — yet the UI forces them
to visually filter out the rest of the recording every time they look at it.

The backend already models sections as time-ranged, named, colored regions.
The fix is structural, not cosmetic: make "one song at a time" the primary
working mode of the page.

## Goals

1. One focused song drives the main timeline view — ruler, lanes, badges,
   markers, analysis, and OSC mappings all scope to that song's time range.
2. A compact "songs strip" at the top is the only UI that shows the whole
   recording. It's where you switch songs.
3. OSC mapping lives at the entry points the user actually uses: the notes
   dropdown (note-tag editor) and the CC lane. The triggers sidebar becomes a
   secondary overview, not the primary workflow.
4. Overall density drops: fewer rows in the header, a lighter left gutter,
   controls collapsed behind hover/overflow where they don't need to be
   permanently visible.

## Non-goals

- Per-song playback/export isolation at the audio-engine level.
- Reordering songs in the strip.
- Cross-song bulk operations beyond a "copy mapping to…" action.
- A full visual/theme overhaul beyond the structural changes here.

## Information architecture

Three stacked regions replace the current page stack:

1. **Header bar (single row).** Title, transport (Record / Play / time
   readout), overflow "File ▾" menu (Save, Save As, Save project, Load
   recording, Import .mid), bridge status pill (click to start/stop), project
   folder pill. Banners (bridge error, I/O error, audio missing) insert as
   dismissible rows *below* the header only when active.
2. **Songs strip.** The only place that shows the whole recording. Segments =
   `recording.sections`, rendered proportionally to their time range. Click a
   segment → focus that song. Drag/resize/rename continues to work (move the
   existing `SectionBar` interactions into the strip). A 1px playhead marker
   rides across the strip showing global position. `[` / `]` step between
   songs. A "whole recording" pseudo-segment is shown when the recording has
   no sections or while recording is active.
3. **Song workspace.** Everything below the strip: ruler, audio lane, device
   sections with their note/program/continuous lanes, marker lane, badges,
   analysis overlays. All scoped to the focused song's time range.

## Focus model

Single page-level state:

```ts
const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
```

Derived:

```ts
const focusedSection = recording?.sections?.find(s => s.id === focusedSectionId) ?? null;
const viewRange = focusedSection
  ? { startMs: focusedSection.startMs, endMs: focusedSection.endMs }
  : { startMs: 0, endMs: durationMs };
```

Rules:

- `focusedSectionId === null` → "whole recording" mode. Fallback when there
  are no sections yet, or while recording. The songs strip shows a single
  dimmed "Untitled recording" block.
- Setting focus updates the canvas viewport and filters overlays
  (badges, note tags, markers, OSC mappings) to events whose time is within
  the section range.
- Playback respects focus: pressing Play when the playhead is outside the
  focused song seeks to the section's `startMs` first, then plays.
  Inside-range plays continue as-is. The user can still scrub inside the
  strip to seek globally.
- Recording always targets the full recording. Starting a recording clears
  focus to `null`.
- Deleting the focused section → focus clears to `null`.
- Editing a focused section's boundaries (drag handles) updates the workspace
  view range live.

## Per-song scoping

### Lanes

The lane list for a device is computed as today, then filtered to lanes that
have at least one event within `viewRange`. Provide a small "Show all lanes"
toggle on the device header for consistency between songs where needed.

### Badges, note tags, moment markers

Filter by `startMs ∈ [viewRange.startMs, viewRange.endMs]`. Editors continue
to operate on the live `Recording` object; filtering is presentation-only.

### OSC mappings

Schema change:

```ts
// src/lib/types.ts
export interface OscMapping {
  id: string;
  // ...existing fields
  sectionId?: string; // NEW — required going forward; optional only for
                      // migration of legacy data
}
```

**Migration — on every recording load:**

1. For each mapping without `sectionId`, find its trigger event's time (the
   field already used to position the mapping's trigger).
2. Find the section whose range contains that time.
3. If found → assign `sectionId`. If not found → leave `sectionId`
   unassigned; this mapping becomes an **orphan** (see below).
4. Persist the patched recording through the normal `patchRecording` path so
   the migration sticks on next save.

**Orphan mappings** (no matching section): visible only in whole-recording
mode. Each shows a small "⚠ outside sections" chip with actions "Extend
section" / "Delete". They are not shown inside any song's focused view.

**New mappings** always inherit the focused song's id at creation time. The
mapping editor accepts a `sectionId` prop.

**Copy-to action:** from the song-scoped mapping list (drawer), "Copy to
song…" duplicates a mapping with a new id and the selected `sectionId`.

### Analysis

Per-lane analysis is already computed; no computation change. The workspace
visually clips it to `viewRange`. The Triggers data view likewise scopes to
the focused song's events.

## Left gutter cleanup (220px → ~140px)

- Lane label and value readout remain as the default visible content.
- Per-lane controls (hide, suppress analysis, rename) collapse into a
  hover-revealed `⋯` button that opens a small popover anchored to the lane
  row.
- Device section headers show name + `⋯` (rename, delete, hide device).
  Remove the multi-button row currently in `device-section.tsx`.

## Mapping entry points (primary workflow)

The triggers sidebar stops being the primary path. The two real entry points
get the attention:

### 1. Notes dropdown / note-tag editor

When the user opens the notes dropdown for a pitch/velocity group, add a
**"Map to OSC…"** row. Clicking it:

1. Opens `osc-mapping-editor` as a modal.
2. Pre-fills: device, lane kind = notes, pitch/velocity filter from the tag.
3. Assigns `sectionId = focusedSectionId` on save.
4. The tag row shows a compact `→ /path/here` chip when a mapping exists,
   hover → Edit / Delete / Copy-to.

### 2. CC lane (continuous lane)

Replace the existing `OSC` button with:

- **Unmapped:** a low-contrast inline `＋ Map` chip at the right of the lane
  label.
- **Mapped:** a pill showing `→ /fixture/intensity` (or whatever the mapping
  writes). Hover reveals Edit / Delete / Copy-to.

Clicking either opens the unified `osc-mapping-editor` modal, pre-filled with
device, lane, CC number, and `sectionId = focusedSectionId`.

Both entry points use the same editor component and persistence path; only
pre-fill differs.

### Triggers sidebar (secondary)

Renamed "Mappings". Content filters to `focusedSectionId`. It becomes a
read-focused overview (list of mappings in the current song with quick
Edit/Delete/Copy-to). The header button moves to lower-priority placement in
the overflow menu.

## Component changes

**New**

- `songs-strip.tsx` — renders `recording.sections` as proportional
  clickable/draggable segments. Takes over the current `SectionBar`'s
  interactions (create, move, resize, rename). Emits `onFocus(sectionId)`
  and `onSectionsChange`. Renders global playhead as a 1px marker.

**Modified**

- `timeline-canvas.tsx` — accepts `focusedSection: TimelineSection | null`,
  derives `viewRange`, filters overlays. Stops rendering the in-canvas
  section bar (moved to the songs strip). Keeps its own internal
  zoom/pan but clamped to `viewRange`.
- `timeline-toolbar.tsx` — collapses Save / Save As / Save Project / Load
  recording / Import .mid into a single `File ▾` menu. Bridge button and
  project folder pill move out of the toolbar into the new compact header.
- `triggers-sidebar.tsx` — receives `focusedSectionId`, filters, renames
  "Mappings", repositions in overflow.
- `notes-lane.tsx` + note-tag editor — adds "Map to OSC…" entry, renders
  mapping chip when present.
- `continuous-lane.tsx` — replaces `OSC` button with `＋ Map` / `→ path`
  chip and hover menu.
- `osc-mapping-editor.tsx` — accepts `sectionId` prop, writes it onto saved
  mapping. Accepts `prefill` for device/lane/pitch/CC.
- `device-section.tsx` — slimmer header, `⋯` popover for rename/delete/hide.
- `src/lib/types.ts` — add optional `sectionId` to `OscMapping`.
- `src/app/timeline/page.tsx` — holds `focusedSectionId`, wires it
  everywhere, runs OSC-mapping migration on `applyLoadedRecording`.

**Unchanged**

- Recorder, audio sync, trigger analysis engine, hover card, badge editor,
  recording-info panel, MIDI merge flow, project-folder dropdown logic
  (only its placement changes).

## Behavior edge cases

- Switching songs while playing → seek to new section's `startMs`,
  playback continues.
- Editing a focused section's boundaries → workspace view range updates
  live; a badge or marker that drifts outside the new range disappears from
  the workspace but is not deleted.
- Deleting the focused section → focus clears to `null`, workspace
  switches to whole-recording view.
- Importing MIDI while focused on a song → imported events go into the
  full recording; focus is preserved (the user can re-section afterwards).
- Recording a new take → focus clears; strip shows one "Untitled" segment
  until the user cuts it.

## Shortcuts

- `[` — focus previous song
- `]` — focus next song
- `Esc` in song-focused mode — clears focus to whole-recording view
- Existing `Space` play/pause unchanged.

## Testing approach

Manual testing only (consistent with current project practice). After
implementation:

1. Load a multi-song `.oscrec` with existing (pre-migration) OSC mappings.
   Confirm they attach to the right sections and orphans are flagged.
2. Focus each song in turn; confirm the workspace, badges, markers, and
   mappings are correctly scoped.
3. Create a new mapping from the notes dropdown and from a CC lane; confirm
   the new mapping carries `sectionId = focusedSectionId`.
4. Delete a section while focused on it; confirm focus clears.
5. Edit a section's boundaries while focused; confirm the workspace range
   follows.
6. Start a recording while focused on a song; confirm focus clears and the
   full take captures normally.
7. Play/pause across song boundaries; confirm seek-to-start behavior.

## Implementation order (rough)

1. Type + migration: add `sectionId` to `OscMapping`, write migration on
   load.
2. Introduce `focusedSectionId` in the page and thread it through.
3. Extract `SongsStrip` from `SectionBar`, put it at the top, wire focus.
4. Scope workspace (viewRange, filtered overlays) to the focused section.
5. Refactor mapping entry points (notes dropdown, CC lane chip) to use the
   unified editor with pre-fill + sectionId.
6. Compact the header bar and overflow menu; move bridge + project folder.
7. Slim the left gutter and per-lane controls into `⋯` popovers.
8. Rename/repurpose triggers sidebar to "Mappings" overview.
9. Keyboard shortcuts + edge cases.
