# Timeline Song-Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Timeline tab so the user works on one song at a time — a compact songs strip switches focus, and the main workspace (ruler, lanes, badges, markers, OSC mappings) scopes to the focused song.

**Architecture:** Introduce a single `focusedSectionId` state in the Timeline page. Derive a `viewRange` from it and thread it through `TimelineCanvas`, overlay filters, and the mapping editor. Add `sectionId` to `OscMapping` with on-load migration. Replace the in-canvas section bar with a new `SongsStrip` above the workspace. Rework mapping entry points on the notes lane and CC lane; demote the triggers sidebar to a read-only overview.

**Tech Stack:** Next.js 16 + React 19 + TypeScript, TailwindCSS, framer-motion. No test framework is present — verification is `npx tsc --noEmit` + manual smoke testing in `pnpm electron:dev`.

**Spec:** `docs/superpowers/specs/2026-04-20-timeline-song-focus-design.md`

---

## Conventions used throughout this plan

- **Verify after each task:** `npx tsc --noEmit` must pass. If the task has UI behavior, run `pnpm electron:dev` and smoke-test the specified flow.
- **No unit tests.** This project has no test framework and the spec explicitly calls for manual testing. Each task ends with a manual smoke step, not a `pytest`/`vitest` run.
- **Commit after each task** with the shown message. Keep commits small and linear.
- **Branch:** stay on the current worktree branch `worktree-20260420-2006`. Do not push.

---

## File plan

**New files**

