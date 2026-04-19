# Section-Aware OSC Mappings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link all OSC mappings to timeline sections — show the section selector for every preset, use the active section as the default, and position chips in the note group panel at their section's start time.

**Architecture:** Three files change. `OscMappingEditor` gains a `defaultSectionName` prop and shows the section selector for all presets. `DeviceSection` gains an `activeSectionName` prop, threads it to the editor, and replaces the flex chip row with an absolutely-positioned layout keyed on section startMs. `TimelineCanvas` passes `activeSection?.name` down as `activeSectionName`.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS

---

## File map

| File | Change |
|---|---|
| `src/components/timeline/osc-mapping-editor.tsx` | Add `defaultSectionName` prop; move section selector out of Unreal guard |
| `src/components/timeline/device-section.tsx` | Add `activeSectionName` prop; thread to editor; rewrite chip track area; move count badge to gutter |
| `src/components/timeline/timeline-canvas.tsx` | Pass `activeSectionName={activeSection?.name}` to every `<DeviceSection>` |

---

### Task 1: OscMappingEditor — section selector for all presets + defaultSectionName

**Files:**
- Modify: `src/components/timeline/osc-mapping-editor.tsx`

- [ ] **Step 1: Add `defaultSectionName` to props interface and destructuring**

Replace the existing interface and function signature (lines 7–27):

```tsx
interface OscMappingEditorProps {
  targetType: "noteGroup" | "lane";
  targetId: string;
  deviceId: string;
  mappings: OscMapping[];
  endpoints: SavedEndpoint[];
  defaultEndpointId: string | undefined;
  sections: TimelineSection[];
  defaultSectionName?: string;
  deviceAliases?: Record<string, string>;
  editingMapping?: OscMapping;
  anchorRect: DOMRect;
  onAdd: (mapping: OscMapping) => void;
  onUpdate?: (mapping: OscMapping) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function OscMappingEditor({
  targetType, targetId, deviceId, mappings, endpoints, defaultEndpointId,
  sections, defaultSectionName, deviceAliases, editingMapping, anchorRect, onAdd, onUpdate, onDelete, onClose,
}: OscMappingEditorProps) {
```

- [ ] **Step 2: Update sectionName initial state to use defaultSectionName fallback**

Replace line 35:

```ts
const [sectionName, setSectionName] = useState(
  editingMapping?.sectionName ?? defaultSectionName ?? sections[0]?.name ?? ""
);
```

- [ ] **Step 3: Move section selector out of the Unreal-only block**

Remove the entire `{preset === "unreal" && (...)}` block (lines 155–178) and replace it with a section block that renders for all presets, placed between the preset selector and the custom address field. Then add a separate Unreal-specific block for unrealType/unrealName if needed (currently neither is exposed as UI, so no Unreal-specific block is needed after this change):

```tsx
        {/* Preset-specific fields */}
        {preset === "custom" && (
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">OSC Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="/my/address"
              className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent/50"
            />
          </div>
        )}

        {/* Section — shown for all presets, only used in Unreal address */}
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Section</label>
          {sections.length > 0 ? (
            <select
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
            >
              {sections.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              placeholder="section name"
              className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent/50"
            />
          )}
        </div>

        {preset === "resolume" && (
```

The resolume block stays unchanged after this insertion point. The full preset block after the edit should read (in order): custom address → section selector → resolume fields.

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/osc-mapping-editor.tsx
git commit -m "feat(osc-editor): show section selector for all presets, add defaultSectionName prop"
```

---

### Task 2: TimelineCanvas — thread activeSectionName to DeviceSection

**Files:**
- Modify: `src/components/timeline/timeline-canvas.tsx`
- Modify: `src/components/timeline/device-section.tsx` (props interface only)

- [ ] **Step 1: Add `activeSectionName` to DeviceSectionProps**

In `src/components/timeline/device-section.tsx`, add after `activeSectionRange` in the props interface:

```ts
  activeSectionName?: string;
```

And add it to the destructuring in the `DeviceSection` function body (same line as the other props):

```ts
    onDeleteDevice, displayName, onRenameDevice, deviceAliases, selectedVelocity, activeSectionRange, activeSectionName, onNoteClick,
```

- [ ] **Step 2: Pass activeSectionName from TimelineCanvas**

In `src/components/timeline/timeline-canvas.tsx`, in the `<DeviceSection>` render (after the `activeSectionRange` prop, around line 590):

```tsx
          activeSectionRange={activeSection ? { startMs: activeSection.startMs, endMs: activeSection.endMs } : null}
          activeSectionName={activeSection?.name}
```

- [ ] **Step 3: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/timeline/device-section.tsx src/components/timeline/timeline-canvas.tsx
git commit -m "feat(device-section): accept and thread activeSectionName prop"
```

---

### Task 3: DeviceSection — thread activeSectionName to OscMappingEditor + absolute chip layout

**Files:**
- Modify: `src/components/timeline/device-section.tsx`

This is the largest task. Two independent sub-changes:
1. Pass `defaultSectionName={activeSectionName}` to `<OscMappingEditor>`
2. Replace the flex chip track area with an absolutely-positioned layout

- [ ] **Step 1: Pass defaultSectionName to OscMappingEditor**

In the `{oscEditor && (...)}` block (around line 430), add `defaultSectionName` to the `<OscMappingEditor>` props:

