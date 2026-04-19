# Timeline OSC Output Mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OSC output mappings to Timeline note groups and lanes that fire during recording playback.

**Architecture:** New `OscMapping` type stored in `Recording.oscMappings`. A `useOscPlayback` hook matches events to mappings and fires OSC via the existing `osc:send` IPC channel on each playhead tick. A new `OscMappingEditor` floating popover component lives in the timeline, rendered from `DeviceSection`.

**Tech Stack:** TypeScript, React, Electron IPC, existing `window.electronAPI.invoke`, Tailwind CSS

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/types.ts` | Modify | Add `OscPreset`, `OscTrigger`, `OscMapping`; extend `Recording` |
| `src/lib/osc-mapping.ts` | Create | `resolveOscAddress`, event-matching helpers |
| `src/hooks/use-osc-playback.ts` | Create | Fires OSC during playback |
| `src/components/timeline/osc-mapping-editor.tsx` | Create | Floating popover UI for add/delete mappings |
| `src/components/timeline/device-section.tsx` | Modify | Add OSC editor state + render OscMappingEditor |
| `src/components/timeline/continuous-lane.tsx` | Modify | Add `onRequestOscEditor` callback + OSC gutter button |
| `src/components/timeline/program-lane.tsx` | Modify | Same as continuous-lane |
| `src/components/timeline/timeline-canvas.tsx` | Modify | Thread new OSC props down to DeviceSection |
| `src/app/timeline/page.tsx` | Modify | State management, endpoint fetch, useOscPlayback |

---

## Task 1: Add OscMapping types to types.ts

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add types after the `NoteGroupTag` interface (around line 171)**

  Insert before `export interface Recording`:

  ```typescript
  export type OscPreset = "custom" | "unreal" | "resolume";
  export type OscTrigger = "on" | "off" | "both";

  export interface OscMapping {
    id: string;
    targetType: "noteGroup" | "lane";
    /** Note groups: "${pitch}|${velocity}". Lanes: laneKeyString output. */
    targetId: string;
    deviceId: string;
    endpointId: string;
    preset: OscPreset;
    /** For noteGroup: when to fire. Lanes always fire on every value change. */
    trigger: OscTrigger;
    argType: "f" | "i";
    address?: string;
    unrealType?: "parameter" | "trigger";
    unrealName?: string;
    resolumeMode?: "column" | "clip";
    resolumeColumn?: number;
    resolumeLayer?: number;
    resolumeClip?: number;
  }
  ```

- [ ] **Step 2: Add `oscMappings` to the `Recording` interface**

  Add after the `hiddenNoteGroups` line:

  ```typescript
  oscMappings?: OscMapping[];
  ```

- [ ] **Step 3: Type-check**

  ```bash
  pnpm exec tsc --noEmit
  ```

  Expected: no errors related to types.ts.

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/types.ts
  git commit -m "feat(types): add OscMapping, OscPreset, OscTrigger; extend Recording"
  ```

---

## Task 2: Create the OSC mapping helper module

**Files:**
- Create: `src/lib/osc-mapping.ts`