- `src/components/timeline/songs-strip.tsx` — song-overview strip with focus + drag/rename/resize (takes over `SectionBar`'s interactions).
- `src/lib/osc-mapping-migration.ts` — pure function `migrateOscMappings(recording)` returning a patched recording with `sectionId` backfilled.

**Modified files**

- `src/lib/types.ts` — add `sectionId?: string` to `OscMapping`.
- `src/app/timeline/page.tsx` — add `focusedSectionId` state, run migration on load, render `SongsStrip`, pass focus + range through to canvas and sidebar.
- `src/components/timeline/timeline-canvas.tsx` — accept `focusedSection`, derive `viewRange`, filter overlays, stop rendering in-canvas section bar.
- `src/components/timeline/section-bar.tsx` — **delete** after `SongsStrip` replaces it (its logic is moved, not duplicated).
- `src/components/timeline/timeline-toolbar.tsx` — collapse Save / Save As / Save Project / Load / Import MIDI into a single `File ▾` menu; move bridge + project folder out.
- `src/components/timeline/triggers-sidebar.tsx` — filter by `focusedSectionId`, rename label to "Mappings".
- `src/components/timeline/notes-lane.tsx` — add "Map to OSC…" entry on the note-tag dropdown; render mapping chip when present.
- `src/components/timeline/note-tag-editor.tsx` — surface "Map to OSC…" action.
- `src/components/timeline/continuous-lane.tsx` — replace `OSC` button with `＋ Map` / `→ /address` chip.
- `src/components/timeline/osc-mapping-editor.tsx` — accept `sectionId` + `prefill`, write `sectionId` into saved mapping.
- `src/components/timeline/device-section.tsx` — slim per-lane controls into a `⋯` popover; slimmer device header.
- `src/lib/timeline-util.ts` — add `sectionContainingMs(sections, ms)` helper.

---

## Task 1: Add `sectionId` to OscMapping type

**Files:**
- Modify: `src/lib/types.ts` (the `OscMapping` interface near line 175)

- [ ] **Step 1: Add the optional field**

In `src/lib/types.ts`, inside `export interface OscMapping`, add after `id`:

```ts
  /** Song/section this mapping belongs to. Optional only during migration of
   * legacy recordings; new mappings always set this. */
  sectionId?: string;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add optional sectionId to OscMapping"
```

---

## Task 2: `sectionContainingMs` util

**Files:**
- Modify: `src/lib/timeline-util.ts`

- [ ] **Step 1: Add the helper**

Append to `src/lib/timeline-util.ts`:

```ts
import type { TimelineSection } from "./types";

/** Return the section whose [startMs, endMs) contains `ms`, or null. */
export function sectionContainingMs(
  sections: TimelineSection[] | undefined,
  ms: number,
): TimelineSection | null {
  if (!sections?.length) return null;
  for (const s of sections) {
    if (ms >= s.startMs && ms < s.endMs) return s;
  }
  return null;
}
```

If `TimelineSection` is already imported at the top, reuse the existing import instead of adding a duplicate.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — expected pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/timeline-util.ts
git commit -m "feat(timeline-util): add sectionContainingMs helper"
```

---

## Task 3: OSC-mapping migration module

**Files:**
- Create: `src/lib/osc-mapping-migration.ts`

Purpose: pure function that takes a `Recording` and returns it with every `OscMapping.sectionId` resolved (or left unset for orphans).

Strategy: for each mapping without `sectionId`, find the first recorded event that matches the mapping's `targetType`/`targetId`. Use that event's `tRel` to find the containing section.

- [ ] **Step 1: Create the file**

Create `src/lib/osc-mapping-migration.ts`:

```ts
import type { OscMapping, RecordedEvent, Recording, TimelineSection } from "./types";
import { laneKeyString } from "./types";
import { sectionContainingMs } from "./timeline-util";

/** True if `event` matches the target described by the mapping. */
function eventMatchesMapping(event: RecordedEvent, mapping: OscMapping): boolean {
  if (event.device !== mapping.deviceId) return false;
  const m = event.midi;
  if (mapping.targetType === "noteGroup") {
    // targetId shape: `${pitch}|${velocity}` (velocity may be "any")
    const [pitchStr, velStr] = mapping.targetId.split("|");
    const pitch = Number(pitchStr);
    if (m.type !== "noteOn" && m.type !== "noteOff") return false;
    if (m.note !== pitch) return false;
    if (velStr !== "any" && m.type === "noteOn" && Number(velStr) !== m.velocity) return false;
    return true;
  }
  // lane: targetId is laneKeyString of the lane; match by computed key
  const laneKey = laneKeyString({
    device: event.device,
    kind:
      m.type === "noteOn" || m.type === "noteOff"
        ? "note"
        : m.type === "cc"
        ? "cc"
        : m.type === "programChange"
        ? "program"
        : m.type === "pitchBend"
        ? "pitchBend"
        : m.type === "channelPressure"
        ? "channelPressure"
        : m.type === "polyPressure"
        ? "polyPressure"
        : "note",
    number:
      m.type === "cc"
        ? m.controller
        : m.type === "programChange"
        ? m.program
        : m.type === "noteOn" || m.type === "noteOff"
        ? m.note
        : undefined,
    channel: m.channel,
  });
  return laneKey === mapping.targetId;
}

/** Find the first event matching the mapping; return its tRel, or null. */
function firstMatchingEventTime(
  events: RecordedEvent[],
  mapping: OscMapping,
): number | null {
  for (const ev of events) {
    if (eventMatchesMapping(ev, mapping)) return ev.tRel;
  }
  return null;
}

/**
 * Return the mapping with `sectionId` filled in based on the first matching
 * event's time, or unchanged if already set / no match / no containing section.
 */
function migrateOne(
  mapping: OscMapping,
  events: RecordedEvent[],
  sections: TimelineSection[] | undefined,
): OscMapping {
  if (mapping.sectionId) return mapping;
  const t = firstMatchingEventTime(events, mapping);
  if (t == null) return mapping;
  const section = sectionContainingMs(sections, t);
  if (!section) return mapping;
  return { ...mapping, sectionId: section.id };
}

/**
 * Produce a copy of the recording with legacy OSC mappings migrated to carry
 * a `sectionId`. Mappings whose trigger falls outside every section stay
 * unassigned (orphans) and must be handled by the UI.
 */
export function migrateOscMappings(recording: Recording): Recording {
  const mappings = recording.oscMappings;
  if (!mappings?.length) return recording;
  const needsMigration = mappings.some((m) => !m.sectionId);
  if (!needsMigration) return recording;
  const migrated = mappings.map((m) => migrateOne(m, recording.events, recording.sections));
  return { ...recording, oscMappings: migrated };
}
```

Note: if `laneKeyString` and event `midi` variants use different field names in the actual types, adjust the shape in `eventMatchesMapping` to match. Check `src/lib/types.ts` around lines 100–150 for the exact `midi` union and `laneKeyString` signature before completing this step, and update the code to match.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected pass. If errors, they indicate fields to adjust in `eventMatchesMapping` to match the actual `RecordedEvent` / `laneKeyString` shape.

- [ ] **Step 3: Commit**

```bash
git add src/lib/osc-mapping-migration.ts
git commit -m "feat(timeline): migrate legacy OSC mappings to per-section scope"
```

---

## Task 4: Run migration on recording load

**Files:**
- Modify: `src/app/timeline/page.tsx` (function `applyLoadedRecording`, around lines 190–214)

- [ ] **Step 1: Import migration**

Add to imports at top of `src/app/timeline/page.tsx`:

```ts
import { migrateOscMappings } from "@/lib/osc-mapping-migration";
```

- [ ] **Step 2: Wrap `applyLoadedRecording`'s input**

In `applyLoadedRecording`, replace the first line body `recorder.setLoaded(rec);` with:

```ts
    const migrated = migrateOscMappings(rec);
    recorder.setLoaded(migrated);
```

And change the parameter name usage throughout the function to `migrated` (audio tracks, etc.) — anywhere it reads `rec.audioTracks`, `rec.audio`, it should read `migrated.audioTracks`, `migrated.audio`.

- [ ] **Step 3: Typecheck and manual smoke**

Run: `npx tsc --noEmit` — pass.
Run: `pnpm electron:dev`. Load an existing `.oscrec` recording that has OSC mappings saved before this change. Confirm the app starts without errors. Mappings are now tagged with `sectionId` for events that fall inside a section (verify by `Save As…` and inspecting the JSON).

- [ ] **Step 4: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "feat(timeline): run OSC-mapping migration on recording load"
```

---

## Task 5: Introduce `focusedSectionId` state

**Files:**
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: Add state + derived value**

Near the other `useState` declarations in `TimelinePage`, add:

```ts
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const focusedSection = useMemo(
    () => recorder.recording?.sections?.find((s) => s.id === focusedSectionId) ?? null,
    [recorder.recording?.sections, focusedSectionId],
  );
```

- [ ] **Step 2: Clear focus on important transitions**

Where `recorder.start()` is called inside `startRecording` (direct call and inside the `setConfirmDiscard` continuation), precede it with `setFocusedSectionId(null);`.

In `applyLoadedRecording`, after `recorder.setLoaded(migrated);`, add `setFocusedSectionId(null);`.

Inside `handleSectionsChange`, if `focusedSectionId` is not among the new sections, clear it:

```ts
  const handleSectionsChange = useCallback((sections: Recording["sections"]) => {
    recorder.patchRecording({ sections });
    if (focusedSectionId && !sections?.some((s) => s.id === focusedSectionId)) {
      setFocusedSectionId(null);
    }
  }, [recorder, focusedSectionId]);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` — pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "feat(timeline): add focusedSectionId state on Timeline page"
```

---

## Task 6: Create `SongsStrip` component

**Files:**
- Create: `src/components/timeline/songs-strip.tsx`

This takes over from `section-bar.tsx`. Start by copying its drag/resize/rename logic and adapting the layout to a top strip with: proportional segments, click-to-focus highlight, global playhead marker.

- [ ] **Step 1: Copy `SectionBar` as the starting point**

```bash
cp src/components/timeline/section-bar.tsx src/components/timeline/songs-strip.tsx
```

- [ ] **Step 2: Rewrite the top of the file**

Replace the export and props:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { TimelineSection } from "@/lib/types";

const SECTION_COLORS = [
  "#c7f168", "#68d9f1", "#f1a368", "#f168c7",
  "#68f1a3", "#a368f1", "#f1d968", "#f16868",
];

interface SongsStripProps {
  sections: TimelineSection[];
  focusedSectionId: string | null;
  onFocus: (id: string | null) => void;
  onChange: (sections: TimelineSection[]) => void;
  /** Full recording duration in ms — used to position the global playhead. */
  durationMs: number;
  /** Live playhead ms ref — strip reads it each frame. */
  playheadMsRef: React.MutableRefObject<number>;
}

export function SongsStrip(props: SongsStripProps) {
  // ...
}
```

- [ ] **Step 3: Drive the strip off full-recording coordinates**

Unlike `SectionBar` which uses `viewStartMs`/`viewEndMs`, the strip always
represents the full recording. Replace the old `msToFrac` / `xToMs` helpers
with versions that use `[0, durationMs]`:

```ts
  const msToFrac = (ms: number) => ms / Math.max(1, durationMs);
  const xToMs = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return ((clientX - rect.left) / rect.width) * durationMs;
  };
```

- [ ] **Step 4: Render the segments + playhead**

Inside the returned JSX, render:

```tsx
  const [playheadFrac, setPlayheadFrac] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setPlayheadFrac(props.playheadMsRef.current / Math.max(1, props.durationMs));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [props.durationMs, props.playheadMsRef]);

  return (
    <div className="flex flex-col gap-1 px-1 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">Songs in recording</span>
        <span className="text-[10px] text-gray-600">
          {props.sections.length
            ? `${props.sections.length} song${props.sections.length === 1 ? "" : "s"} · click to focus`
            : "Drag to mark a song"}
        </span>
      </div>

      <div
        ref={trackRef}
        onMouseDown={handleTrackMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="relative h-10 rounded bg-black/40 overflow-hidden select-none"
      >
        {props.sections.map((s) => {
          const left = msToFrac(s.startMs) * 100;
          const width = Math.max(0, msToFrac(s.endMs) - msToFrac(s.startMs)) * 100;
          const focused = s.id === props.focusedSectionId;
          return (
            <div
              key={s.id}
              onClick={(e) => { e.stopPropagation(); props.onFocus(focused ? null : s.id); }}
              onDoubleClick={() => { setEditingId(s.id); setEditingName(s.name); }}
              style={{
                position: "absolute", top: 0, bottom: 0,
                left: `${left}%`, width: `${width}%`,
                background: s.color ?? "#3a3f4a",
                outline: focused ? "2px solid #b48aff" : "none",
                outlineOffset: -2,
                opacity: focused ? 1 : 0.75,
              }}
              className="flex items-center px-1 text-[10px] text-black/80 hover:opacity-100 transition-opacity"
              title={s.name}
            >
              {editingId === s.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => {
                    props.onChange(props.sections.map((x) => x.id === s.id ? { ...x, name: editingName || x.name } : x));
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingId(null); }}
                  className="w-full bg-white/80 text-black text-[10px] px-1 rounded"
                />
              ) : (
                <span className="truncate font-medium">{s.name}</span>
              )}
            </div>
          );
        })}

        {/* global playhead marker */}
        <div
          style={{ left: `${playheadFrac * 100}%` }}
          className="absolute top-0 bottom-0 w-px bg-white/80 pointer-events-none"
        />
      </div>
    </div>
  );
```

Keep the existing drag-create / drag-move / resize-left / resize-right handlers from `section-bar.tsx` — they already operate in ms via `xToMs`, which we've rebound to full-recording coords. Remove the now-unused `viewStartMs`/`viewEndMs`/`leftGutterPx`/`activeSectionId`/`onActivate` props throughout.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit` — pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/timeline/songs-strip.tsx
git commit -m "feat(timeline): add SongsStrip (takes over SectionBar, full-recording scoped)"
```

---

## Task 7: Render `SongsStrip` in Timeline page

**Files:**
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: Import and place it**

Add import:

```ts
import { SongsStrip } from "@/components/timeline/songs-strip";
```

Immediately above the `<div ref={canvasWrapRef} …>` wrapping `<TimelineCanvas …>`, insert:

```tsx
      <SongsStrip
        sections={recorder.recording?.sections ?? []}
        focusedSectionId={focusedSectionId}
        onFocus={setFocusedSectionId}
        onChange={handleSectionsChange}
        durationMs={durationMs}
        playheadMsRef={audio.playheadMsRef}
      />
```

- [ ] **Step 2: Typecheck and smoke**

Run: `npx tsc --noEmit`
Run: `pnpm electron:dev`. Load a recording with sections. Confirm the strip renders, segments are clickable (focus toggle shows the purple outline), and the playhead marker rides across while playing.

- [ ] **Step 3: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "feat(timeline): render SongsStrip above the canvas"
```

---

## Task 8: Scope canvas viewport to focused section

**Files:**
- Modify: `src/components/timeline/timeline-canvas.tsx`
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: Add prop to canvas**

In `TimelineCanvasProps` in `timeline-canvas.tsx`, add:

```ts
  focusedSection: import("@/lib/types").TimelineSection | null;
```

- [ ] **Step 2: Clamp viewport to focused range**

Inside `TimelineCanvas`, after the `viewReducer` is set up, add an effect that resets the viewport whenever the focused section changes:

```ts
  const { focusedSection } = props;
  useEffect(() => {
    if (focusedSection) {
      dispatchView({ type: "set", startMs: focusedSection.startMs, endMs: focusedSection.endMs });
    } else {
      dispatchView({ type: "fit", durationMs: props.recording?.durationMs ?? 1000 });
    }
  }, [focusedSection?.id, focusedSection?.startMs, focusedSection?.endMs, props.recording?.durationMs]);
```

(Adjust to the actual reducer dispatch name used in the file if different — search for `viewReducer` / `useReducer(viewReducer`.)

Also pass `minMs: focusedSection?.startMs ?? 0` and clamp `maxMs: focusedSection?.endMs` through any existing `scrollBy` / `zoom` dispatches so the user cannot pan out of the song when focused.

- [ ] **Step 3: Remove in-canvas section bar rendering**

Inside `timeline-canvas.tsx`, find where `<SectionBar …/>` is rendered. Delete that JSX block and its import. Sections are now only shown in the top strip.

- [ ] **Step 4: Pass prop from the page**

In `src/app/timeline/page.tsx`, in the `<TimelineCanvas …/>` props, add:

```tsx
          focusedSection={focusedSection}
```

- [ ] **Step 5: Typecheck and smoke**

Run: `npx tsc --noEmit`
Run: `pnpm electron:dev`. Click a song in the strip — the main timeline ruler and lanes should clip to that song's range and pan/zoom should be bounded. Click the same song again to unfocus; the full recording should be visible.

- [ ] **Step 6: Commit**

```bash
git add src/components/timeline/timeline-canvas.tsx src/app/timeline/page.tsx
git commit -m "feat(timeline): scope canvas viewport to focused section"
```

---

## Task 9: Filter overlays by focused range

**Files:**
- Modify: `src/components/timeline/timeline-canvas.tsx`

The canvas already receives `badges`, `userMarkers`, `noteTags`, `oscMappings`. With a focused section active, filter each to items within the range before rendering / forwarding to child components.

- [ ] **Step 1: Add filtered memos**

Near the top of the component body, add:

```ts
  const rangeStart = focusedSection?.startMs ?? 0;
  const rangeEnd = focusedSection?.endMs ?? Infinity;
  const visibleBadges = useMemo(
    () => props.badges.filter((b) => b.ms >= rangeStart && b.ms < rangeEnd),
    [props.badges, rangeStart, rangeEnd],
  );
  const visibleMarkers = useMemo(
    () => props.userMarkers.filter((m) => m.ms >= rangeStart && m.ms < rangeEnd),
    [props.userMarkers, rangeStart, rangeEnd],
  );
  const visibleOscMappings = useMemo(
    () => (focusedSection
      ? props.oscMappings.filter((m) => m.sectionId === focusedSection.id)
      : props.oscMappings.filter((m) => !m.sectionId)),
    [props.oscMappings, focusedSection],
  );
```

(`LaneBadge`/`Moment` field names may be `startMs`, `tRel`, or `ms` — check `src/lib/types.ts` and adjust the comparison field accordingly. If a badge is a range, use `b.startMs >= rangeStart && b.startMs < rangeEnd`.)

- [ ] **Step 2: Use them**

Replace references to `props.badges` with `visibleBadges` in every JSX usage inside this file. Same for `props.userMarkers` → `visibleMarkers` and `props.oscMappings` → `visibleOscMappings`.

- [ ] **Step 3: Typecheck + smoke**

Run: `npx tsc --noEmit`.
Run: `pnpm electron:dev`. Focus a song containing badges/markers and switch to a neighboring song — the badges from the first song should disappear. Unfocus — they all reappear.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/timeline-canvas.tsx
git commit -m "feat(timeline): filter badges, markers, mappings to focused section"
```

---

## Task 10: Scope mapping editor to focused section

**Files:**
- Modify: `src/components/timeline/osc-mapping-editor.tsx`

- [ ] **Step 1: Add props**

Add two optional props to the component: `sectionId?: string | null` and `prefill?: Partial<OscMapping>`. Types:

```ts
interface OscMappingEditorProps {
  // ...existing props
  sectionId?: string | null;
  prefill?: Partial<OscMapping>;
}
```

- [ ] **Step 2: Seed state from `prefill`**

Wherever the editor initializes its form state (e.g. `useState(existing ?? defaultMapping)`), merge `prefill` on top of the default for the "new" case:

```ts
  const [draft, setDraft] = useState<OscMapping>(() =>
    existing ?? { ...defaultMapping, ...prefill, id: crypto.randomUUID() }
  );
```

- [ ] **Step 3: Write `sectionId` on save**

In the save handler, set `sectionId` on the draft before calling the parent's `onSave`:

```ts
    const toSave: OscMapping = {
      ...draft,
      sectionId: draft.sectionId ?? sectionId ?? undefined,
    };
    onSave(toSave);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` — pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/osc-mapping-editor.tsx
git commit -m "feat(osc-editor): accept sectionId and prefill for scoped mappings"
```

---

## Task 11: CC lane mapping chip

**Files:**
- Modify: `src/components/timeline/continuous-lane.tsx`
- Modify: `src/components/timeline/device-section.tsx` (wherever `<ContinuousLane hasOscMapping={…} …/>` is rendered, to pass a richer prop)

- [ ] **Step 1: Replace `hasOscMapping` with `mapping`**

In `continuous-lane.tsx`, change the prop:

```ts
  // was: hasOscMapping?: boolean;
  mapping?: OscMapping | null;
  onOpenMapping?: () => void;  // parent opens editor pre-filled
```

Import `OscMapping` from `@/lib/types`.

- [ ] **Step 2: Render the chip**

Find the current `OSC` button JSX (around the existing `hasOscMapping` reference). Replace it with:

```tsx
  {mapping ? (
    <button
      onClick={onOpenMapping}
      title={`Edit OSC mapping → ${mapping.address ?? "(preset)"}`}
      className="ml-1 max-w-[140px] truncate px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent/15 text-accent border border-accent/40 hover:bg-accent/25"
    >
      → {mapping.address ?? mapping.preset}
    </button>
  ) : (
    <button
      onClick={onOpenMapping}
      title="Map this CC to OSC"
      className="ml-1 px-1.5 py-0.5 rounded text-[10px] border border-white/10 text-gray-500 hover:text-white hover:border-accent/40"
    >
      ＋ Map
    </button>
  )}
```

- [ ] **Step 3: Wire parent**

In `device-section.tsx`, at each `<ContinuousLane …/>` rendering, replace `hasOscMapping={…}` with:

```tsx
          mapping={oscMappings.find((m) => m.targetType === "lane" && m.targetId === laneKeyString(laneKey) && (focusedSectionId ? m.sectionId === focusedSectionId : !m.sectionId)) ?? null}
          onOpenMapping={() => onOpenLaneMapping(laneKey)}
```

Add the matching prop to `DeviceSection`'s own props: `focusedSectionId: string | null;` and `onOpenLaneMapping: (laneKey: LaneKey) => void;`. Pipe these down from `TimelineCanvas` and from the page. The `onOpenLaneMapping` handler opens the existing mapping editor with `prefill = { targetType: "lane", targetId: laneKeyString(laneKey), deviceId: laneKey.device, ... }` and `sectionId = focusedSectionId`.

- [ ] **Step 4: Typecheck + smoke**

Run: `npx tsc --noEmit`.
Run: `pnpm electron:dev`. Focus a song, hover a CC lane. If unmapped, click `＋ Map` — editor opens pre-filled. Save it — the lane now shows a green `→ /path` chip scoped to this song.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/continuous-lane.tsx src/components/timeline/device-section.tsx src/components/timeline/timeline-canvas.tsx src/app/timeline/page.tsx
git commit -m "feat(timeline): inline CC lane mapping chip replaces OSC button"
```

---

## Task 12: Notes dropdown "Map to OSC…" entry

**Files:**
- Modify: `src/components/timeline/note-tag-editor.tsx`
- Modify: `src/components/timeline/notes-lane.tsx`

- [ ] **Step 1: Add action to the editor**

In `note-tag-editor.tsx`, add an `onMapToOsc?: () => void` prop and render a new row at the bottom of its menu (above "Cancel"/"Save"):

```tsx
  {onMapToOsc && (
    <button
      type="button"
      onClick={onMapToOsc}
      className="w-full text-left px-3 py-2 text-xs border-t border-white/10 text-accent hover:bg-white/5"
    >
      Map to OSC…
    </button>
  )}
```

- [ ] **Step 2: Wire it from `notes-lane`**

In `notes-lane.tsx`, pass `onMapToOsc={() => onOpenNoteGroupMapping(pitch, velocity)}`. Add `onOpenNoteGroupMapping: (pitch: number, velocity: number | null) => void;` to `NotesLane`'s props. The parent chain (`device-section.tsx` → `timeline-canvas.tsx` → `page.tsx`) forwards the handler.

The page implementation opens the editor with:

```ts
  prefill = {
    targetType: "noteGroup",
    targetId: `${pitch}|${velocity ?? "any"}`,
    deviceId: /* device this lane belongs to */,
  };
  sectionId = focusedSectionId;
```

- [ ] **Step 3: Render mapping chip on note-tag row**

Next to the tag label inside `notes-lane.tsx`, if a matching mapping exists for `(pitch, velocity, focusedSectionId)`, render a small `→ /address` chip (same visual as the CC-lane chip). Click opens the editor pre-filled.

- [ ] **Step 4: Typecheck + smoke**

Run: `npx tsc --noEmit`.
Run: `pnpm electron:dev`. Focus a song, open a note-group's tag editor, click "Map to OSC…", save. The tag row shows the chip. Switch to another song — the chip disappears.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/note-tag-editor.tsx src/components/timeline/notes-lane.tsx src/components/timeline/device-section.tsx src/components/timeline/timeline-canvas.tsx src/app/timeline/page.tsx
git commit -m "feat(timeline): 'Map to OSC' entry + chip on note-tag dropdown"
```

---

## Task 13: Demote triggers sidebar to "Mappings" overview

**Files:**
- Modify: `src/components/timeline/triggers-sidebar.tsx`
- Modify: `src/components/timeline/timeline-canvas.tsx` (pass `focusedSectionId`)
- Modify: `src/components/timeline/timeline-toolbar.tsx` (rename button label)

- [ ] **Step 1: Filter in the sidebar**

In `triggers-sidebar.tsx`, accept a new `focusedSectionId: string | null` prop. Where the list of `oscMappings` is rendered, filter:

```ts
  const visible = focusedSectionId
    ? mappings.filter((m) => m.sectionId === focusedSectionId)
    : mappings.filter((m) => !m.sectionId);
```

Use `visible` instead of the raw `mappings` list. Add a small header count: `"Mappings in this song — N"` when focused, `"Unassigned mappings — N"` otherwise.

- [ ] **Step 2: Rename button**

In `timeline-toolbar.tsx`, change the button label from `"📊 Triggers"` to `"Mappings"`.

- [ ] **Step 3: Pipe `focusedSectionId` down**

Add the prop through `TimelineCanvas` → `TriggersSidebar`. From the page, pass `focusedSectionId={focusedSectionId}`.

- [ ] **Step 4: Typecheck + smoke**

Run: `npx tsc --noEmit`.
Run: `pnpm electron:dev`. Toggle sidebar; list shows only focused-song mappings.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/triggers-sidebar.tsx src/components/timeline/timeline-canvas.tsx src/components/timeline/timeline-toolbar.tsx src/app/timeline/page.tsx
git commit -m "feat(timeline): demote triggers sidebar to per-song Mappings overview"
```

---

## Task 14: Compact toolbar — File ▾ overflow menu

**Files:**
- Modify: `src/components/timeline/timeline-toolbar.tsx`

- [ ] **Step 1: Replace Save / Save As / Save Project / Open with a single File menu**

Delete the individual `Save`, `Save As…`, `Save project`, and `Open ▾` buttons and their JSX blocks. Replace with one dropdown:

```tsx
  const [openFile, setOpenFile] = useState(false);
  const fileRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openFile) return;
    const h = (e: MouseEvent) => { if (!fileRef.current?.contains(e.target as Node)) setOpenFile(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [openFile]);

  // ... inside the toolbar JSX, in place of the four buttons + Open submenu:
  <div ref={fileRef} className="relative">
    <button
      onClick={() => setOpenFile((v) => !v)}
      disabled={!hasRecording && !recording}
      className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:text-white hover:border-accent/40 disabled:opacity-30"
    >
      File ▾
    </button>
    {openFile && (
      <div className="absolute top-full left-0 mt-1 bg-surface border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden min-w-[180px]">
        <FileMenuItem label="Save" onClick={() => { onSave(); setOpenFile(false); }} disabled={!hasRecording} />
        <FileMenuItem label="Save As…" onClick={() => { onSaveAs(); setOpenFile(false); }} disabled={!hasRecording} />
        <FileMenuItem label="Save project" onClick={() => { onSaveProject(); setOpenFile(false); }} disabled={!hasRecording} />
        <div className="h-px bg-white/5" />
        <FileMenuItem label="Load recording…" onClick={() => { onLoad(); setOpenFile(false); }} />
        <FileMenuItem label="Import .mid…" onClick={() => { onImportMidi(); setOpenFile(false); }} />
      </div>
    )}
  </div>
```

At the bottom of the file, add the small helper:

```tsx
function FileMenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
    >
      {label}
    </button>
  );
}
```

Keep Record, Play, time readout, and the `Mappings` button as visible top-level actions.

- [ ] **Step 2: Typecheck + smoke**

Run: `npx tsc --noEmit`.
Run: `pnpm electron:dev`. Toolbar shows: Record, Play, time, File ▾, Mappings. The File menu opens and contains all 5 items.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/timeline-toolbar.tsx
git commit -m "refactor(timeline): collapse file actions into File ▾ overflow menu"
```

