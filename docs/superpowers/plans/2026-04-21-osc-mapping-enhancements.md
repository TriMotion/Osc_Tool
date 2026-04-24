# OSC Mapping Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new OSC mapping features: (1) velocity filter — only fire a note-group mapping when the note velocity meets a condition (all / above threshold / min–max range / exact value); (2) Resolume random clip range — when in clip mode, pick a random clip number between a min and max on each trigger instead of always the same clip.

**Architecture:** Both features add optional fields to `OscMapping` in `types.ts`. Velocity filtering is applied in `matchesMapping()` in `osc-mapping.ts`. Random clip is applied in `resolveOscAddress()`. The editor gets new UI sections for each feature. Default for both is the existing behavior (no filter = all velocities, no range = fixed clip).

**Tech Stack:** React, TypeScript, Tailwind CSS

---

### Task 1: Add `velocityFilter` and `resolumeClipMax` to `OscMapping` type

**Files:**
- Modify: `src/lib/types.ts:175-199`

- [ ] **Step 1: Add new fields to `OscMapping`**

In `src/lib/types.ts`, replace the `OscMapping` interface (lines 175–199):

```typescript
export interface OscMapping {
  id: string;
  sectionId?: string;
  targetType: "noteGroup" | "lane";
  targetId: string;
  deviceId: string;
  endpointId: string;
  extraEndpointIds?: string[];
  preset: OscPreset;
  trigger: OscTrigger;
  argType: "f" | "i";
  address?: string;
  sectionName?: string;
  unrealType?: "parameter" | "trigger";
  unrealName?: string;
  resolumeMode?: "column" | "clip";
  resolumeColumn?: number;
  resolumeLayer?: number;
  resolumeClip?: number;
  /** Random clip range for Resolume clip mode. If set, clip is randomised between resolumeClip and resolumeClipMax on each trigger. */
  resolumeClipMax?: number;
  /** Velocity filter — only for noteGroup targets. Undefined / mode "all" means always fire. */
  velocityFilter?: {
    mode: "all" | "above" | "range" | "exact";
    min?: number;   // 0–127: threshold for "above", lower bound for "range"
    max?: number;   // 0–127: upper bound for "range"
    exact?: number; // 0–127: for "exact"
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add velocityFilter and resolumeClipMax to OscMapping"
```

---

### Task 2: Apply velocity filter in `matchesMapping`

**Files:**
- Modify: `src/lib/osc-mapping.ts:45-70`

Currently `matchesMapping` for `noteGroup` only checks pitch. We add velocity filter evaluation after pitch confirmation.

- [ ] **Step 1: Update `matchesMapping` for noteGroup note-on**

In `src/lib/osc-mapping.ts`, replace the `matchesMapping` function (lines 45–70):

```typescript
export function matchesMapping(evt: RecordedEvent, mapping: OscMapping): boolean {
  if (evt.midi.deviceName !== mapping.deviceId) return false;

  if (mapping.targetType === "noteGroup") {
    const [pitchStr] = mapping.targetId.split("|");
    const pitch = parseInt(pitchStr, 10);

    if ((mapping.trigger === "on" || mapping.trigger === "both") && evt.midi.type === "noteon") {
      if (evt.midi.data1 !== pitch) return false;
      const vf = mapping.velocityFilter;
      if (vf && vf.mode !== "all") {
        const vel = evt.midi.data2;
        if (vf.mode === "above"  && vf.min  !== undefined && vel < vf.min)              return false;
        if (vf.mode === "range"  && vf.min  !== undefined && vf.max !== undefined
            && (vel < vf.min || vel > vf.max))                                           return false;
        if (vf.mode === "exact"  && vf.exact !== undefined && vel !== vf.exact)          return false;
      }
      return true;
    }
    if ((mapping.trigger === "off" || mapping.trigger === "both") && evt.midi.type === "noteoff") {
      // Note-off events don't carry the originating note-on velocity, so we match
      // on pitch only — all velocity variants of this pitch will fire on note-off.
      return evt.midi.data1 === pitch;
    }
    return false;
  }

  if (mapping.targetType === "lane") {
    const laneKey = evtToLaneKey(evt);
    return laneKey !== null && laneKeyString(laneKey) === mapping.targetId;
  }

  return false;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/osc-mapping.ts
git commit -m "feat(osc): apply velocity filter in matchesMapping"
```