- [ ] **Step 1: Create the file**

  ```typescript
  import type { LaneKey, OscMapping, RecordedEvent } from "./types";
  import { laneKeyString } from "./types";

  export function resolveOscAddress(mapping: OscMapping): string {
    switch (mapping.preset) {
      case "custom":
        return mapping.address ?? "/";
      case "unreal":
        return mapping.unrealType === "parameter"
          ? `/unreal/parameter/${mapping.unrealName ?? "param"}`
          : `/unreal/trigger/${mapping.unrealName ?? "trigger"}`;
      case "resolume":
        return mapping.resolumeMode === "column"
          ? `/composition/columns/${mapping.resolumeColumn ?? 1}/connect`
          : `/composition/layers/${mapping.resolumeLayer ?? 1}/clips/${mapping.resolumeClip ?? 1}/connect`;
    }
  }

  /** Canonical note group targetId for an OscMapping. */
  export function noteGroupTargetId(pitch: number, velocity: number): string {
    return `${pitch}|${velocity}`;
  }

  function evtToLaneKey(evt: RecordedEvent): LaneKey | null {
    switch (evt.midi.type) {
      case "cc":
        return { kind: "cc", device: evt.midi.deviceName, channel: evt.midi.channel, cc: evt.midi.data1 };
      case "pitch":
        return { kind: "pitch", device: evt.midi.deviceName, channel: evt.midi.channel };
      case "aftertouch":
        return { kind: "aftertouch", device: evt.midi.deviceName, channel: evt.midi.channel };
      case "program":
        return { kind: "program", device: evt.midi.deviceName, channel: evt.midi.channel };
      default:
        return null;
    }
  }

  export function matchesMapping(evt: RecordedEvent, mapping: OscMapping): boolean {
    if (evt.midi.deviceName !== mapping.deviceId) return false;

    if (mapping.targetType === "noteGroup") {
      const [pitchStr, velocityStr] = mapping.targetId.split("|");
      const pitch = parseInt(pitchStr, 10);
      const velocity = parseInt(velocityStr, 10);

      if ((mapping.trigger === "on" || mapping.trigger === "both") && evt.midi.type === "noteon") {
        return evt.midi.data1 === pitch && evt.midi.data2 === velocity;
      }
      if ((mapping.trigger === "off" || mapping.trigger === "both") && evt.midi.type === "noteoff") {
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

  export function computeOscArgValue(evt: RecordedEvent, mapping: OscMapping): number {
    if (mapping.targetType === "noteGroup") {
      const isOn = evt.midi.type === "noteon";
      return mapping.argType === "f" ? (isOn ? 1.0 : 0.0) : (isOn ? 1 : 0);
    }
    // Lane: data2 is the raw value (0–127 for CC/AT/program, pitch varies)
    return mapping.argType === "f" ? evt.midi.data2 / 127 : evt.midi.data2;
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  pnpm exec tsc --noEmit
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/osc-mapping.ts
  git commit -m "feat(osc-mapping): add resolveOscAddress, matchesMapping, computeOscArgValue helpers"
  ```

---

## Task 3: Create the useOscPlayback hook

**Files:**
- Create: `src/hooks/use-osc-playback.ts`

- [ ] **Step 1: Create the file**

  ```typescript
  "use client";

  import { useEffect, useMemo, useRef } from "react";
  import type { Recording, SavedEndpoint } from "@/lib/types";
  import { matchesMapping, computeOscArgValue, resolveOscAddress } from "@/lib/osc-mapping";

  interface UseOscPlaybackArgs {
    recording: Recording | null;
    playheadMs: number;
    isPlaying: boolean;
    endpoints: SavedEndpoint[];
  }

  export function useOscPlayback({ recording, playheadMs, isPlaying, endpoints }: UseOscPlaybackArgs) {
    const firedRef = useRef<Set<string>>(new Set());
    const lastPlayheadRef = useRef<number>(0);

    // Pre-compute annotated event queue — rebuilt only when recording or its mappings change.
    const queue = useMemo(() => {
      if (!recording?.oscMappings?.length) return [];
      const result: Array<{ tRel: number; eventIdx: number; mappingId: string; address: string; value: number; argType: "f" | "i"; endpointId: string }> = [];

      recording.events.forEach((evt, idx) => {
        for (const mapping of recording.oscMappings!) {
          if (!matchesMapping(evt, mapping)) continue;
          result.push({
            tRel: evt.tRel,
            eventIdx: idx,
            mappingId: mapping.id,
            address: resolveOscAddress(mapping),
            value: computeOscArgValue(evt, mapping),
            argType: mapping.argType,
            endpointId: mapping.endpointId,
          });
        }
      });

      return result; // already sorted because recording.events is sorted by tRel
    }, [recording?.id, recording?.oscMappings]);

    useEffect(() => {
      // Detect backward seek and reset fired set.
      if (playheadMs < lastPlayheadRef.current - 100) {
        firedRef.current.clear();
      }
      lastPlayheadRef.current = playheadMs;

      if (!isPlaying || queue.length === 0) return;

      for (const item of queue) {
        if (item.tRel > playheadMs) break;
        const key = `${item.eventIdx}-${item.mappingId}`;
        if (firedRef.current.has(key)) continue;
        firedRef.current.add(key);

        const endpoint = endpoints.find((e) => e.id === item.endpointId);
        if (!endpoint) continue;

        window.electronAPI?.invoke("osc:send", { host: endpoint.host, port: endpoint.port }, item.address, [
          { type: item.argType, value: item.value },
        ]);
      }
    }, [playheadMs, isPlaying, queue, endpoints]);
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  pnpm exec tsc --noEmit
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/hooks/use-osc-playback.ts
  git commit -m "feat(hooks): add useOscPlayback for OSC firing during timeline playback"
  ```