```tsx
      {oscEditor && (
        <OscMappingEditor
          targetType={oscEditor.targetType}
          targetId={oscEditor.targetId}
          deviceId={device}
          mappings={oscMappings.filter(
            (m) => m.targetType === oscEditor.targetType && m.targetId === oscEditor.targetId && m.deviceId === device
          )}
          endpoints={endpoints}
          defaultEndpointId={defaultEndpointId}
          sections={sections}
          defaultSectionName={activeSectionName}
          anchorRect={oscEditor.anchorRect}
          deviceAliases={deviceAliases}
          editingMapping={oscEditor.editingMapping}
          onAdd={(mapping) => { onAddOscMapping?.(mapping); }}
          onUpdate={(mapping) => { onUpdateOscMapping?.(mapping); setOscEditor(null); }}
          onDelete={(id) => { onDeleteOscMapping?.(id); }}
          onClose={() => setOscEditor(null)}
        />
      )}
```

- [ ] **Step 2: Type-check after step 1**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Rewrite the chip track area with absolute positioning**

Inside the `displayGroups.map(...)` in the note group panel, replace the entire IIFE that renders the track area (`{(() => { const rowMappings = ... })()}`) with the following. This groups chips by `sectionName` and positions each group at the corresponding section's x-coordinate.

```tsx
                {/* Track area — chips positioned at section start, + OSC button at far left */}
                {(() => {
                  const rowMappings = oscMappings.filter(
                    (m) => m.targetType === "noteGroup" && m.targetId === `${pitch}|${tagVelocity}` && m.deviceId === device
                  );
                  const viewSpan = Math.max(1, viewEndMs - viewStartMs);
                  const sectionLeftPct = (sName: string | undefined): string => {
                    if (!sName) return "0%";
                    const sec = sections.find((s) => s.name === sName);
                    if (!sec) return "0%";
                    const frac = Math.max(0, (sec.startMs - viewStartMs) / viewSpan);
                    return `${frac * 100}%`;
                  };
                  // Group chips by sectionName so chips sharing a section render side-by-side
                  const grouped = new Map<string, typeof rowMappings>();
                  for (const m of rowMappings) {
                    const key = m.sectionName ?? "__none__";
                    if (!grouped.has(key)) grouped.set(key, []);
                    grouped.get(key)!.push(m);
                  }
                  return (
                    <div className="relative flex-1 h-full overflow-hidden">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOscEditor({
                            targetType: "noteGroup",
                            targetId: `${pitch}|${tagVelocity}`,
                            anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                          });
                        }}
                        className="absolute opacity-0 group-hover/row:opacity-100 text-[9px] text-gray-600 hover:text-gray-400 transition-all px-1.5 py-0.5 rounded border border-white/5 hover:border-white/15 shrink-0 top-1/2 -translate-y-1/2"
                        style={{ left: 4 }}
                      >
                        + OSC
                      </button>
                      {Array.from(grouped.entries()).map(([sKey, chips]) => (
                        <div
                          key={sKey}
                          className="absolute flex items-center gap-1 top-1/2 -translate-y-1/2"
                          style={{ left: sectionLeftPct(sKey === "__none__" ? undefined : sKey) }}
                        >
                          {chips.map((m) => (
                            <div
                              key={m.id}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border border-accent/20 bg-accent/5 text-accent/80 shrink-0 cursor-pointer hover:border-accent/40 hover:bg-accent/10 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOscEditor({
                                  targetType: "noteGroup",
                                  targetId: `${pitch}|${tagVelocity}`,
                                  anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                                  editingMapping: m,
                                });
                              }}
                            >
                              <span className="font-mono truncate max-w-[120px]">{resolveOscAddress(m, deviceAliases)}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); onDeleteOscMapping?.(m.id); }}
                                className="text-accent/40 hover:text-red-400 leading-none transition-colors"
                              >×</button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })()}
```

- [ ] **Step 4: Move count badge from track area to gutter**

The `{count}×` span was previously at the end of the track area IIFE (now removed in step 3). Add it into the gutter div, grouped with the tag button using a wrapper div that takes `ml-auto`:

Find the tag button block in the gutter and wrap both the count and the tag button in an `ml-auto` flex container:

```tsx
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-700">{count}×</span>
                    {tag ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTagEditor({ pitch, velocity: tagVelocity, anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                        }}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border hover:opacity-80 transition-opacity"
                        style={{ color: chipColor, borderColor: `${chipColor}44`, background: `${chipColor}11` }}
                      >
                        <span>{tag.label}</span>
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTagEditor({ pitch, velocity: tagVelocity, anchorRect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                        }}
                        className="opacity-0 group-hover/row:opacity-100 text-[10px] text-gray-600 hover:text-gray-400 transition-all px-1.5 py-0.5 rounded border border-white/5 hover:border-white/15"
                      >
                        + tag
                      </button>
                    )}
                  </div>
```

(Remove the `ml-auto` class from each individual tag button since the wrapper div now handles that.)

- [ ] **Step 5: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/timeline/device-section.tsx
git commit -m "feat(device-section): position OSC chips at section start, thread activeSectionName to editor"
```

---

### Task 4: Manual verification

- [ ] Load a recording with sections defined
- [ ] Click a section in the section bar to activate it
- [ ] Open the OSC mapping editor on a note group — confirm the Section dropdown defaults to the active section
- [ ] Add a Resolume mapping — confirm the section selector appears and the address is unaffected by section choice
- [ ] Add a custom mapping — confirm the section selector appears and the address is unaffected
- [ ] Add an Unreal mapping — confirm section appears in the OSC address
- [ ] In the note group panel, confirm chips appear at the horizontal position matching their section's start in the timeline
- [ ] Scroll/zoom the view — confirm chips reposition correctly as viewStartMs/viewEndMs change
- [ ] Collapse a device — confirm the note group panel disappears (existing behavior)