---

## Task 15: Move bridge + project folder into a compact header row

**Files:**
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: Rework the header JSX**

Replace the current header block (the `flex items-center justify-between flex-wrap gap-3` container near the top of the return) with a single compact row:

```tsx
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold">Timeline</h2>

        {projectDirInfo && (
          <ProjectFolderDropdown
            info={projectDirInfo}
            found={projectFound}
            onPick={handlePickProjectDir}
          />
        )}

        <button
          onClick={handleToggleBridge}
          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
            bridgeRunning
              ? "bg-red-500/10 text-red-300 border-red-500/30 hover:bg-red-500/20"
              : "bg-white/5 text-gray-400 border-white/10 hover:text-white"
          }`}
          title={bridgeRunning ? `${midiDevices.length} device${midiDevices.length === 1 ? "" : "s"}` : "Bridge stopped"}
        >
          {bridgeRunning ? `● Bridge · ${midiDevices.length}` : "○ Bridge off"}
        </button>

        <div className="flex-1" />

        <RecordingInfoPanel
          recording={recorder.recording}
          recorderState={recorder.state}
          hasUnsaved={recorder.hasUnsaved}
          onRename={handleRename}
        />
      </div>
```

Delete the now-duplicated `{projectDirInfo && <ProjectFolderDropdown …/>}` block further down (it was rendered twice after earlier edits).

- [ ] **Step 2: Typecheck + smoke**

Run: `npx tsc --noEmit`.
Run: `pnpm electron:dev`. Header is one slim row containing title, project folder pill, bridge pill, recording info on the right. Banners (bridge error, I/O error, audio missing) still appear below as before.

- [ ] **Step 3: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "refactor(timeline): compact header row with bridge + folder pills"
```