---

## Task 4: Create the OscMappingEditor component

**Files:**
- Create: `src/components/timeline/osc-mapping-editor.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
  "use client";

  import { useState } from "react";
  import type { OscMapping, OscPreset, OscTrigger, SavedEndpoint } from "@/lib/types";
  import { resolveOscAddress } from "@/lib/osc-mapping";

  interface OscMappingEditorProps {
    targetType: "noteGroup" | "lane";
    targetId: string;
    deviceId: string;
    mappings: OscMapping[];
    endpoints: SavedEndpoint[];
    defaultEndpointId: string | undefined;
    anchorRect: DOMRect;
    onAdd: (mapping: OscMapping) => void;
    onDelete: (id: string) => void;
    onClose: () => void;
  }

  export function OscMappingEditor({
    targetType, targetId, deviceId, mappings, endpoints, defaultEndpointId,
    anchorRect, onAdd, onDelete, onClose,
  }: OscMappingEditorProps) {
    const [endpointId, setEndpointId] = useState(defaultEndpointId ?? endpoints[0]?.id ?? "");
    const [preset, setPreset] = useState<OscPreset>("custom");
    const [trigger, setTrigger] = useState<OscTrigger>("on");
    const [argType, setArgType] = useState<"f" | "i">("f");
    // custom
    const [address, setAddress] = useState("/");
    // unreal
    const [unrealType, setUnrealType] = useState<"parameter" | "trigger">("parameter");
    const [unrealName, setUnrealName] = useState("");
    // resolume
    const [resolumeMode, setResolumeMode] = useState<"column" | "clip">("column");
    const [resolumeColumn, setResolumeColumn] = useState(1);
    const [resolumeLayer, setResolumeLayer] = useState(1);
    const [resolumeClip, setResolumeClip] = useState(1);

    const previewMapping: OscMapping = {
      id: "preview",
      targetType, targetId, deviceId, endpointId,
      preset, trigger, argType, address,
      unrealType, unrealName,
      resolumeMode, resolumeColumn, resolumeLayer, resolumeClip,
    };
    const preview = resolveOscAddress(previewMapping);

    const handleAdd = () => {
      if (!endpointId) return;
      onAdd({
        id: crypto.randomUUID(),
        targetType, targetId, deviceId, endpointId,
        preset, trigger, argType, address,
        unrealType, unrealName: unrealName || "param",
        resolumeMode, resolumeColumn, resolumeLayer, resolumeClip,
      });
    };

    const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 480);
    const left = Math.min(anchorRect.left, window.innerWidth - 300);

    return (
      <div
        className="fixed z-50 bg-surface-light border border-white/10 rounded-lg p-4 shadow-xl"
        style={{ top, left, width: 292 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">OSC Mappings</h3>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-xs">✕</button>
        </div>

        {/* Existing mappings */}
        {mappings.length > 0 && (
          <div className="mb-3 space-y-1">
            {mappings.map((m) => {
              const ep = endpoints.find((e) => e.id === m.endpointId);
              return (
                <div key={m.id} className="flex items-center gap-2 px-2 py-1 bg-white/5 rounded text-[10px]">
                  <span className="font-mono text-accent flex-1 truncate">{resolveOscAddress(m)}</span>
                  {targetType === "noteGroup" && (
                    <span className="text-gray-500">[{m.trigger}]</span>
                  )}
                  {ep && <span className="text-gray-600 truncate max-w-[60px]">{ep.name}</span>}
                  <button
                    onClick={() => onDelete(m.id)}
                    className="text-gray-600 hover:text-red-400 leading-none"
                  >✕</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-white/5 pt-3 space-y-2">
          {/* Endpoint */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Endpoint</label>
            <select
              value={endpointId}
              onChange={(e) => setEndpointId(e.target.value)}
              className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
            >
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>{ep.name} ({ep.host}:{ep.port})</option>
              ))}
            </select>
          </div>

          {/* Preset */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Preset</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as OscPreset)}
              className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
            >
              <option value="custom">Custom</option>
              <option value="unreal">Unreal Engine</option>
              <option value="resolume">Resolume</option>
            </select>
          </div>

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

          {preset === "unreal" && (
            <>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Type</label>
                <div className="flex gap-3">
                  {(["parameter", "trigger"] as const).map((t) => (
                    <label key={t} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                      <input type="radio" checked={unrealType === t} onChange={() => setUnrealType(t)} className="accent-accent" />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={unrealName}
                  onChange={(e) => setUnrealName(e.target.value)}
                  placeholder="param_name"
                  className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent/50"
                />
              </div>
            </>
          )}

          {preset === "resolume" && (
            <>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Mode</label>
                <div className="flex gap-3">
                  {(["column", "clip"] as const).map((m) => (
                    <label key={m} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                      <input type="radio" checked={resolumeMode === m} onChange={() => setResolumeMode(m)} className="accent-accent" />
                      {m}
                    </label>
                  ))}
                </div>
              </div>
              {resolumeMode === "column" && (
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Column</label>
                  <input
                    type="number"
                    min={1}
                    value={resolumeColumn}
                    onChange={(e) => setResolumeColumn(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
                  />
                </div>
              )}
              {resolumeMode === "clip" && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] text-gray-500 mb-1">Layer</label>
                    <input
                      type="number"
                      min={1}
                      value={resolumeLayer}
                      onChange={(e) => setResolumeLayer(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] text-gray-500 mb-1">Clip</label>
                    <input
                      type="number"
                      min={1}
                      value={resolumeClip}
                      onChange={(e) => setResolumeClip(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-surface-lighter border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Address preview */}
          <div className="text-[10px] text-gray-600 font-mono truncate">{preview}</div>

          {/* Trigger (note groups only) */}
          {targetType === "noteGroup" && (
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Trigger</label>
              <div className="flex gap-3">
                {(["on", "off", "both"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                    <input type="radio" checked={trigger === t} onChange={() => setTrigger(t)} className="accent-accent" />
                    {t}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Arg type */}
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">Arg type</label>
            <div className="flex gap-3">
              {(["f", "i"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                  <input type="radio" checked={argType === t} onChange={() => setArgType(t)} className="accent-accent" />
                  {t === "f" ? "Float" : "Int"}
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={handleAdd}
            disabled={!endpointId || endpoints.length === 0}
            className="w-full py-1.5 text-xs bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            + Add Mapping
          </button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  pnpm exec tsc --noEmit
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/timeline/osc-mapping-editor.tsx
  git commit -m "feat(timeline): add OscMappingEditor floating popover component"
  ```

