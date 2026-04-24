# Note Group Tagging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to tag note groups in the timeline panel with a label and color, supporting both pitch-only (all velocities) and pitch+velocity-specific tags.

**Architecture:** `NoteGroupTag` is stored in `Recording.noteTags[]`. A lookup helper in `timeline-util.ts` resolves the applicable tag per row (exact pitch+velocity match, falling back to pitch-only). `DeviceSection` renders a tag chip or ghost button per note group row and hosts local popover state. `NoteTagEditor` is a fixed-position popover (no full-screen backdrop) with label, color swatches, and a velocity-scope checkbox.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, React

**Note on testing:** This project has no test runner configured. Verification is via `pnpm tsc --noEmit` and manual inspection in the running app (`pnpm dev`).

**Note on spec deviation:** `NoteGroupTag.color` is `string | undefined` (optional, consistent with `LaneBadge`) rather than required `string`. `channel` is omitted from `NoteGroupTag` since note groups are displayed per-device (not per-channel) in the existing UI.

---

### Task 1: Add `NoteGroupTag` type and extend `Recording`

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add the `NoteGroupTag` interface after the `Moment` interface (line ~267)**

Add this block immediately after the closing `}` of the `Moment` interface:

```typescript
/** A user-applied label on a note group (pitch + optional velocity) within a recording. */
export interface NoteGroupTag {
  id: string;
  device: string;
  pitch: number;
  velocity: number | null;  // null = match all velocities of this pitch
  label: string;
  color?: string;            // CSS color; hash-based fallback at render time
}
```

- [ ] **Step 2: Add `noteTags` to the `Recording` interface**

In the `Recording` interface (around line 162), add after the `sections` field:

```typescript
  noteTags?: NoteGroupTag[];
```

The full `Recording` interface should now end with:
```typescript
  badges?: LaneBadge[];
  moments?: Moment[];
  sections?: TimelineSection[];
  noteTags?: NoteGroupTag[];
}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/rense/Projects/osc_tool && pnpm tsc --noEmit`

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add NoteGroupTag + Recording.noteTags"
```

---

### Task 2: Add `findNoteTag` lookup helper

**Files:**
- Modify: `src/lib/timeline-util.ts`

- [ ] **Step 1: Add import for `NoteGroupTag` at the top of `timeline-util.ts`**

The existing import is:
```typescript
import type { LaneKey, LaneMap, NoteSpan, RecordedEvent } from "@/lib/types";
```

Change it to:
```typescript
import type { LaneKey, LaneMap, NoteGroupTag, NoteSpan, RecordedEvent } from "@/lib/types";
```

- [ ] **Step 2: Add the `findNoteTag` function at the end of the file**

```typescript
/**
 * Resolve the NoteGroupTag for a given note group row.
 * Exact pitch+velocity match takes priority; pitch-only (velocity === null) is the fallback.
 */