---

## Task 16: Focus-aware playback seek

**Files:**
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: Wrap `audio.play`**

Define a focus-aware play handler and pass it into `TimelineToolbar` instead of `audio.play`:

```ts
  const handlePlay = useCallback(() => {
    if (focusedSection) {
      const head = audio.playheadMsRef.current;
      if (head < focusedSection.startMs || head >= focusedSection.endMs) {
        handleSeek(focusedSection.startMs);
      }
    }
    audio.play();
  }, [focusedSection, audio, handleSeek]);
```

Change `onPlay={audio.play}` in the `<TimelineToolbar …/>` JSX to `onPlay={handlePlay}`.

- [ ] **Step 2: Typecheck + smoke**

Run: `npx tsc --noEmit`.
Run: `pnpm electron:dev`. Focus a song, seek playhead to before the song, press Play — playback starts at the section's start. Seek to inside the song, press Play — continues from there.

- [ ] **Step 3: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "feat(timeline): focus-aware play seeks into song if out of range"
```

---

## Task 17: Keyboard shortcuts `[` `]` `Esc`

**Files:**
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: Add a keydown listener**

Add alongside the existing Space-key effect:

```ts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const sections = recorder.recording?.sections ?? [];
      if (!sections.length) return;
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const idx = sections.findIndex((s) => s.id === focusedSectionId);
        const next = e.key === "]"
          ? sections[Math.min(sections.length - 1, (idx < 0 ? 0 : idx + 1))]
          : sections[Math.max(0, (idx < 0 ? 0 : idx - 1))];
        setFocusedSectionId(next?.id ?? null);
      } else if (e.key === "Escape" && focusedSectionId) {
        e.preventDefault();
        setFocusedSectionId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recorder.recording?.sections, focusedSectionId]);