---

## Task 5: Integrate OscMappingEditor into DeviceSection (note groups)

**Files:**
- Modify: `src/components/timeline/device-section.tsx`

- [ ] **Step 1: Add new props to `DeviceSectionProps` interface**

  After `onDeleteNoteTag` in the interface, add:

  ```typescript
  oscMappings?: OscMapping[];
  endpoints?: SavedEndpoint[];
  onAddOscMapping?: (mapping: OscMapping) => void;
  onDeleteOscMapping?: (id: string) => void;
  ```

  Also add to the import line at the top:

  ```typescript
  import type { LaneAnalysis, LaneBadge, LaneKey, LaneMap, NoteGroupTag, NoteSpan, RecordedEvent, MidiMappingRule, OscMapping, SavedEndpoint } from "@/lib/types";
  ```

- [ ] **Step 2: Destructure new props in the function body**

  In the destructuring block at the top of `DeviceSection`, after `onDeleteNoteTag`, add:

  ```typescript
  oscMappings = [], endpoints = [], onAddOscMapping, onDeleteOscMapping,
  ```

- [ ] **Step 3: Add oscEditor state**

  After the `tagEditor` state declaration, add:

  ```typescript
  const [oscEditor, setOscEditor] = useState<{
    targetType: "noteGroup" | "lane";
    targetId: string;
    anchorRect: DOMRect;
  } | null>(null);
  ```

