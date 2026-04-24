# Timeline Interactions & Audio Relink Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three independent fixes: (1) require double-click to add markers so accidental creation stops; (2) make the orange playhead draggable so users can scrub position; (3) fix the audio relink bug where relinking one file discards the remaining unlinked files.

**Architecture:** Marker change is a one-liner in `marker-lane.tsx`. Playhead drag adds a transparent hit-area div over the existing line in `timeline-canvas.tsx` and stores a `viewRef` to avoid stale closures. Audio relink root cause: `syncAudioTracksToRecording` in `page.tsx` maps only loaded tracks back to the recording, dropping unloaded ones every time `audio.tracks` changes. Fix merges loaded data into existing `audioTracks` instead of replacing.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

### Task 1: Double-click to add markers

**Files:**
- Modify: `src/components/timeline/marker-lane.tsx:94-98`

Currently a single click anywhere on the marker track adds a marker. Change to double-click.

- [ ] **Step 1: Change `onClick` to `onDoubleClick` on the track div**

In `src/components/timeline/marker-lane.tsx`, update the track `<div>` (around line 94–98):

```tsx
{/* Track */}
<div
  ref={trackRef}
  className="relative flex-1 overflow-visible cursor-crosshair"
  onDoubleClick={handleTrackClick}
>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/timeline/marker-lane.tsx
git commit -m "fix(timeline): require double-click to add markers"
```

---

### Task 2: Draggable playhead

**Files:**
- Modify: `src/components/timeline/timeline-canvas.tsx:137,768-773`

The playhead element (line 768) is `pointer-events-none`. We need to:
1. Add a `viewRef` that stays current (avoids stale closure in drag handlers).
2. Replace the playhead div with a wider transparent wrapper that handles `onMouseDown` for drag, containing the visible 1px line and triangle.
3. Use `data-no-pan` so the existing pan handler ignores it (line 335 already skips `[data-no-pan]`).

- [ ] **Step 1: Add `viewRef` just below the `view` declaration**

In `src/components/timeline/timeline-canvas.tsx`, find where `view` is declared via `useReducer` (around line 130) and add directly after it:

```typescript
const viewRef = useRef(view);
viewRef.current = view; // kept current on every render, no useEffect needed
```

- [ ] **Step 2: Replace the playhead element**

Find the playhead div at line 768 (search for `ref={playheadElRef}`) and replace the entire element:

```tsx
{/* Playhead — wide transparent hit area for drag; inner 1px line is purely visual */}
<div
  ref={playheadElRef}
  data-no-pan
  className="absolute top-0 cursor-grab active:cursor-grabbing"
  style={{ width: 16, marginLeft: -8, height: 10000, zIndex: 30, display: "none" }}
  onMouseDown={(e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onMove = (ev: MouseEvent) => {
      const rect = wrap.getBoundingClientRect();
      const trackWidth = rect.width - LEFT_GUTTER;
      if (trackWidth <= 0) return;
      const x = ev.clientX - rect.left - LEFT_GUTTER;
      const v = viewRef.current;
      const span = v.endMs - v.startMs;
      const ms = v.startMs + Math.max(0, Math.min(1, x / trackWidth)) * span;
      props.onSeek(ms);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }}
>
  {/* Visible 1px orange line */}
  <div
    className="absolute top-0 left-1/2 w-px bg-orange-400/80 pointer-events-none"
    style={{ height: 10000, transform: "translateX(-50%)" }}
  />
  {/* Triangle handle at top */}
  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-2 bg-orange-400 pointer-events-none"
    style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
  />
</div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/timeline-canvas.tsx
git commit -m "feat(timeline): draggable playhead for scrubbing"
```

---

### Task 3: Fix audio relink dropping remaining unlinked files

**Files:**
- Modify: `src/app/timeline/page.tsx:191-199` (`syncAudioTracksToRecording`)

**Root cause:** `syncAudioTracksToRecording` (line 191) is called by a `useEffect` that watches `audio.tracks` (line 407). When `handleRelinkAudio` calls `audio.loadTrack(trackId, ...)`, `audio.tracks` gains the newly linked track — triggering the effect. `syncAudioTracksToRecording` then sets `recording.audioTracks = audio.tracks.map(...)`, which contains ONLY loaded tracks. All still-missing tracks are wiped from the recording, so the missing-files banner disappears.

**Fix:** Merge loaded track data into the existing `recording.audioTracks` instead of replacing it. Tracks not yet loaded keep their existing metadata (filename etc.) so they stay visible in the banner.

- [ ] **Step 1: Replace `syncAudioTracksToRecording`**

In `src/app/timeline/page.tsx`, replace lines 190–199:

```typescript
/** Persist current audio.tracks to recording, preserving any unloaded tracks. */
const syncAudioTracksToRecording = useCallback(() => {
  if (!recorder.recording) return;
  const loadedMap = new Map(audio.tracks.map((t) => [t.id, t]));
  const existing = recorder.recording.audioTracks ?? [];
  if (existing.length === 0) {
    // First load — just write whatever is loaded
    recorder.patchRecording({
      audioTracks: audio.tracks.map((t) => ({ id: t.id, filePath: t.filePath, offsetMs: t.offsetMs })),
    });
    return;
  }
  // Merge: update loaded tracks' data, keep unloaded tracks unchanged
  recorder.patchRecording({
    audioTracks: existing.map((t) => {
      const loaded = loadedMap.get(t.id);
      return loaded ? { id: loaded.id, filePath: loaded.filePath, offsetMs: loaded.offsetMs } : t;
    }),
  });
}, [audio.tracks, recorder]);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Manual test**

Open a recording with 2+ missing audio files. Click "Relink…" on the first file, pick a file. Verify:
- The first file disappears from the missing list.
- The second file is **still shown** in the missing list.
- Click "Relink…" on the second file, pick a file. Both are now loaded.

- [ ] **Step 4: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "fix(timeline): preserve unlinked audio files when relinking one at a time"
```
