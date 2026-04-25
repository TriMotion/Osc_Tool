"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { OscInput } from "@/components/osc-input";
import { EndpointManager } from "@/components/endpoint-manager";
import { useOscSender, useEndpoints } from "@/hooks/use-osc";
import { useDmx } from "@/hooks/use-dmx";
import { useOscEffects } from "@/hooks/use-osc-effects";
import { DmxSettings } from "@/components/dmx/dmx-settings";
import { OscTriggerPanel } from "@/components/dmx/osc-trigger-panel";
import { CurveEditor } from "@/components/dmx/curve-editor";
import { SegmentStrip } from "@/components/dmx/segment-strip";
import type { OscArg, SavedEndpoint } from "@/lib/types";
import type { DmxEffect, DmxSegment } from "@/lib/dmx-types";
import type { OscEffect, OscEffectSegment } from "@/lib/osc-effect-types";

// ─── Shared helpers ────────────────────────────────────────────────────────────

interface SentEntry {
  address: string;
  args: OscArg[];
  timestamp: number;
}

interface FileEntry {
  address: string;
  args: OscArg[];
}

function parseOscLine(line: string): FileEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/(\/\S+)/);
  if (!match) return null;
  const address = match[1];
  const afterAddress = trimmed.slice(trimmed.indexOf(address) + address.length).trim();
  const parts = afterAddress ? afterAddress.split(/\s+/) : [];
  const args: OscArg[] = parts.map((v) => {
    const num = Number(v);
    if (!isNaN(num)) {
      return Number.isInteger(num)
        ? { type: "i" as const, value: num }
        : { type: "f" as const, value: num };
    }
    if (v === "true") return { type: "T" as const, value: true };
    if (v === "false") return { type: "F" as const, value: false };
    return { type: "s" as const, value: v };
  });
  if (args.length === 0) args.push({ type: "f", value: 1 });
  return { address, args };
}

function emptySegment(): DmxSegment {
  return { channels: [1], startValue: 0, endValue: 255, durationMs: 500, curve: { type: "linear" }, holdMs: 0 };
}

function emptyEffect(): DmxEffect {
  return { id: "", name: "New Effect", segments: [emptySegment()], loop: false, velocitySensitive: false };
}

function emptyOscSegment(): OscEffectSegment {
  return { startValue: 0, endValue: 1, durationMs: 500, curve: { type: "linear" }, holdMs: 0 };
}

function emptyOscEffect(): OscEffect {
  return {
    id: "",
    name: "New OSC Effect",
    segments: [emptyOscSegment()],
    loop: false,
    velocitySensitive: false,
    mode: "one-shot",
    tickRateHz: 40,
  };
}

// ─── Sender Panel ──────────────────────────────────────────────────────────────