- [ ] **Step 4: Add `defaultEndpointId` memo**

  After the `oscEditor` state, add:

  ```typescript
  const defaultEndpointId = useMemo(
    () => oscMappings.length > 0 ? oscMappings[oscMappings.length - 1].endpointId : endpoints[0]?.id,
    [oscMappings, endpoints]
  );
  ```

- [ ] **Step 5: Add OSC button to each note group row**

  In the note group row gutter (right after the tag button block, around line 388), add an OSC button in the same row. The gutter div already has `flex items-center gap-2`. Add after the tag button block:

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
    className={`opacity-0 group-hover/row:opacity-100 text-[10px] transition-all px-1.5 py-0.5 rounded border ${
      oscMappings.some((m) => m.targetType === "noteGroup" && m.targetId === `${pitch}|${tagVelocity}` && m.deviceId === device)
        ? "text-accent border-accent/30 opacity-100"
        : "text-gray-600 border-white/5 hover:text-gray-400 hover:border-white/15"
    }`}
    title="OSC mapping"
  >
    OSC
  </button>
  ```

- [ ] **Step 6: Render OscMappingEditor from DeviceSection**

  Import the component at the top:

  ```typescript
  import { OscMappingEditor } from "./osc-mapping-editor";
  ```

  After the `NoteTagEditor` render block (around line 423), add:

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
      anchorRect={oscEditor.anchorRect}
      onAdd={(mapping) => { onAddOscMapping?.(mapping); }}
      onDelete={(id) => { onDeleteOscMapping?.(id); }}
      onClose={() => setOscEditor(null)}
    />
  )}
  ```

- [ ] **Step 7: Type-check**

  ```bash
  pnpm exec tsc --noEmit
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/timeline/device-section.tsx
  git commit -m "feat(device-section): add OSC mapping editor for note groups"
  ```

---

## Task 6: Add OSC editor trigger to ContinuousLane and ProgramLane

**Files:**
- Modify: `src/components/timeline/continuous-lane.tsx`
- Modify: `src/components/timeline/program-lane.tsx`

- [ ] **Step 1: Add `onRequestOscEditor` prop to `ContinuousLaneProps`**

  Add to the interface:

  ```typescript
  onRequestOscEditor?: (targetId: string, anchorRect: DOMRect) => void;
  hasOscMapping?: boolean;
  ```

- [ ] **Step 2: Destructure and use in `ContinuousLane`**

  Add `onRequestOscEditor, hasOscMapping` to the destructured params.

  In the gutter div (around line 175), after the `onHide` button block, add:

  ```tsx
  {onRequestOscEditor && (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onRequestOscEditor(laneKey, (e.currentTarget as HTMLElement).getBoundingClientRect());
      }}
      className={`absolute bottom-0.5 right-0.5 opacity-0 group-hover/gutter:opacity-100 transition-opacity text-[9px] px-1 py-0.5 rounded border leading-none ${
        hasOscMapping
          ? "text-accent border-accent/30 opacity-100"
          : "text-gray-600 border-white/5 hover:text-gray-400"
      }`}
      title="OSC mapping"
    >
      OSC
    </button>
  )}
  ```