export function findNoteTag(
  tags: NoteGroupTag[],
  device: string,
  pitch: number,
  velocity: number
): NoteGroupTag | undefined {
  const exact = tags.find(
    (t) => t.device === device && t.pitch === pitch && t.velocity === velocity
  );
  if (exact) return exact;
  return tags.find(
    (t) => t.device === device && t.pitch === pitch && t.velocity === null
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/rense/Projects/osc_tool && pnpm tsc --noEmit`

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/timeline-util.ts
git commit -m "feat(timeline-util): add findNoteTag lookup helper"
```

---

### Task 3: Create `NoteTagEditor` popover component

**Files:**
- Create: `src/components/timeline/note-tag-editor.tsx`

- [ ] **Step 1: Create the file**

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteGroupTag } from "@/lib/types";

const SWATCHES: Array<{ name: string; value: string | undefined }> = [
  { name: "auto", value: undefined },
  { name: "blue", value: "#4a7bff" },
  { name: "green", value: "#7dd87d" },
  { name: "pink", value: "#ff6fa3" },
  { name: "orange", value: "#ffb84d" },
  { name: "purple", value: "#b48bff" },
  { name: "gray", value: "#888" },
];

interface NoteTagEditorProps {
  tag: NoteGroupTag | null;
  device: string;
  pitch: number;
  velocity: number;
  existingLabels: string[];
  anchorRect: DOMRect;
  onSave: (tag: NoteGroupTag) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function NoteTagEditor({
  tag, device, pitch, velocity, existingLabels, anchorRect, onSave, onDelete, onClose,
}: NoteTagEditorProps) {
  const [label, setLabel] = useState(tag?.label ?? "");
  const [color, setColor] = useState<string | undefined>(tag?.color);
  const [allVelocities, setAllVelocities] = useState(tag ? tag.velocity === null : true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const suggestions = existingLabels
    .filter((l) => l.toLowerCase().startsWith(label.toLowerCase()) && l !== label)
    .slice(0, 5);

  const handleSave = () => {
    const trimmed = label.trim().slice(0, 24);
    if (!trimmed) return;
    onSave({
      id: tag?.id ?? crypto.randomUUID(),
      device,
      pitch,
      velocity: allVelocities ? null : velocity,
      label: trimmed,
      color,
    });
  };

  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 320);
  const left = Math.min(anchorRect.left, window.innerWidth - 280);

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 bg-surface-light border border-white/10 rounded-lg p-4 shadow-xl"
      style={{ top, left, width: 272 }}
    >
      <h3 className="text-sm font-semibold mb-3">{tag ? "Edit tag" : "Tag this note group"}</h3>

      <label className="block text-[10px] text-gray-500 mb-1">Label</label>
      <input
        ref={inputRef}
        type="text"
        value={label}
        maxLength={24}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onClose();
        }}
        placeholder="Kick, Snare, Hi-hat…"
        className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-sm focus:outline-none focus:border-accent/50"
      />

      {suggestions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setLabel(s)}
              className="text-[10px] px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded text-gray-400"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <label className="block text-[10px] text-gray-500 mt-3 mb-1">Color</label>
      <div className="flex gap-1.5">
        {SWATCHES.map((s) => (
          <button
            key={s.name}
            onClick={() => setColor(s.value)}
            className={`w-6 h-6 rounded border transition-transform ${
              (s.value ?? null) === (color ?? null) ? "border-white scale-110" : "border-white/20"
            }`}
            style={{ background: s.value ?? "transparent" }}
            title={s.name}
          >
            {s.value === undefined && <span className="text-[10px] text-gray-500">a</span>}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allVelocities}
          onChange={(e) => setAllVelocities(e.target.checked)}
          className="accent-accent"
        />
        <span className="text-[11px] text-gray-400">All velocities of this pitch</span>
      </label>

      <div className="flex justify-between items-center mt-4">
        {onDelete ? (
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-300">
            Delete
          </button>
        ) : (
          <div />
        )}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs border border-white/10 text-gray-300 hover:text-white rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!label.trim()}
            className="px-3 py-1 text-xs bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/rense/Projects/osc_tool && pnpm tsc --noEmit`

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/note-tag-editor.tsx
git commit -m "feat(timeline): add NoteTagEditor popover component"
```

---

### Task 4: Add tag chip to note group rows in `DeviceSection`

**Files:**
- Modify: `src/components/timeline/device-section.tsx`

- [ ] **Step 1: Update imports at the top of `device-section.tsx`**

Replace the type import from `@/lib/types` (add `NoteGroupTag`):
```typescript
import type { LaneAnalysis, LaneBadge, LaneKey, LaneMap, NoteGroupTag, NoteSpan, RecordedEvent, MidiMappingRule } from "@/lib/types";
```

Replace the existing `timeline-util` import (add `findNoteTag`):
```typescript
import { midiNoteName, findNoteTag } from "@/lib/timeline-util";
```

Add a new import for the editor component (after the `timeline-util` import):
```typescript
import { NoteTagEditor } from "./note-tag-editor";
```

- [ ] **Step 2: Add three new props to `DeviceSectionProps`**

After `onToggleNoteGroup?` (around line 38), add:
```typescript
  noteTags?: NoteGroupTag[];
  onSaveNoteTag?: (tag: NoteGroupTag) => void;
  onDeleteNoteTag?: (id: string) => void;
```

- [ ] **Step 3: Destructure the new props in the `DeviceSection` function body**

In the destructuring block (around line 79), add after `onToggleNoteGroup`:
```typescript
    noteTags = [], onSaveNoteTag, onDeleteNoteTag,
```

- [ ] **Step 4: Add local state for the tag editor popover**

After the `[lanesOpen, setLanesOpen]` state declaration (around line 113), add:
```typescript
  const [tagEditor, setTagEditor] = useState<{
    pitch: number;
    velocity: number;
    anchorRect: DOMRect;
  } | null>(null);
```

- [ ] **Step 5: Add a `tagColor` module-level helper at the bottom of the file (after `laneLabelShort`)**

Add after the `laneLabelShort` function:
```typescript
function tagColor(tag: NoteGroupTag): string {
  if (tag.color) return tag.color;
  let h = 0;
  for (let i = 0; i < tag.label.length; i++) h = (h * 31 + tag.label.charCodeAt(i)) & 0xffffff;
  return `hsl(${h % 360},55%,65%)`;
}
```

- [ ] **Step 6: Replace the note group row content with tag chip support**

The existing note group row JSX (inside the `panelOpen && allGroups.length > 0` block, around lines 211-246) renders a gutter with toggle/pitch/velocity and a track area with just a count. Replace the track area `<div>` and add a tag chip to the gutter:

Replace the entire `.map(({ pitch, velocity, count }) => {` block with:

```tsx
          {allGroups.map(({ pitch, velocity, count }) => {
            const hidden = hiddenNoteKeys?.has(`${pitch}|${velocity}`) ?? false;
            const tag = findNoteTag(noteTags, device, pitch, velocity);
            return (
              <div
                key={`${pitch}|${velocity}`}
                className="flex items-center border-t border-white/[0.03] first:border-t-0 group/row"
                style={{ height: 24 }}
              >
                {/* Gutter */}
                <div
                  className="flex items-center gap-2 px-3 border-r border-white/5 h-full shrink-0"
                  style={{ width: leftGutterPx }}
                >
                  <button
                    onClick={() => onToggleNoteGroup?.(pitch, velocity)}
                    className={`text-[11px] leading-none transition-colors ${
                      hidden ? "text-gray-600 hover:text-gray-300" : "text-accent hover:text-white"
                    }`}
                    title={hidden ? "Show" : "Hide"}
                  >
                    {hidden ? "○" : "●"}
                  </button>
                  <span className={`font-mono text-[10px] ${hidden ? "text-gray-600" : "text-gray-300"}`}>
                    {midiNoteName(pitch)}
                  </span>
                  <span className="text-gray-700 text-[10px]">#{pitch}</span>
                  <span className="text-gray-600 text-[10px]">v{velocity}</span>
                </div>
                {/* Track area */}
                <div className="flex-1 flex items-center justify-between px-3">
                  <span className="text-[10px] text-gray-700">{count}×</span>
                  {tag ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTagEditor({ pitch, velocity, anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-white/10 hover:border-white/20 transition-colors"
                      style={{ color: tagColor(tag), borderColor: `${tagColor(tag)}44` }}
                    >
                      <span>{tag.label}</span>
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTagEditor({ pitch, velocity, anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                      }}
                      className="opacity-0 group-hover/row:opacity-100 text-[10px] text-gray-600 hover:text-gray-400 transition-all px-1.5 py-0.5 rounded border border-white/5 hover:border-white/15"
                    >
                      + tag
                    </button>
                  )}
                </div>
              </div>
            );
          })}
```

- [ ] **Step 7: Render the `NoteTagEditor` popover at the bottom of the component's return JSX**

Just before the final closing `</div>` of the `DeviceSection` return (the one that wraps the whole component), add:

```tsx
      {tagEditor && (
        <NoteTagEditor
          tag={findNoteTag(noteTags, device, tagEditor.pitch, tagEditor.velocity) ?? null}
          device={device}
          pitch={tagEditor.pitch}
          velocity={tagEditor.velocity}
          existingLabels={[...new Set(noteTags.map((t) => t.label))]}
          anchorRect={tagEditor.anchorRect}
          onSave={(tag) => {
            onSaveNoteTag?.(tag);
            setTagEditor(null);
          }}
          onDelete={
            findNoteTag(noteTags, device, tagEditor.pitch, tagEditor.velocity)
              ? () => {
                  const existing = findNoteTag(noteTags, device, tagEditor.pitch, tagEditor.velocity);
                  if (existing) onDeleteNoteTag?.(existing.id);
                  setTagEditor(null);
                }
              : undefined
          }
          onClose={() => setTagEditor(null)}
        />
      )}
```

- [ ] **Step 8: Type-check**

Run: `cd /Users/rense/Projects/osc_tool && pnpm tsc --noEmit`

Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/components/timeline/device-section.tsx
git commit -m "feat(device-section): add note group tag chip and editor popover"
```

---

### Task 5: Thread `noteTags` props through `TimelineCanvas`

**Files:**
- Modify: `src/components/timeline/timeline-canvas.tsx`

- [ ] **Step 1: Add `NoteGroupTag` to the type import**

Find the existing type import from `@/lib/types` (line 4):
```typescript
import type { LaneAnalysis, LaneBadge, LaneMap, MidiMappingRule, Moment, NoteSpan, RecordedEvent, Recording, RedundancyPair, TimelineSection } from "@/lib/types";
```

Add `NoteGroupTag`:
```typescript
import type { LaneAnalysis, LaneBadge, LaneMap, MidiMappingRule, Moment, NoteGroupTag, NoteSpan, RecordedEvent, Recording, RedundancyPair, TimelineSection } from "@/lib/types";
```

- [ ] **Step 2: Add three props to `TimelineCanvasProps`**

After `onMarkersChange` (the last prop, around line 103), add:
```typescript
  noteTags: NoteGroupTag[];
  onSaveNoteTag: (tag: NoteGroupTag) => void;
  onDeleteNoteTag: (id: string) => void;
```

- [ ] **Step 3: Destructure the new props in the `TimelineCanvas` function body**

Find the destructuring block (around line 107). Add `noteTags, onSaveNoteTag, onDeleteNoteTag` to the destructured variables.

- [ ] **Step 4: Pass the new props to each `DeviceSection` render**

Find the `<DeviceSection` render (around line 499). After the `onToggleNoteGroup` prop, add:
```tsx
          noteTags={noteTags}
          onSaveNoteTag={onSaveNoteTag}
          onDeleteNoteTag={onDeleteNoteTag}
```

- [ ] **Step 5: Type-check**

Run: `cd /Users/rense/Projects/osc_tool && pnpm tsc --noEmit`

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/components/timeline/timeline-canvas.tsx
git commit -m "feat(timeline-canvas): thread noteTags props to DeviceSection"
```

---

### Task 6: Wire state and callbacks in the timeline page

**Files:**
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: Add `NoteGroupTag` to the type import**

Find the existing type import from `@/lib/types` (line 14):
```typescript
import type { LaneBadge, LaneMap, Moment, NoteSpan, Recording } from "@/lib/types";
```

Add `NoteGroupTag`:
```typescript
import type { LaneBadge, LaneMap, Moment, NoteGroupTag, NoteSpan, Recording } from "@/lib/types";
```

- [ ] **Step 2: Derive `noteTags` from the recording**

After the `existingBadges` line (around line 299), add:
```typescript
  const noteTags = recorder.recording?.noteTags ?? [];
```

- [ ] **Step 3: Add `saveNoteTag` callback**

After the `deleteBadge` callback (around line 314), add:
```typescript
  const saveNoteTag = useCallback((tag: NoteGroupTag) => {
    const rec = recorder.recording;
    if (!rec) return;
    const filtered = (rec.noteTags ?? []).filter((t) => t.id !== tag.id);
    recorder.patchRecording({ noteTags: [...filtered, tag] });
  }, [recorder]);

  const deleteNoteTag = useCallback((id: string) => {
    const rec = recorder.recording;
    if (!rec) return;
    recorder.patchRecording({ noteTags: (rec.noteTags ?? []).filter((t) => t.id !== id) });
  }, [recorder]);
```

- [ ] **Step 4: Pass the new props to `<TimelineCanvas>`**

Find the `<TimelineCanvas` render in the return JSX. After the `onMarkersChange` prop, add:
```tsx
          noteTags={noteTags}
          onSaveNoteTag={saveNoteTag}
          onDeleteNoteTag={deleteNoteTag}
```

- [ ] **Step 5: Type-check**

Run: `cd /Users/rense/Projects/osc_tool && pnpm tsc --noEmit`

Expected: no errors

- [ ] **Step 6: Manual smoke test**

Run `pnpm dev`, open the Timeline page, load or record something with notes:
- Open the "Notes" panel on a device header
- Hover a note group row → ghost "+ tag" button should appear
- Click "+ tag" → NoteTagEditor popover should open with label input, color swatches, "All velocities" checkbox
- Type a label, pick a color, save → colored chip should appear on the row
- For a drum device: check "All velocities of this pitch", save → all velocity rows for that pitch show the same chip
- Click the chip → editor opens with existing tag pre-filled
- Delete the tag → chip disappears
- Save and reload the recording → tags persist

- [ ] **Step 7: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "feat(timeline): wire note tag state and callbacks"
```