```

- [ ] **Step 2: Typecheck + smoke**

Run: `npx tsc --noEmit`.
Run: `pnpm electron:dev`. With sections defined, `]` advances focus, `[` retreats, `Esc` clears.

- [ ] **Step 3: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "feat(timeline): keyboard shortcuts [ ] Esc for song focus"
```

---

## Task 18: Slim left gutter — per-lane `⋯` popover

**Files:**
- Modify: `src/components/timeline/device-section.tsx`

`device-section.tsx` is 903 lines and owns the left gutter content for each lane. Goal: leave the label + live value visible, move per-lane actions (hide lane, suppress analysis entries, rename for devices) into a small `⋯` popover anchored to the row.

- [ ] **Step 1: Extract a `LaneControlsPopover` component in-file**

Near the top of `device-section.tsx` (after imports), add:

```tsx
function LaneControlsPopover({
  actions,
}: {
  actions: Array<{ label: string; onClick: () => void; danger?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-1 text-gray-500 hover:text-white"
        title="Lane options"
      >⋯</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-[180px] bg-surface border border-white/10 rounded shadow-xl">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => { a.onClick(); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 ${a.danger ? "text-red-400" : "text-gray-300 hover:text-white"}`}
            >{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace the existing per-lane button cluster**

Find the lane-label row JSX (search for `onSuppressAnalysis` or `onHiddenLanesChange` usage within a lane header). Replace the cluster of icon buttons with:

```tsx
  <LaneControlsPopover
    actions={[
      { label: "Hide lane", onClick: () => onToggleLaneHidden(laneKey) },
      { label: "Suppress analysis (rhythm)", onClick: () => onSuppressAnalysis(laneKey, "rhythm") },
      { label: "Suppress analysis (dynamic)", onClick: () => onSuppressAnalysis(laneKey, "dynamic") },
      { label: "Suppress analysis (melody)", onClick: () => onSuppressAnalysis(laneKey, "melody") },
    ]}
  />
```

Wrap each lane's label row in `className="group flex items-center …"` so the popover trigger reveals on hover.

Do the same for device headers: keep the name + rename field, move Delete device into a `LaneControlsPopover` with `actions=[{ label: "Rename device…", … }, { label: "Delete device", danger: true, … }]`.

- [ ] **Step 3: Reduce `LEFT_GUTTER`**

In `timeline-canvas.tsx`, change `const LEFT_GUTTER = 220;` to `const LEFT_GUTTER = 140;`. In `src/app/timeline/page.tsx` the top-level `const LEFT_GUTTER = 140;` already matches.

- [ ] **Step 4: Typecheck + smoke**

Run: `npx tsc --noEmit`.
Run: `pnpm electron:dev`. Left gutter is narrower. Hover a lane row — `⋯` button appears; clicking shows the options popover. Device header has its own popover with rename/delete.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/device-section.tsx src/components/timeline/timeline-canvas.tsx
git commit -m "refactor(timeline): slim left gutter with per-lane ⋯ popover"
```

---

## Task 19: Remove the old `section-bar.tsx`

**Files:**
- Delete: `src/components/timeline/section-bar.tsx`
- Modify: any remaining imports

- [ ] **Step 1: Search for leftover imports**

Run: `grep -rn "section-bar" src/`
Expected: no matches, or only inside the file itself. If imports remain, delete them.

- [ ] **Step 2: Delete the file**

```bash
git rm src/components/timeline/section-bar.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` — pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(timeline): remove section-bar, replaced by SongsStrip"
```

---

## Task 20: Orphan mapping surfacing

**Files:**
- Modify: `src/components/timeline/triggers-sidebar.tsx`
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: When unfocused, show orphans with a warning**

In `triggers-sidebar.tsx`, when `focusedSectionId === null` and the filtered list (`visible`) contains mappings without `sectionId`, show a small amber chip beside each: `⚠ outside sections`. Add a small row description above the list: `"These mappings have no song. Extend a song's range to cover their trigger, or delete."`

- [ ] **Step 2: Typecheck + smoke**

Run: `npx tsc --noEmit`.
Run: `pnpm electron:dev`. Load a recording where some mappings fall outside every section. Unfocus and open Mappings drawer — orphans appear with the warning chip.

- [ ] **Step 3: Commit**

```bash
git add src/components/timeline/triggers-sidebar.tsx src/app/timeline/page.tsx
git commit -m "feat(timeline): surface orphan OSC mappings in Mappings drawer"
```

---

## Task 21: End-to-end smoke pass + cleanup

- [ ] **Step 1: Run the full manual test checklist**

Run: `pnpm electron:dev`. Execute each item from the spec's "Testing approach" section:

1. Load a multi-song `.oscrec` with pre-migration mappings → mappings attach to correct sections; orphans flagged.
2. Focus each song → workspace, badges, markers, mappings scope correctly.
3. Create a mapping from notes dropdown and from CC lane → both carry `sectionId === focusedSectionId`.
4. Delete focused section → focus clears.
5. Edit section boundaries while focused → workspace follows.
6. Start recording while focused → focus clears, take captures.
7. Play/pause across song boundaries → seek-to-start behavior works.

- [ ] **Step 2: Fix anything that came up**

Any regressions get their own commit(s) here before finalizing.

- [ ] **Step 3: Final commit (if any fixes were made)**

```bash
git add -A
git commit -m "fix(timeline): smoke-pass fixes for song-focus redesign"
```

---

## Self-review summary

- **Spec coverage:** Every spec section maps to one or more tasks — info architecture (Tasks 7, 15), focus model (Tasks 5, 8, 16, 17), per-song scoping for lanes/overlays/mappings (Tasks 8, 9, 10, 11, 12, 13), migration (Tasks 1, 3, 4), mapping entry points (Tasks 11, 12), triggers sidebar demotion (Task 13), left-gutter cleanup (Task 18), orphan handling (Task 20), shortcuts (Task 17), edge cases (covered throughout + smoke pass Task 21).
- **No placeholders:** every code block is concrete. Where a type field's exact name depends on the codebase (e.g. `badge.ms` vs `badge.startMs`), I flag it inline with a check-and-adjust instruction rather than leaving it TBD.
- **Type consistency:** `focusedSectionId: string | null`, `sectionId?: string`, `SongsStrip`/`LaneControlsPopover` names used consistently across tasks.
- **Frequent commits:** each task ends with a single clear commit.