- [ ] **Step 3: Add the same props and button to ProgramLane**

  Add to `ProgramLaneProps` interface:

  ```typescript
  onRequestOscEditor?: (targetId: string, anchorRect: DOMRect) => void;
  hasOscMapping?: boolean;
  ```

  Destructure in the function body alongside existing params.

  In the gutter div (after the `onHide` button block at line 80–86), add:

  ```tsx
  {onRequestOscEditor && (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onRequestOscEditor(laneKey, (e.currentTarget as HTMLElement).getBoundingClientRect());
      }}
      className={`absolute bottom-0.5 right-0.5 opacity-0 group-hover/gutter:opacity-100 transition-opacity text-[9px] px-1 py-0.5 rounded border leading-none ${
        hasOscMapping
          ? "text-accent border-accent/30 opacity-100"
          : "text-gray-600 border-white/5 hover:text-gray-400"
      }`}
      title="OSC mapping"
    >
      OSC
    </button>
  )}
  ```

- [ ] **Step 4: Type-check**

  ```bash
  pnpm exec tsc --noEmit
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/timeline/continuous-lane.tsx src/components/timeline/program-lane.tsx
  git commit -m "feat(lanes): add onRequestOscEditor callback and OSC indicator to ContinuousLane and ProgramLane"
  ```

---

## Task 7: Wire lane OSC editor through DeviceSection

**Files:**
- Modify: `src/components/timeline/device-section.tsx`

- [ ] **Step 1: Pass `onRequestOscEditor` to `ContinuousLane` and `ProgramLane`**

  In the `laneEntries.map` block:
  - `case "cc"`, `case "pitch"`, `case "aftertouch"` → `ContinuousLane`
  - `case "program"` → `ProgramLane`

  Add the following props to each `ContinuousLane` and `ProgramLane` component:

  ```tsx
  onRequestOscEditor={(targetId, anchorRect) => {
    setOscEditor({ targetType: "lane", targetId, anchorRect });
  }}
  hasOscMapping={oscMappings.some((m) => m.targetType === "lane" && m.targetId === keyStr && m.deviceId === device)}
  ```

  (Use `keyStr` which is already computed as `laneKeyString(entry.key)` for each lane entry.)

- [ ] **Step 2: Type-check**

  ```bash
  pnpm exec tsc --noEmit
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/timeline/device-section.tsx
  git commit -m "feat(device-section): wire lane OSC editor triggers through DeviceSection"
  ```

---

## Task 8: Thread OSC props through TimelineCanvas

**Files:**
- Modify: `src/components/timeline/timeline-canvas.tsx`

- [ ] **Step 1: Add new props to `TimelineCanvasProps`**

  After `onDeleteNoteTag` in the interface, add:

  ```typescript
  oscMappings: OscMapping[];
  endpoints: SavedEndpoint[];
  onAddOscMapping: (mapping: OscMapping) => void;
  onDeleteOscMapping: (id: string) => void;
  ```

  Add to imports:

  ```typescript
  import type { ..., OscMapping, SavedEndpoint } from "@/lib/types";
  ```

- [ ] **Step 2: Destructure and pass through to DeviceSection**

  Add `oscMappings, endpoints, onAddOscMapping, onDeleteOscMapping` to the destructuring at the top of `TimelineCanvas`.

  In every `<DeviceSection .../>` render, add:

  ```tsx
  oscMappings={oscMappings}
  endpoints={endpoints}
  onAddOscMapping={onAddOscMapping}
  onDeleteOscMapping={onDeleteOscMapping}
  ```

- [ ] **Step 3: Type-check**

  ```bash
  pnpm exec tsc --noEmit
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/timeline/timeline-canvas.tsx
  git commit -m "feat(timeline-canvas): thread OSC mapping props through to DeviceSection"
  ```

---

## Task 9: Wire everything in the Timeline Page

**Files:**
- Modify: `src/app/timeline/page.tsx`

