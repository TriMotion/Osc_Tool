# Note Group Tagging — Design Spec

**Date:** 2026-04-19  
**Branch:** feat/trigger-discovery  
**Status:** Approved

---

## Overview

Allow users to tag individual note groups in the timeline with a label and color. Tags serve as named roles (e.g. "Kick", "Snare", "Hi-hat") that can later drive OSC address routing in the Live Tab.

---

## Data Model

### New type: `NoteGroupTag` (in `src/lib/types.ts`)

```typescript
interface NoteGroupTag {
  id: string           // uuid
  device: string
  channel: number
  pitch: number
  velocity: number | null  // null = match all velocities of this pitch
  label: string
  color: string        // CSS color
}
```

### Recording extension (in `src/lib/types.ts`)

```typescript
// Added to Recording:
noteTags?: NoteGroupTag[]
```

Tags are per-recording only — they do not persist across recordings.

### Lookup helper (in `src/lib/timeline-util.ts`)

`findNoteTag(tags: NoteGroupTag[], device: string, channel: number, pitch: number, velocity: number): NoteGroupTag | undefined`

- First checks for exact `pitch + velocity` match
- Falls back to pitch-only match (`velocity === null`)
- Allows coexistence: a pitch-only tag and a pitch+velocity tag on the same pitch are distinct

---

## UI Components

### Note group row (in `src/components/timeline/device-section.tsx`)

Each row in the note group panel gains a tag chip on the right side:

- **Tagged:** colored pill showing the label — click to open `NoteTagEditor`
- **Untagged:** faint `+ tag` ghost button, visible on row hover only
- When a pitch-only tag covers multiple velocity rows, all rows show the same chip; editing from any row opens the same tag

### New component: `NoteTagEditor`

Inline popover anchored to the chip/button (not a full modal). Contains:

- **Label input** — text field with autocomplete from existing tag labels in the current recording
- **Color swatches** — 7 presets matching `BadgeEditorModal` + auto hash-based fallback
- **"All velocities of this pitch" checkbox** — when checked, saves `velocity: null`; when unchecked, saves the specific velocity of the clicked row
- **Save / Delete / Cancel** actions

### Props added to `DeviceSection`

```typescript
noteTags: NoteGroupTag[]
onSaveNoteTag: (tag: NoteGroupTag) => void
onDeleteNoteTag: (id: string) => void
```

The parent timeline page owns tag state and passes it down, consistent with the existing badge pattern.

---

## Data Flow

1. **Open editor** — clicking chip or `+ tag` calls `onRequestEditTag(device, channel, pitch, velocity)` on `DeviceSection`. Parent resolves existing tag via lookup helper (exact match first, pitch-only fallback) and passes it as `initialTag` into `NoteTagEditor` (undefined = new tag).

2. **Save** — `NoteTagEditor` calls `onSaveNoteTag(tag)`. Parent upserts by `id`: append if new, replace if existing. "All velocities" checkbox sets `velocity: null`.

3. **Delete** — `onDeleteNoteTag(id)` filters the tag from `noteTags[]`.

4. **Render** — `DeviceSection` calls the lookup helper per row to resolve the applicable tag. Rows sharing a pitch-only tag render identically.

5. **Persistence** — `noteTags` serializes with the rest of `Recording` — no separate save path needed.

---

## Out of Scope

- Tags are not shared across recordings
- No tag-based filtering or OSC routing in this feature (future: Live Tab)
- No bulk-tagging UI
