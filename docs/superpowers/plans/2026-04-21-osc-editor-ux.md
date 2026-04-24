# OSC Editor UX & Lane Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the OSC mapping editor UX — make the `+ OSC` button easier to press, close the editor after adding, fix address display for non-custom presets, and always show mapped OSC addresses on lane labels.

**Architecture:** All changes are confined to two files (`osc-mapping-editor.tsx`, `device-section.tsx`). No new state or hooks needed. `oscLabelFor` gets extended to check `oscMappings` in addition to `mappingRules`, and the editor dismisses itself after `onAdd` fires.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

### Task 1: Close the OSC mapping editor after adding

**Files:**
- Modify: `src/components/timeline/osc-mapping-editor.tsx:64-75`

The `handleAdd` function calls `onAdd(mapping)` but never calls `onClose()`. The editor stays open with no feedback, so users think the add did nothing.

- [ ] **Step 1: Add `onClose()` call in `handleAdd`**

In `src/components/timeline/osc-mapping-editor.tsx`, replace the `handleAdd` function (lines 64–75):

```typescript
const handleAdd = () => {
  if (!endpointId) return;
  onAdd({
    id: crypto.randomUUID(),
    targetType, targetId, deviceId, endpointId,
    preset, trigger, argType, address,
    sectionName,
    unrealType, unrealName: unrealName || "param",
    resolumeMode, resolumeColumn, resolumeLayer, resolumeClip,
    sectionId: sectionId ?? undefined,
  });
  onClose();
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/timeline/osc-mapping-editor.tsx
git commit -m "fix(osc-editor): close editor after adding a mapping"
```

---

### Task 2: Make the `+ OSC` button always visible and easier to press

**Files:**
- Modify: `src/components/timeline/device-section.tsx:687-699`

The `+ OSC` button is `opacity-0` by default (invisible until hover) and uses tiny `py-px text-[9px]` sizing making it difficult to click. It should be dimly visible at rest so users know it exists, and use a larger hit area.

- [ ] **Step 1: Update button className**

In `src/components/timeline/device-section.tsx`, replace the `+ OSC` button className (around line 696):

```tsx
<button
  onClick={(e) => {
    e.stopPropagation();
    setOscEditor({
      targetType: "noteGroup",
      targetId: `${pitch}|${tagVelocity}`,
      anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
    });
  }}
  className="opacity-30 group-hover/row:opacity-100 text-[10px] text-gray-500 hover:text-accent transition-all px-2 py-0.5 rounded border border-white/5 hover:border-accent/30 leading-none"
>
  + OSC
</button>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/timeline/device-section.tsx
git commit -m "fix(osc-editor): make + OSC button always visible with larger hit area"
```

---

### Task 3: Fix existing mapping address display for non-custom presets

**Files:**
- Modify: `src/components/timeline/device-section.tsx:664-685`

The gutter chip for existing note group mappings displays `noteMapping.address` directly. For `resolume` and `unreal` presets, `address` is `undefined` — so the chip shows nothing. Should use `resolveOscAddress(noteMapping, deviceAliases)` instead, which handles all presets.

- [ ] **Step 1: Fix chip title and label**

In `src/components/timeline/device-section.tsx`, replace the existing mapping chip (lines 664–685). The `resolveOscAddress` import is already at line 7.

```tsx
return noteMapping ? (
  <button
    onClick={(e) => {
      e.stopPropagation();
      setOscEditor({
        targetType: "noteGroup",
        targetId: `${pitch}|${velocity ?? "any"}`,
        anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
        editingMapping: noteMapping,
      });
    }}
    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border shrink-0 transition-colors"
    style={{
      borderColor: "rgba(142,203,255,0.2)",
      background: "rgba(142,203,255,0.05)",
      color: "rgba(142,203,255,0.8)",
    }}
    title={resolveOscAddress(noteMapping, deviceAliases)}
  >
    <span className="font-mono">→ {resolveOscAddress(noteMapping, deviceAliases)}</span>
  </button>
) : null;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/timeline/device-section.tsx
git commit -m "fix(osc-editor): show resolved OSC address on note group mapping chip"
```

---

### Task 4: Always show mapped OSC address on lane label

**Files:**
- Modify: `src/components/timeline/device-section.tsx:112-134` (oscLabelFor function)

`oscLabelFor` currently only reads `MidiMappingRule[]` (live MIDI bridge). Timeline lanes also have `OscMapping[]` (playback mappings) — those addresses should show as the sublabel too. Prefer the `OscMapping` address if present; fall back to the MIDI rule.

- [ ] **Step 1: Extend `oscLabelFor` signature and logic**

In `src/components/timeline/device-section.tsx`, replace the `oscLabelFor` function (lines 112–134):

```typescript
function oscLabelFor(
  key: LaneKey,
  rules: MidiMappingRule[],
  oscMappings: OscMapping[],
  deviceAliases?: Record<string, string>,
): string | undefined {
  const keyStr = laneKeyString(key);
  // Check playback OSC mappings first
  const om = oscMappings.find((m) => m.targetType === "lane" && m.targetId === keyStr);
  if (om) return resolveOscAddress(om, deviceAliases);
  // Fall back to live MIDI bridge rule
  const rule = rules.find((r) => {
    if (r.channel !== undefined && key.kind !== "notes" && "channel" in key && r.channel !== key.channel) return false;
    if (key.kind === "cc") return r.type === "cc" && r.data1 === key.cc;
    if (key.kind === "pitch") return r.type === "pitchbend";
    if (key.kind === "aftertouch") return r.type === "aftertouch";
    return false;
  });
  return rule?.address;
}
```

Note: keep the existing filtering logic inside the rule fallback — just copy whatever was there before if it differs from the above.

- [ ] **Step 2: Update the call site**

Find the call to `oscLabelFor(entry.key, mappingRules)` (around line 498) and update it to:

```typescript
const osc = oscLabelFor(entry.key, mappingRules, oscMappings, deviceAliases);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `oscLabelFor`.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/device-section.tsx
git commit -m "feat(timeline): always show mapped OSC address on lane sublabel"
```
