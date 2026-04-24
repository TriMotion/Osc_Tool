"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useDmx } from "@/hooks/use-dmx";
import { DmxSettings } from "@/components/dmx/dmx-settings";
import { OscTriggerPanel } from "@/components/dmx/osc-trigger-panel";
import { CurveEditor } from "@/components/dmx/curve-editor";
import { SegmentStrip } from "@/components/dmx/segment-strip";
import type { DmxEffect, DmxSegment, CurveDefinition } from "@/lib/dmx-types";

function emptySegment(): DmxSegment {
  return { channels: [1], startValue: 0, endValue: 255, durationMs: 500, curve: { type: "linear" }, holdMs: 0 };
}

function emptyEffect(): DmxEffect {
  return { id: "", name: "New Effect", segments: [emptySegment()], loop: false, velocitySensitive: false };
}

export default function DmxPage() {
  const {
    config, setConfig,
    effects, saveEffect, deleteEffect, triggerEffect,
    setChannel, releaseChannel,
    triggers, saveTrigger, deleteTrigger,
  } = useDmx();

  const [editingEffect, setEditingEffect] = useState<DmxEffect | null>(null);
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState(0);

  const [testChannel, setTestChannel] = useState(1);
  const [testValue, setTestValue] = useState(255);
  const [testHeld, setTestHeld] = useState(false);
  const [cycling, setCycling] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cycleValue = useRef(0);

  useEffect(() => {
    if (!cycling) {
      if (cycleRef.current) {
        clearInterval(cycleRef.current);
        cycleRef.current = null;
      }
      releaseChannel(testChannel);
      return;
    }
    cycleValue.current = 0;
    cycleRef.current = setInterval(() => {
      cycleValue.current = (cycleValue.current + 3) % 256;
      setChannel(testChannel, cycleValue.current);
    }, 23);
    return () => {
      if (cycleRef.current) clearInterval(cycleRef.current);
      releaseChannel(testChannel);
    };
  }, [cycling, testChannel, setChannel, releaseChannel]);

  const selectedSegment = editingEffect?.segments[selectedSegmentIdx] ?? null;

  const startEditEffect = (effect?: DmxEffect) => {
    setEditingEffect(effect ? structuredClone(effect) : emptyEffect());
    setSelectedSegmentIdx(0);
  };

  const updateSegment = useCallback((index: number, updates: Partial<DmxSegment>) => {
    setEditingEffect((prev) => {
      if (!prev) return prev;
      const segments = [...prev.segments];
      segments[index] = { ...segments[index], ...updates };
      return { ...prev, segments };
    });
  }, []);

  const addSegment = useCallback(() => {
    setEditingEffect((prev) => {
      if (!prev) return prev;
      const segments = [...prev.segments, emptySegment()];
      setSelectedSegmentIdx(segments.length - 1);
      return { ...prev, segments };
    });
  }, []);

  const deleteSegment = useCallback((index: number) => {
    setEditingEffect((prev) => {
      if (!prev || prev.segments.length <= 1) return prev;
      const segments = prev.segments.filter((_, i) => i !== index);
      setSelectedSegmentIdx((sel) => Math.min(sel, segments.length - 1));
      return { ...prev, segments };
    });
  }, []);

  const handleSaveEffect = async () => {
    if (!editingEffect) return;
    await saveEffect(editingEffect);
    setEditingEffect(null);
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <h2 className="text-lg font-bold text-white">DMX / sACN</h2>

      <div className="flex gap-6 flex-1 min-h-0 overflow-auto">
        {/* Left column: effects + editor */}
        <div className="flex-1 flex flex-col gap-5 min-w-0">
          {/* Effect list */}
          {!editingEffect && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">Effects</h3>
                <button
                  className="text-xs text-amber-500 hover:text-amber-400"
                  onClick={() => startEditEffect()}
                >
                  + New Effect
                </button>
              </div>
              {effects.length === 0 && (
                <p className="text-xs text-gray-600">No effects yet. Create one to get started.</p>
              )}
              <div className="flex flex-col gap-1.5">
                {effects.map((eff) => (
                  <div
                    key={eff.id}
                    className="flex items-center justify-between bg-surface-lighter rounded-lg px-4 py-2.5 border border-white/5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-white font-medium truncate">{eff.name}</div>
                      <div className="text-[10px] text-gray-500">
                        {eff.segments.length} segment{eff.segments.length !== 1 ? "s" : ""}
                        {eff.loop ? " · loop" : ""}
                        {eff.velocitySensitive ? " · velocity" : ""}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        className="text-[10px] text-amber-500/80 hover:text-amber-400"
                        onClick={() => triggerEffect(eff.id)}
                      >
                        Test
                      </button>
                      <button
                        className="text-[10px] text-gray-400 hover:text-white"
                        onClick={() => startEditEffect(eff)}
                      >
                        Edit
                      </button>
                      <button
                        className="text-[10px] text-red-400/60 hover:text-red-400"
                        onClick={() => deleteEffect(eff.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Effect editor */}
          {editingEffect && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <button
                  className="text-xs text-gray-500 hover:text-gray-300"
                  onClick={() => setEditingEffect(null)}
                >
                  ← Back
                </button>
                <h3 className="text-sm font-semibold text-white">
                  {editingEffect.id ? "Edit Effect" : "New Effect"}
                </h3>
              </div>

              <div>
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Name</label>
                <input
                  className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                  value={editingEffect.name}
                  onChange={(e) => setEditingEffect({ ...editingEffect, name: e.target.value })}
                />
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingEffect.loop}
                    onChange={(e) => setEditingEffect({ ...editingEffect, loop: e.target.checked })}
                    className="accent-amber-500"
                  />
                  <span className="text-xs text-gray-300">Loop</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingEffect.velocitySensitive}
                    onChange={(e) => setEditingEffect({ ...editingEffect, velocitySensitive: e.target.checked })}
                    className="accent-amber-500"
                  />
                  <span className="text-xs text-gray-300">Velocity Sensitive</span>
                </label>
              </div>

              <SegmentStrip
                segments={editingEffect.segments}
                selectedIndex={selectedSegmentIdx}
                onSelect={setSelectedSegmentIdx}
                onAdd={addSegment}
                onDelete={deleteSegment}
              />

              {selectedSegment && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <label className="block text-[10px] uppercase text-gray-500 mb-1">Channels (comma-separated)</label>
                    <input
                      className="w-full bg-surface border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-amber-500/50"
                      value={selectedSegment.channels.join(", ")}
                      onChange={(e) => {
                        const channels = e.target.value.split(",").map((s) => parseInt(s.trim())).filter((n) => n >= 1 && n <= 512);
                        if (channels.length > 0) updateSegment(selectedSegmentIdx, { channels });
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase text-gray-500 mb-1">Start Value</label>
                      <input
                        type="number" min={0} max={255}
                        className="w-full bg-surface border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500/50"
                        value={selectedSegment.startValue}
                        onChange={(e) => updateSegment(selectedSegmentIdx, { startValue: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase text-gray-500 mb-1">End Value</label>
                      <input
                        type="number" min={0} max={255}
                        className="w-full bg-surface border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500/50"
                        value={selectedSegment.endValue}
                        onChange={(e) => updateSegment(selectedSegmentIdx, { endValue: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-gray-500 mb-1">Duration (ms)</label>
                    <input
                      type="number" min={0}
                      className="w-full bg-surface border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500/50"
                      value={selectedSegment.durationMs}
                      onChange={(e) => updateSegment(selectedSegmentIdx, { durationMs: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-gray-500 mb-1">Hold (ms)</label>
                    <input
                      type="number" min={0}
                      className="w-full bg-surface border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500/50"
                      value={selectedSegment.holdMs}
                      onChange={(e) => updateSegment(selectedSegmentIdx, { holdMs: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] uppercase text-gray-500 mb-1">Curve</label>
                    <CurveEditor
                      curve={selectedSegment.curve}
                      onChange={(curve) => updateSegment(selectedSegmentIdx, { curve })}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium"
                  onClick={handleSaveEffect}
                >
                  Save Effect
                </button>
                <button
                  className="px-4 py-1.5 rounded-lg bg-surface border border-white/10 text-gray-400 hover:text-gray-200 text-sm"
                  onClick={() => setEditingEffect(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}
        </div>

        {/* Right column: settings + OSC triggers */}
        <div className="w-80 shrink-0 flex flex-col gap-6">
          <section className="bg-surface-lighter rounded-xl border border-white/5 p-4">
            <DmxSettings config={config} onSave={setConfig} />
          </section>

          <section className="bg-surface-lighter rounded-xl border border-white/5 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Test Output</h3>
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Channel</label>
                <input
                  type="number" min={1} max={512}
                  className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
                  value={testChannel}
                  onChange={(e) => setTestChannel(Math.max(1, Math.min(512, parseInt(e.target.value) || 1)))}
                />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Value</label>
                <input
                  type="number" min={0} max={255}
                  className="w-full bg-[#1a1a2e] border border-white/10 rounded px-2 py-1 text-sm text-white"
                  value={testValue}
                  onChange={(e) => setTestValue(Math.max(0, Math.min(255, parseInt(e.target.value) || 0)))}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white active:scale-95 transition-transform"
                onClick={() => {
                  setChannel(testChannel, testValue);
                  if (flashTimer.current) clearTimeout(flashTimer.current);
                  flashTimer.current = setTimeout(() => {
                    releaseChannel(testChannel);
                    flashTimer.current = null;
                  }, 500);
                }}
              >
                Flash (500ms)
              </button>
              <button
                className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                  testHeld
                    ? "bg-red-500/20 border border-red-500/40 text-red-400"
                    : "bg-surface border border-white/10 text-gray-400 hover:text-gray-200"
                }`}
                onClick={() => {
                  if (testHeld) {
                    releaseChannel(testChannel);
                    setTestHeld(false);
                  } else {
                    setChannel(testChannel, testValue);
                    setTestHeld(true);
                  }
                }}
              >
                {testHeld ? "Release" : "Hold"}
              </button>
              <button
                className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                  cycling
                    ? "bg-green-500/20 border border-green-500/40 text-green-400"
                    : "bg-surface border border-white/10 text-gray-400 hover:text-gray-200"
                }`}
                onClick={() => {
                  if (cycling) {
                    setCycling(false);
                  } else {
                    setTestHeld(false);
                    setCycling(true);
                  }
                }}
              >
                {cycling ? "Stop Cycle" : "Cycle"}
              </button>
            </div>
            {!config.enabled && (
              <p className="text-[9px] text-amber-500/70 mt-2">sACN output is disabled — enable it above to send signals</p>
            )}
          </section>

          <section className="bg-surface-lighter rounded-xl border border-white/5 p-4">
            <OscTriggerPanel
              triggers={triggers}
              effects={effects}
              onSave={saveTrigger}
              onDelete={deleteTrigger}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