function SenderPanel() {
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<SentEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [repeating, setRepeating] = useState(false);
  const repeatRef = useRef<NodeJS.Timeout | null>(null);
  const lastSentRef = useRef<{ address: string; args: OscArg[] } | null>(null);
  const prevEndpointIdsRef = useRef<Set<string>>(new Set());
  const { send } = useOscSender();
  const { endpoints, add, update, remove } = useEndpoints("sender");

  useEffect(() => {
    const currentIds = new Set(endpoints.map((ep) => ep.id));
    let changed = false;
    const next = new Set(activeIds);
    for (const id of currentIds) {
      if (!prevEndpointIdsRef.current.has(id)) {
        next.add(id);
        changed = true;
      }
    }
    prevEndpointIdsRef.current = currentIds;
    if (changed) setActiveIds(next);
  }, [endpoints]);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loopIndex, setLoopIndex] = useState(0);
  const loopIndexRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeEndpoints = endpoints.filter((ep) => activeIds.has(ep.id));

  const handleSend = useCallback(async (address: string, args: OscArg[]) => {
    if (activeEndpoints.length === 0) {
      setError("No active senders");
      return;
    }
    try {
      setError(null);
      await Promise.all(
        activeEndpoints.map((ep) => send({ host: ep.host, port: ep.port }, address, args))
      );
      lastSentRef.current = { address, args };
      setHistory((prev) => [
        { address, args, timestamp: Date.now() },
        ...prev.slice(0, 19),
      ]);
    } catch (err) {
      setError(String(err));
    }
  }, [activeEndpoints, send]);

  useEffect(() => {
    if (!repeating) {
      if (repeatRef.current) clearInterval(repeatRef.current);
      repeatRef.current = null;
      return;
    }
    if (fileEntries.length > 0) {
      loopIndexRef.current = 0;
      setLoopIndex(0);
      repeatRef.current = setInterval(() => {
        const entry = fileEntries[loopIndexRef.current];
        if (entry) handleSend(entry.address, entry.args);
        loopIndexRef.current = (loopIndexRef.current + 1) % fileEntries.length;
        setLoopIndex(loopIndexRef.current);
      }, 1000);
    } else if (lastSentRef.current) {
      const { address, args } = lastSentRef.current;
      repeatRef.current = setInterval(() => {
        handleSend(address, args);
      }, 1000);
    }
    return () => {
      if (repeatRef.current) clearInterval(repeatRef.current);
    };
  }, [repeating, handleSend, fileEntries]);

  const handleToggle = (ep: SavedEndpoint) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(ep.id)) next.delete(ep.id);
      else next.add(ep.id);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    setActiveIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    await remove(id);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split("\n");
    const entries = lines.map(parseOscLine).filter((e): e is FileEntry => e !== null);
    setFileEntries(entries);
    setFileName(file.name);
    setRepeating(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClearFile = () => {
    setFileEntries([]);
    setFileName(null);
    setRepeating(false);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
  };

  const canRepeat = (fileEntries.length > 0 || !!lastSentRef.current) && activeEndpoints.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <EndpointManager
        type="sender"
        endpoints={endpoints}
        activeIds={activeIds}
        onAdd={add}
        onUpdate={update}
        onDelete={handleDelete}
        onToggle={handleToggle}
        accent="output"
      />

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {activeEndpoints.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
          <div className="w-1.5 h-1.5 rounded-full bg-output" />
          Sending to
          {activeEndpoints.map((ep, i) => (
            <span key={ep.id}>
              <span className="text-output font-medium">{ep.name}</span>
              <span className="text-gray-600 font-mono ml-1">{ep.host}:{ep.port}</span>
              {i < activeEndpoints.length - 1 && <span className="text-gray-700 mx-1">·</span>}
            </span>
          ))}
        </div>
      )}

      <div className="bg-panel rounded-lg border border-white/5 p-4">
        <OscInput onSend={handleSend} />
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5">
          <button
            onClick={() => setRepeating(!repeating)}
            disabled={!canRepeat}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              repeating
                ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                : "bg-elevated border border-white/10 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            }`}
          >
            {repeating ? "Stop" : fileEntries.length > 0 ? `Loop ${fileEntries.length} addresses` : "Repeat every 1s"}
          </button>
          {repeating && (
            <span className="text-xs text-yellow-400/70 animate-pulse">
              {fileEntries.length > 0
                ? `${loopIndex + 1}/${fileEntries.length}: ${fileEntries[loopIndex]?.address}`
                : `Sending ${lastSentRef.current?.address}`}
            </span>
          )}
        </div>
      </div>
      <div className="bg-panel rounded-lg border border-white/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400">Address List</h3>
          <div className="flex items-center gap-2">
            {fileName && (
              <>
                <span className="text-xs text-gray-500">{fileName}</span>
                <button onClick={handleClearFile} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
                  clear
                </button>
              </>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-xs bg-elevated border border-white/10 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
            >
              Upload .txt / .md
            </button>
            <input ref={fileInputRef} type="file" accept=".txt,.md,.text" onChange={handleFileUpload} className="hidden" />
          </div>
        </div>
        {fileEntries.length > 0 ? (
          <div className="flex flex-col gap-1 max-h-[40vh] overflow-auto">
            {fileEntries.map((entry, i) => (
              <button
                key={`${entry.address}-${i}`}
                onClick={() => handleSend(entry.address, entry.args)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-mono text-left transition-colors ${
                  repeating && loopIndex === i
                    ? "bg-yellow-500/10 border border-yellow-500/20"
                    : "bg-elevated border border-white/5 hover:border-output/30"
                }`}
              >
                <span className="text-gray-600 w-6 text-right">{i + 1}</span>
                <span className="text-output" title={entry.address}>{entry.address}</span>
                <span className="text-gray-400">{entry.args.map((a) => `${a.value}`).join(", ")}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-600 text-xs py-6">
            Upload a file with OSC addresses, one per line.<br />
            Format: <span className="text-gray-500 font-mono">/address value</span> or just <span className="text-gray-500 font-mono">/address</span>
          </div>
        )}
      </div>
      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-2">Recent</h3>
          <div className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {history.map((entry, i) => (
                <motion.button
                  key={`${entry.timestamp}-${i}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => handleSend(entry.address, entry.args)}
                  className="flex items-center gap-3 bg-elevated border border-white/5 rounded-lg px-3 py-2 text-xs font-mono hover:border-output/30 transition-colors text-left"
                >
                  <span className="text-gray-500">{formatTime(entry.timestamp)}</span>
                  <span className="text-output" title={entry.address}>{entry.address}</span>
                  <span className="text-gray-400">{entry.args.map((a) => `${a.value}`).join(", ")}</span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DMX Panel ─────────────────────────────────────────────────────────────────

function DmxPanel() {
  const {
    config, setConfig,
    effects, saveEffect, deleteEffect, triggerEffect,
    setChannel, releaseChannel,
    triggers, saveTrigger, deleteTrigger,
  } = useDmx();

  const [editingEffect, setEditingEffect] = useState<DmxEffect | null>(null);
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState(0);

  const { effects: oscEffects, saveEffect: saveOscEffect, deleteEffect: deleteOscEffect } = useOscEffects();
  const [editingOscEffect, setEditingOscEffect] = useState<OscEffect | null>(null);
  const [selectedOscSegIdx, setSelectedOscSegIdx] = useState(0);
  const [editingOscReleaseSegment, setEditingOscReleaseSegment] = useState(false);

  const [testChannel, setTestChannel] = useState(1);
  const [testValue, setTestValue] = useState(255);
  const [testHeld, setTestHeld] = useState(false);
  const [cycling, setCycling] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cycleValue = useRef(0);

  useEffect(() => {
    if (!cycling) {
      if (cycleRef.current) { clearInterval(cycleRef.current); cycleRef.current = null; }
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

  const startEditOscEffect = (effect?: OscEffect) => {
    setEditingOscEffect(effect ? structuredClone(effect) : emptyOscEffect());
    setSelectedOscSegIdx(0);
    setEditingOscReleaseSegment(false);
  };

  const updateOscSegment = (idx: number, patch: Partial<OscEffectSegment>) => {
    setEditingOscEffect((prev) => {
      if (!prev) return prev;
      const segs = [...prev.segments];
      segs[idx] = { ...segs[idx], ...patch };
      return { ...prev, segments: segs };
    });
  };

  const addOscSegment = () => {
    setEditingOscEffect((prev) => {
      if (!prev) return prev;
      const segments = [...prev.segments, emptyOscSegment()];
      setSelectedOscSegIdx(segments.length - 1);
      return { ...prev, segments };
    });
  };

  const deleteOscSegment = (idx: number) => {
    setEditingOscEffect((prev) => {
      if (!prev || prev.segments.length <= 1) return prev;
      const segs = prev.segments.filter((_, i) => i !== idx);
      setSelectedOscSegIdx((sel) => Math.min(sel, segs.length - 1));
      return { ...prev, segments: segs };
    });
  };

  const handleSaveOscEffect = async () => {
    if (!editingOscEffect) return;
    await saveOscEffect(editingOscEffect);
    setEditingOscEffect(null);
  };

  const selectedOscSeg = editingOscEffect
    ? (editingOscReleaseSegment
        ? (editingOscEffect.releaseSegment ?? null)
        : (editingOscEffect.segments[selectedOscSegIdx] ?? null))
    : null;

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex gap-6 flex-1 min-h-0 overflow-auto">
        {/* Left column: effects + editor */}
        <div className="flex-1 flex flex-col gap-5 min-w-0">
          {/* Effect list */}
          {!editingEffect && !editingOscEffect && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">Effects</h3>
                <button className="text-xs text-output hover:text-output/80" onClick={() => startEditEffect()}>
                  + New Effect
                </button>
              </div>
              {effects.length === 0 && (
                <p className="text-xs text-gray-600">No effects yet. Create one to get started.</p>
              )}
              <div className="flex flex-col gap-1.5">
                {effects.map((eff) => (
                  <div key={eff.id} className="flex items-center justify-between bg-elevated rounded-lg px-4 py-2.5 border border-white/5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-medium truncate" title={eff.name}>{eff.name}</span>
                        {eff.loop && <span className="text-[9px] px-1.5 py-0.5 rounded bg-output/10 text-output/80">loop</span>}
                        {eff.velocitySensitive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400/80">velocity</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {eff.segments.map((seg, i) => {
                          const chLabel = seg.channels.length <= 3
                            ? seg.channels.join(", ")
                            : `${seg.channels[0]}–${seg.channels[seg.channels.length - 1]}`;
                          return (
                            <span key={i} className="text-[10px] text-gray-500 font-mono">
                              <span className="text-gray-400">ch{chLabel}</span>
                              {" "}{seg.startValue}→{seg.endValue}
                              {" "}{seg.durationMs}ms
                              {seg.holdMs > 0 && <span> +{seg.holdMs}ms</span>}
                              {" "}<span className="text-gray-600">{seg.curve.type}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button className="text-[10px] text-output/80 hover:text-output" onClick={() => triggerEffect(eff.id)}>Test</button>
                      <button className="text-[10px] text-gray-400 hover:text-white" onClick={() => startEditEffect(eff)}>Edit</button>
                      <button
                        className="text-[10px] text-gray-400 hover:text-white"
                        onClick={() => {
                          const clone: DmxEffect = {
                            ...structuredClone(eff),
                            id: crypto.randomUUID(),
                            name: `${eff.name} (copy)`,
                          };
                          saveEffect(clone);
                        }}
                      >
                        Duplicate
                      </button>
                      <button className="text-[10px] text-red-400/60 hover:text-red-400" onClick={() => deleteEffect(eff.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* OSC Effect list */}
          {!editingEffect && !editingOscEffect && (
            <section className="mt-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">OSC Effects</h3>
                <button className="text-xs text-blue-400 hover:text-blue-300" onClick={() => startEditOscEffect()}>
                  + New OSC Effect
                </button>
              </div>
              {oscEffects.length === 0 && (
                <p className="text-xs text-gray-600">No OSC effects yet. Create one to get started.</p>
              )}
              <div className="flex flex-col gap-1.5">
                {oscEffects.map((eff) => (
                  <div key={eff.id} className="flex items-center justify-between bg-elevated rounded-lg px-4 py-2.5 border border-white/5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-medium truncate" title={eff.name}>{eff.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400/80">{eff.mode}</span>
                        {eff.loop && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400/80">loop</span>}
                        {eff.velocitySensitive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400/80">velocity</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {eff.segments.map((seg, i) => (
                          <span key={i} className="text-[10px] text-gray-500 font-mono">
                            {seg.startValue}→{seg.endValue}
                            {" "}{seg.durationMs}ms
                            {seg.holdMs > 0 && <span> +{seg.holdMs}ms</span>}
                            {" "}<span className="text-gray-600">{seg.curve.type}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button className="text-[10px] text-gray-400 hover:text-white" onClick={() => startEditOscEffect(eff)}>Edit</button>
                      <button
                        className="text-[10px] text-gray-400 hover:text-white"
                        onClick={() => {
                          const clone: OscEffect = {
                            ...structuredClone(eff),
                            id: crypto.randomUUID(),
                            name: `${eff.name} (copy)`,
                          };
                          saveOscEffect(clone);
                        }}
                      >
                        Duplicate
                      </button>
                      <button className="text-[10px] text-red-400/60 hover:text-red-400" onClick={() => deleteOscEffect(eff.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* OSC Effect editor */}
          {editingOscEffect && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setEditingOscEffect(null)}>← Back</button>
                <h3 className="text-sm font-semibold text-white">{editingOscEffect.id ? "Edit OSC Effect" : "New OSC Effect"}</h3>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Name</label>
                <input
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/40"
                  value={editingOscEffect.name}
                  onChange={(e) => setEditingOscEffect({ ...editingOscEffect, name: e.target.value })}
                />
              </div>
              <div className="flex gap-4 flex-wrap">
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 mb-1">Mode</label>
                  <select
                    className="bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/40"
                    value={editingOscEffect.mode}
                    onChange={(e) => setEditingOscEffect({ ...editingOscEffect, mode: e.target.value as "one-shot" | "sustained" })}
                  >
                    <option value="one-shot">One-shot</option>
                    <option value="sustained">Sustained</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-gray-500 mb-1">Tick Rate (Hz)</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    className="w-24 bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/40"
                    value={editingOscEffect.tickRateHz}
                    onChange={(e) => setEditingOscEffect({ ...editingOscEffect, tickRateHz: Math.max(1, Math.min(120, parseInt(e.target.value) || 40)) })}
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer self-end pb-1.5">
                  <input
                    type="checkbox"
                    checked={editingOscEffect.loop}
                    onChange={(e) => setEditingOscEffect({ ...editingOscEffect, loop: e.target.checked })}
                    className="accent-blue-500"
                  />
                  <span className="text-xs text-gray-300">Loop</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer self-end pb-1.5">
                  <input
                    type="checkbox"
                    checked={editingOscEffect.velocitySensitive}
                    onChange={(e) => setEditingOscEffect({ ...editingOscEffect, velocitySensitive: e.target.checked })}
                    className="accent-blue-500"
                  />
                  <span className="text-xs text-gray-300">Velocity Sensitive</span>
                </label>
              </div>

              {/* Segment selector tabs */}
              <div>
                <div className="flex gap-1 mb-2">
                  <button
                    className={`text-[10px] px-2.5 py-1 rounded transition-colors ${!editingOscReleaseSegment ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" : "text-gray-500 hover:text-gray-300"}`}
                    onClick={() => setEditingOscReleaseSegment(false)}
                  >
                    Attack Segments
                  </button>
                  {editingOscEffect.mode === "sustained" && (
                    <button
                      className={`text-[10px] px-2.5 py-1 rounded transition-colors ${editingOscReleaseSegment ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" : "text-gray-500 hover:text-gray-300"}`}
                      onClick={() => {
                        if (!editingOscEffect.releaseSegment) {
                          setEditingOscEffect({ ...editingOscEffect, releaseSegment: emptyOscSegment() });
                        }
                        setEditingOscReleaseSegment(true);
                      }}
                    >
                      Release Segment
                    </button>
                  )}
                </div>

                {!editingOscReleaseSegment && (
                  <div>
                    <div className="text-[10px] uppercase text-gray-500 mb-1">Segments</div>
                    <div className="flex gap-0.5 bg-[#0a0a1a] rounded p-1 border border-white/5">
                      {editingOscEffect.segments.map((seg, i) => {
                        const total = editingOscEffect.segments.reduce((s, s2) => s + Math.max(1, s2.durationMs + s2.holdMs), 0);
                        const flex = Math.max(1, seg.durationMs + seg.holdMs) / Math.max(1, total);
                        const selected = i === selectedOscSegIdx;
                        return (
                          <button
                            key={i}
                            className="rounded px-2 py-1.5 text-left border min-w-0"
                            style={{
                              flex,
                              background: selected ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.02)",
                              borderColor: selected ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.05)",
                            }}
                            onClick={() => setSelectedOscSegIdx(i)}
                          >
                            <div className="text-[10px] font-bold truncate" style={{ color: selected ? "#93c5fd" : "#9ca3af" }}>
                              {seg.startValue}→{seg.endValue}
                            </div>
                            <div className="text-[9px] text-gray-600 truncate">
                              {seg.durationMs}ms{seg.holdMs > 0 ? ` + ${seg.holdMs}ms` : ""}
                            </div>
                          </button>
                        );
                      })}
                      <button
                        className="flex items-center justify-center rounded border border-dashed border-white/10 px-2 shrink-0"
                        onClick={addOscSegment}
                      >
                        <span className="text-gray-500 text-sm">+</span>
                      </button>
                    </div>
                    {editingOscEffect.segments.length > 1 && (
                      <button
                        className="text-[9px] text-red-400/60 hover:text-red-400 mt-1"
                        onClick={() => deleteOscSegment(selectedOscSegIdx)}
                      >
                        Delete segment {selectedOscSegIdx + 1}
                      </button>
                    )}
                  </div>
                )}

                {editingOscReleaseSegment && editingOscEffect.releaseSegment && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500">Single release segment</span>
                    <button
                      className="text-[9px] text-red-400/60 hover:text-red-400"
                      onClick={() => {
                        const { releaseSegment: _, ...rest } = editingOscEffect;
                        setEditingOscEffect(rest as OscEffect);
                        setEditingOscReleaseSegment(false);
                      }}
                    >
                      Remove release segment
                    </button>
                  </div>
                )}
              </div>

              {/* Per-segment fields */}
              {selectedOscSeg && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase text-gray-500 mb-1">Start Value</label>
                      <input
                        type="number"
                        step={0.01}
                        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/40"
                        value={selectedOscSeg.startValue}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          if (editingOscReleaseSegment) {
                            setEditingOscEffect((prev) => prev ? { ...prev, releaseSegment: { ...prev.releaseSegment!, startValue: v } } : prev);
                          } else {
                            updateOscSegment(selectedOscSegIdx, { startValue: v });
                          }
                        }}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase text-gray-500 mb-1">End Value</label>
                      <input
                        type="number"
                        step={0.01}
                        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/40"
                        value={selectedOscSeg.endValue}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          if (editingOscReleaseSegment) {
                            setEditingOscEffect((prev) => prev ? { ...prev, releaseSegment: { ...prev.releaseSegment!, endValue: v } } : prev);
                          } else {
                            updateOscSegment(selectedOscSegIdx, { endValue: v });
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase text-gray-500 mb-1">Duration (ms)</label>
                      <input
                        type="number"
                        min={0}
                        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/40"
                        value={selectedOscSeg.durationMs}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 0;
                          if (editingOscReleaseSegment) {
                            setEditingOscEffect((prev) => prev ? { ...prev, releaseSegment: { ...prev.releaseSegment!, durationMs: v } } : prev);
                          } else {
                            updateOscSegment(selectedOscSegIdx, { durationMs: v });
                          }
                        }}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase text-gray-500 mb-1">Hold (ms)</label>
                      <input
                        type="number"
                        min={0}
                        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/40"
                        value={selectedOscSeg.holdMs}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 0;
                          if (editingOscReleaseSegment) {
                            setEditingOscEffect((prev) => prev ? { ...prev, releaseSegment: { ...prev.releaseSegment!, holdMs: v } } : prev);
                          } else {
                            updateOscSegment(selectedOscSegIdx, { holdMs: v });
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] uppercase text-gray-500 mb-1">Curve</label>
                    <CurveEditor
                      curve={selectedOscSeg.curve}
                      onChange={(curve) => {
                        if (editingOscReleaseSegment) {
                          setEditingOscEffect((prev) => prev ? { ...prev, releaseSegment: { ...prev.releaseSegment!, curve } } : prev);
                        } else {
                          updateOscSegment(selectedOscSegIdx, { curve });
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  className="px-4 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-black text-sm font-medium"
                  onClick={handleSaveOscEffect}
                >
                  Save Effect
                </button>
                <button
                  className="px-4 py-1.5 rounded-lg bg-black border border-white/10 text-gray-400 hover:text-gray-200 text-sm"
                  onClick={() => setEditingOscEffect(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

          {/* Effect editor */}
          {editingEffect && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setEditingEffect(null)}>← Back</button>
                <h3 className="text-sm font-semibold text-white">{editingEffect.id ? "Edit Effect" : "New Effect"}</h3>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Name</label>
                <input
                  className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-output/18"
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
                    className="accent-output"
                  />
                  <span className="text-xs text-gray-300">Loop</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingEffect.velocitySensitive}
                    onChange={(e) => setEditingEffect({ ...editingEffect, velocitySensitive: e.target.checked })}
                    className="accent-output"
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
                      className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-output/18"
                      value={selectedSegment.channels.join(", ")}
                      onChange={(e) => {
                        const channels = e.target.value
                          .split(",")
                          .map((s) => parseInt(s.trim()))
                          .filter((n) => n >= 1 && n <= 512);
                        if (channels.length > 0) updateSegment(selectedSegmentIdx, { channels });
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase text-gray-500 mb-1">Start Value</label>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-output/18"
                        value={selectedSegment.startValue}
                        onChange={(e) => updateSegment(selectedSegmentIdx, { startValue: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] uppercase text-gray-500 mb-1">End Value</label>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-output/18"
                        value={selectedSegment.endValue}
                        onChange={(e) => updateSegment(selectedSegmentIdx, { endValue: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-gray-500 mb-1">Duration (ms)</label>
                    <input
                      type="number"
                      min={0}
                      className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-output/18"
                      value={selectedSegment.durationMs}
                      onChange={(e) => updateSegment(selectedSegmentIdx, { durationMs: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-gray-500 mb-1">Hold (ms)</label>
                    <input
                      type="number"
                      min={0}
                      className="w-full bg-black border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-output/18"
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
                  className="px-4 py-1.5 rounded-lg bg-output hover:bg-output-dim text-black text-sm font-medium"
                  onClick={handleSaveEffect}
                >
                  Save Effect
                </button>
                <button
                  className="px-4 py-1.5 rounded-lg bg-black border border-white/10 text-gray-400 hover:text-gray-200 text-sm"
                  onClick={() => setEditingEffect(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}
        </div>

        {/* Right column: settings + test + triggers */}
        <div className="w-80 shrink-0 flex flex-col gap-6">
          <section className="bg-elevated rounded-lg border border-white/5 p-4">
            <DmxSettings config={config} onSave={setConfig} />
          </section>
          <section className="bg-elevated rounded-lg border border-white/5 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Test Output</h3>
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Channel</label>
                <input
                  type="number"
                  min={1}
                  max={512}
                  className="w-full bg-black border border-white/10 rounded px-2 py-1 text-sm text-white"
                  value={testChannel}
                  onChange={(e) => setTestChannel(Math.max(1, Math.min(512, parseInt(e.target.value) || 1)))}
                />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] uppercase text-gray-500 mb-1">Value</label>
                <input
                  type="number"
                  min={0}
                  max={255}
                  className="w-full bg-black border border-white/10 rounded px-2 py-1 text-sm text-white"
                  value={testValue}
                  onChange={(e) => setTestValue(Math.max(0, Math.min(255, parseInt(e.target.value) || 0)))}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 px-3 py-1.5 rounded text-xs font-medium bg-output hover:bg-output-dim text-black active:scale-95 transition-transform"
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
                    : "bg-black border border-white/10 text-gray-400 hover:text-gray-200"
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
                    : "bg-black border border-white/10 text-gray-400 hover:text-gray-200"
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
              <p className="text-[9px] text-output/70 mt-2">sACN output is disabled — enable it above to send signals</p>
            )}
          </section>
          <section className="bg-elevated rounded-lg border border-white/5 p-4">
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

// ─── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "sender", label: "OSC Sender" },
  { id: "dmx",    label: "DMX" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function OutputPage() {
  const [activeTab, setActiveTab] = useState<TabId>("sender");

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-white/5 mb-6">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive ? "text-output" : "text-[#444] hover:text-[#666]"
              }`}
            >
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId="output-tab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-output rounded-full"
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {activeTab === "sender" ? <SenderPanel /> : <DmxPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