- [ ] **Step 1: Fetch saved endpoints**

  After the existing hooks at the top of `TimelinePage`, add:

  ```typescript
  const [endpoints, setEndpoints] = useState<SavedEndpoint[]>([]);

  useEffect(() => {
    window.electronAPI?.invoke("endpoints:get-all", "sender").then((res) => {
      setEndpoints((res as SavedEndpoint[]) ?? []);
    });
  }, []);
  ```

  Add `SavedEndpoint` to the imports from `@/lib/types`.

- [ ] **Step 2: Add OSC mapping state callbacks**

  After the `deleteNoteTag` callback (around line 330), add:

  ```typescript
  const addOscMapping = useCallback((mapping: OscMapping) => {
    const rec = recorder.recording;
    if (!rec) return;
    recorder.patchRecording({ oscMappings: [...(rec.oscMappings ?? []), mapping] });
  }, [recorder]);

  const deleteOscMapping = useCallback((id: string) => {
    const rec = recorder.recording;
    if (!rec) return;
    recorder.patchRecording({ oscMappings: (rec.oscMappings ?? []).filter((m) => m.id !== id) });
  }, [recorder]);
  ```

  Add `OscMapping` to imports from `@/lib/types`.

- [ ] **Step 3: Add useOscPlayback**

  Add the import:

  ```typescript
  import { useOscPlayback } from "@/hooks/use-osc-playback";
  ```

  After the `audio` hook usage, add:

  ```typescript
  useOscPlayback({
    recording: recorder.recording ?? null,
    playheadMs: playheadDisplayMs,
    isPlaying: audio.isPlaying,
    endpoints,
  });
  ```

- [ ] **Step 4: Pass new props to TimelineCanvas**

  In the `<TimelineCanvas .../>` render, add:

  ```tsx
  oscMappings={recorder.recording?.oscMappings ?? []}
  endpoints={endpoints}
  onAddOscMapping={addOscMapping}
  onDeleteOscMapping={deleteOscMapping}
  ```

- [ ] **Step 5: Type-check**

  ```bash
  pnpm exec tsc --noEmit
  ```

  Expected: zero errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/app/timeline/page.tsx
  git commit -m "feat(timeline): wire OSC mapping state, endpoints fetch, and useOscPlayback into page"
  ```

---

## Task 10: Manual verification

- [ ] **Step 1: Start the app**

  ```bash
  pnpm electron:dev
  ```

- [ ] **Step 2: Verify note group OSC mapping**
  1. Load a recording with MIDI events
  2. Go to Timeline → open a device's note group panel
  3. Hover a note group row — confirm "OSC" button appears
  4. Click OSC → confirm OscMappingEditor opens at correct position
  5. Select a saved sender endpoint, choose Preset = "Unreal Engine", set name = "kick", trigger = "on", click "+ Add Mapping"
  6. Confirm mapping appears in the list with preview `/unreal/trigger/kick`
  7. Press play — in an OSC monitor on the target endpoint, confirm `/unreal/trigger/kick` fires at each note-on for that pitch/velocity

- [ ] **Step 3: Verify Resolume preset**
  1. Add a Resolume mapping with Mode = "clip", Layer = 1, Clip = 3
  2. Confirm preview shows `/composition/layers/1/clips/3/connect`

- [ ] **Step 4: Verify lane OSC mapping**
  1. Hover a CC lane gutter — confirm "OSC" button appears
  2. Click OSC → OscMappingEditor opens with `targetType = "lane"` (no trigger selector visible)
  3. Add a mapping → verify it fires during playback with normalized CC value

- [ ] **Step 5: Verify seek/reset**
  1. Play past a mapped event — confirm it fires once
  2. Seek backward past the same event — confirm it fires again on next playback

- [ ] **Step 6: Verify persistence**
  1. Add a mapping, save the recording (Cmd+S)
  2. Reload the file — confirm the OSC mapping is still present in the note group panel

- [ ] **Step 7: Commit**

  ```bash
  git add -A
  git commit -m "feat(timeline): OSC output mapping — playback integration complete"
  ```