---

### Task 3: Apply random clip range in `resolveOscAddress`

**Files:**
- Modify: `src/lib/osc-mapping.ts:8-24`

When `resolumeClipMax` is set and mode is `clip`, pick a random integer in `[resolumeClip, resolumeClipMax]`.

- [ ] **Step 1: Update the resolume case in `resolveOscAddress`**

In `src/lib/osc-mapping.ts`, replace the `resolume` case (lines 19–23):

```typescript
case "resolume": {
  if (mapping.resolumeMode === "column") {
    return `/composition/columns/${mapping.resolumeColumn ?? 1}/connect`;
  }
  const layer = mapping.resolumeLayer ?? 1;
  const clipMin = mapping.resolumeClip ?? 1;
  const clip = mapping.resolumeClipMax !== undefined
    ? clipMin + Math.floor(Math.random() * (mapping.resolumeClipMax - clipMin + 1))
    : clipMin;
  return `/composition/layers/${layer}/clips/${clip}/connect`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/osc-mapping.ts
git commit -m "feat(osc): randomise Resolume clip number when resolumeClipMax is set"
```

---

### Task 4: Add velocity filter UI to OscMappingEditor

**Files:**
- Modify: `src/components/timeline/osc-mapping-editor.tsx`

Add velocity filter state and UI section. Only shown when `targetType === "noteGroup"`. Placed just above the existing Trigger radio group.

- [ ] **Step 1: Add velocity filter state**

In `src/components/timeline/osc-mapping-editor.tsx`, after the existing `const [resolumeClip, ...]` state (around line 52), add:

```typescript
// velocity filter
const [vfMode, setVfMode] = useState<"all" | "above" | "range" | "exact">(
  seed?.velocityFilter?.mode ?? "all"
);
const [vfMin, setVfMin] = useState(seed?.velocityFilter?.min ?? 1);
const [vfMax, setVfMax] = useState(seed?.velocityFilter?.max ?? 127);
const [vfExact, setVfExact] = useState(seed?.velocityFilter?.exact ?? 64);
```

- [ ] **Step 2: Include velocityFilter in `handleAdd` and `handleSave`**

