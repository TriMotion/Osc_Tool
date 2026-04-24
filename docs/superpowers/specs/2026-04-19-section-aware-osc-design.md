# Section-Aware OSC Mappings Design

## Goal

All OSC mappings are linked to a timeline section. The active section defaults in the OSC editor. Chips in the note group panel are positioned at their section's start time, creating a visual timeline of OSC triggers.

## Architecture

Three coordinated changes across three files:

1. **`OscMappingEditor`** — section selector visible for all presets; only Unreal uses it in the address.
2. **`DeviceSection`** — receives active section name, passes it to editor; chip layout becomes position-aware.
3. **`TimelineCanvas`** — threads `activeSection?.name` down as a new prop.

No type changes required — `sectionName` already exists on `OscMapping` and is optional.

---

## Part 1: Section field for all presets

**File:** `src/components/timeline/osc-mapping-editor.tsx`

Move the section `<select>` / `<input>` block out of the `preset === "unreal"` guard. It renders for all presets. The Unreal-specific fields (`unrealType`, `unrealName`) remain gated behind `preset === "unreal"`. The address preview and `resolveOscAddress` are unchanged — `sectionName` only enters the Unreal address.

---

## Part 2: Active section as default sectionName

**Files:** `src/components/timeline/timeline-canvas.tsx`, `src/components/timeline/device-section.tsx`, `src/components/timeline/osc-mapping-editor.tsx`

`TimelineCanvas` already computes `activeSection` (the resolved `TimelineSection | null`). Thread `activeSectionName={activeSection?.name}` as a new optional prop into `DeviceSection`, then into `OscMappingEditor`.

In `OscMappingEditor`, replace the `sectionName` initial state:

```ts
// before
const [sectionName, setSectionName] = useState(editingMapping?.sectionName ?? sections[0]?.name ?? "");

// after
const [sectionName, setSectionName] = useState(
  editingMapping?.sectionName ?? defaultSectionName ?? sections[0]?.name ?? ""
);
```

Where `defaultSectionName` is the new prop (type `string | undefined`). When no section is active, behavior is unchanged.

---

## Part 3: Chips positioned at section start

**File:** `src/components/timeline/device-section.tsx`

The note group panel track area (the right-hand flex div in each row) becomes a `relative overflow-hidden` container at a fixed height.

**Layout rules:**

- Chips are grouped by `sectionName`. Each group is an `absolute` `inline-flex` div positioned at:
  ```
  left: clamp(0%, (section.startMs - viewStartMs) / (viewEndMs - viewStartMs) * 100%, 100%)
  ```
  where `section` is looked up from the `sections` array by `sectionName`.
- Chips with no `sectionName`, or a name that doesn't match any section, fall back to `left: 0`.
- Multiple chips in the same group are laid out side-by-side (flex row) starting from that x position.
- The `+ OSC` button is absolutely positioned at `left: 0`, visible on row hover, always reachable.
- The count badge (`N×`) moves from the track area into the gutter, appended after the velocity label.

**Overflow:** chips may overflow the right edge if a section is near the end of the view. They must not overlap the gutter — the container starts after the gutter (already the case since it is `flex-1`).

---

## Data flow summary

```
TimelineCanvas
  activeSection?.name → activeSectionName prop
    → DeviceSection (activeSectionName prop)
      → OscMappingEditor (defaultSectionName prop)
        → sectionName initial state
      → note group row track area (uses sections + viewStartMs/viewEndMs already in scope)
```

---

## What does NOT change

- `OscMapping` type — no fields added.
- `resolveOscAddress` — sectionName continues to only affect Unreal addresses.
- Resolume column/clip fields, argType, trigger — untouched.
- The gutter width and lane heights — unchanged.