In `handleAdd` (line 64), add `velocityFilter` to the mapping object:

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
    velocityFilter: targetType === "noteGroup" && vfMode !== "all"
      ? { mode: vfMode, min: vfMin, max: vfMax, exact: vfExact }
      : undefined,
  });
  onClose();
};
```

In `handleSave` (line 77), add `velocityFilter` similarly:

```typescript
const handleSave = () => {
  if (!editingMapping || !endpointId) return;
  onUpdate?.({
    ...editingMapping,
    endpointId, preset, trigger, argType, address,
    sectionName, unrealType, unrealName: unrealName || "param",
    resolumeMode, resolumeColumn, resolumeLayer, resolumeClip,
    sectionId: editingMapping.sectionId ?? sectionId ?? undefined,
    velocityFilter: targetType === "noteGroup" && vfMode !== "all"
      ? { mode: vfMode, min: vfMin, max: vfMax, exact: vfExact }
      : undefined,
  });
};
```

- [ ] **Step 3: Add velocity filter UI section**

In the JSX, add the following block just **before** the existing Trigger radio group (before the `{targetType === "noteGroup" && (` block for trigger, around line 246):

```tsx
{/* Velocity filter — note groups only */}
{targetType === "noteGroup" && (
  <div>
    <label className="block text-[10px] text-gray-500 mb-1">Velocity filter</label>
    <div className="flex gap-3 mb-1.5">
      {(["all", "above", "range", "exact"] as const).map((m) => (
        <label key={m} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
          <input type="radio" checked={vfMode === m} onChange={() => setVfMode(m)} className="accent-accent" />
          {m}
        </label>
      ))}
    </div>
    {vfMode === "above" && (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500">min</span>
        <input
          type="number" min={0} max={127}
          value={vfMin}
          onChange={(e) => setVfMin(Math.min(127, Math.max(0, parseInt(e.target.value) || 0)))}
          className="w-16 bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
        />
      </div>
    )}
    {vfMode === "range" && (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500">min</span>
        <input
          type="number" min={0} max={127}
          value={vfMin}
          onChange={(e) => setVfMin(Math.min(vfMax - 1, Math.max(0, parseInt(e.target.value) || 0)))}
          className="w-16 bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
        />
        <span className="text-[10px] text-gray-500">max</span>
        <input
          type="number" min={0} max={127}
          value={vfMax}
          onChange={(e) => setVfMax(Math.min(127, Math.max(vfMin + 1, parseInt(e.target.value) || 127)))}
          className="w-16 bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
        />
      </div>
    )}
    {vfMode === "exact" && (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500">velocity</span>
        <input
          type="number" min={0} max={127}
          value={vfExact}
          onChange={(e) => setVfExact(Math.min(127, Math.max(0, parseInt(e.target.value) || 0)))}
          className="w-16 bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
        />
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/osc-mapping-editor.tsx
git commit -m "feat(osc-editor): velocity filter UI for note group mappings"
```

---

### Task 5: Add Resolume random clip range UI

**Files:**
- Modify: `src/components/timeline/osc-mapping-editor.tsx`

When Resolume clip mode is selected, show a "random range" toggle that exposes `resolumeClipMax`.

- [ ] **Step 1: Add `resolumeClipMax` state**

After `const [resolumeClip, setResolumeClip] = useState(...)` (around line 52), add:

```typescript
const [resolumeClipMax, setResolumeClipMax] = useState(seed?.resolumeClipMax ?? 0);
const [resolumeClipRandom, setResolumeClipRandom] = useState(!!seed?.resolumeClipMax);
```

- [ ] **Step 2: Include `resolumeClipMax` in `handleAdd` and `handleSave`**

In `handleAdd`, add to the mapping object:

```typescript
resolumeClipMax: resolumeClipRandom ? resolumeClipMax : undefined,
```

In `handleSave`, add the same field.

- [ ] **Step 3: Add random range UI below the Clip input**

In the JSX, inside the `{resolumeMode === "clip" && ...}` block, add below the existing Layer/Clip inputs:

```tsx
{/* Random range toggle */}
<div className="flex items-center gap-2 mt-1">
  <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer select-none">
    <input
      type="checkbox"
      checked={resolumeClipRandom}
      onChange={(e) => setResolumeClipRandom(e.target.checked)}
      className="accent-accent"
    />
    Random clip range
  </label>
</div>
{resolumeClipRandom && (
  <div className="flex items-center gap-2 mt-1">
    <span className="text-[10px] text-gray-500">up to clip</span>
    <input
      type="number"
      min={resolumeClip + 1}
      value={resolumeClipMax || resolumeClip + 1}
      onChange={(e) => setResolumeClipMax(Math.max(resolumeClip + 1, parseInt(e.target.value) || resolumeClip + 1))}
      className="w-16 bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
    />
    <span className="text-[10px] text-gray-500 font-mono">
      → random [{resolumeClip}–{resolumeClipMax || resolumeClip + 1}]
    </span>
  </div>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/rense/Projects/osc_tool && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/osc-mapping-editor.tsx
git commit -m "feat(osc-editor): Resolume random clip range UI"
```
