"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { useMidiControl, useMidiConfig, useMidiEvents } from "@/hooks/use-midi";
import { useEndpoints } from "@/hooks/use-osc";
import type { MidiEvent, MidiMappingRule } from "@/lib/types";

// crypto.randomUUID() is available as a Web Crypto API in modern browsers — no import needed

const MIDI_TYPES = ["noteon", "noteoff", "cc", "pitch", "aftertouch", "program"] as const;

function formatMidi(evt: MidiEvent["midi"]): string {
  switch (evt.type) {
    case "noteon":  return `NoteOn  ch${evt.channel} #${evt.data1} vel=${evt.data2}`;
    case "noteoff": return `NoteOff ch${evt.channel} #${evt.data1} vel=${evt.data2}`;
    case "cc":      return `CC      ch${evt.channel} #${evt.data1} → ${evt.data2}`;
    case "pitch":   return `Pitch   ch${evt.channel} → ${((evt.data2 << 7) | evt.data1)}`;
    case "aftertouch": return `AT    ch${evt.channel} #${evt.data1} p=${evt.data2}`;
    case "program": return `Prog    ch${evt.channel} → ${evt.data1}`;
  }
}

export default function MidiPage() {
  const { running, devices, start, stop, refreshDevices } = useMidiControl();
  const { rules, deviceFilters, target, saveRules, saveDeviceFilters, saveTarget } = useMidiConfig();
  const { endpoints } = useEndpoints("sender");

  const [events, setEvents] = useState<MidiEvent[]>([]);
  const [hostInput, setHostInput] = useState(target.host);
  const [portInput, setPortInput] = useState(String(target.port));
  const [error, setError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<Omit<MidiMappingRule, "id">>({
    type: "cc",
    address: "",
    argType: "f",
  });

  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  // Sync host/port inputs when target loads from store
  const targetSynced = useRef(false);
  useEffect(() => {
    if (targetSynced.current) return;
    if (target.host !== "127.0.0.1" || target.port !== 8000) {
      setHostInput(target.host);
      setPortInput(String(target.port));
      targetSynced.current = true;
    }
  }, [target.host, target.port]);

  useMidiEvents(
    useCallback((incoming: MidiEvent[]) => {
      if (pausedRef.current) return;
      setEvents((prev) => [...prev, ...incoming].slice(-500));
    }, [])
  );

  const handleStart = async () => {
    setError(null);
    try {
      await refreshDevices();
      await start();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleStop = async () => {
    await stop();
  };

  const handleTargetBlur = async () => {
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1 || port > 65535) return;
    await saveTarget({ host: hostInput, port });
  };

  const toggleDevice = async (name: string) => {
    const next = deviceFilters.includes(name)
      ? deviceFilters.filter((d) => d !== name)
      : [...deviceFilters, name];
    await saveDeviceFilters(next);
  };

  const addRule = async () => {
    if (!newRule.address.trim()) return;
    const rule: MidiMappingRule = { ...newRule, id: crypto.randomUUID() };
    await saveRules([...rules, rule]);
    setNewRule({ type: "cc", address: "", argType: "f" });
  };

  const removeRule = async (id: string) => {
    await saveRules(rules.filter((r) => r.id !== id));
  };

  const selectEndpoint = async (host: string, port: number) => {
    setHostInput(host);
    setPortInput(String(port));
    await saveTarget({ host, port });
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">MIDI Bridge</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {running ? "Bridge running — MIDI is converting to OSC" : "Bridge stopped"}
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={running ? handleStop : handleStart}
          className={`px-4 py-2 font-medium rounded-lg text-sm transition-colors ${
            running
              ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
              : "bg-accent text-surface hover:bg-accent-dim"
          }`}
        >
          {running ? "Stop Bridge" : "Start Bridge"}
        </motion.button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Device Filters */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">MIDI Devices</label>
        {devices.length === 0 ? (
          <p className="text-xs text-gray-600 italic">No MIDI devices detected. Connect a device and click Start Bridge.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {devices.map((name) => {
              const disabled = deviceFilters.includes(name);
              return (
                <button
                  key={name}
                  onClick={() => toggleDevice(name)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    disabled
                      ? "border-white/10 text-gray-600 bg-transparent"
                      : "border-accent/30 text-accent bg-accent/10"
                  }`}
                >
                  {disabled ? "○" : "●"} {name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* OSC Target */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">OSC Target</label>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={hostInput}
            onChange={(e) => setHostInput(e.target.value)}
            onBlur={handleTargetBlur}
            placeholder="127.0.0.1"
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:border-accent/50"
          />
          <input
            type="text"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            onBlur={handleTargetBlur}
            placeholder="8000"
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm w-20 focus:outline-none focus:border-accent/50"
          />
          {endpoints.length > 0 && (
            <select
              onChange={(e) => {
                const ep = endpoints.find((ep) => ep.id === e.target.value);
                if (ep) selectEndpoint(ep.host, ep.port);
              }}
              defaultValue=""
              className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none focus:border-accent/50"
            >
              <option value="" disabled>Saved endpoints…</option>
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>{ep.name} ({ep.host}:{ep.port})</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Mapping Rules */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">
          Mapping Rules <span className="text-gray-600">(auto-map is default when no rule matches)</span>
        </label>

        {rules.length > 0 && (
          <div className="mb-2 border border-white/5 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-gray-500">
                  <th className="text-left px-3 py-2 font-normal">Type</th>
                  <th className="text-left px-3 py-2 font-normal">Ch</th>
                  <th className="text-left px-3 py-2 font-normal">Note/CC</th>
                  <th className="text-left px-3 py-2 font-normal">OSC Address</th>
                  <th className="text-left px-3 py-2 font-normal">Arg</th>
                  <th className="text-left px-3 py-2 font-normal">Scale</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-1.5 text-gray-300">{rule.type}</td>
                    <td className="px-3 py-1.5 text-gray-400">{rule.channel ?? "any"}</td>
                    <td className="px-3 py-1.5 text-gray-400">{rule.data1 ?? "any"}</td>
                    <td className="px-3 py-1.5 text-accent font-mono">{rule.address}</td>
                    <td className="px-3 py-1.5 text-gray-400">{rule.argType}</td>
                    <td className="px-3 py-1.5 text-gray-400">
                      {rule.scale ? `${rule.scale[0]}–${rule.scale[1]}` : "0–1"}
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => removeRule(rule.id)}
                        className="text-gray-600 hover:text-red-400 transition-colors"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add Rule Form */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={newRule.type}
            onChange={(e) => setNewRule((r) => ({ ...r, type: e.target.value as MidiMappingRule["type"] }))}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50"
          >
            {MIDI_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="number"
            placeholder="ch (any)"
            min={1} max={16}
            value={newRule.channel ?? ""}
            onChange={(e) => setNewRule((r) => ({ ...r, channel: e.target.value ? parseInt(e.target.value) : undefined }))}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:border-accent/50"
          />
          <input
            type="number"
            placeholder="#note/cc (any)"
            min={0} max={127}
            value={newRule.data1 ?? ""}
            onChange={(e) => setNewRule((r) => ({ ...r, data1: e.target.value ? parseInt(e.target.value) : undefined }))}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:border-accent/50"
          />
          <input
            type="text"
            placeholder="/osc/address"
            value={newRule.address}
            onChange={(e) => setNewRule((r) => ({ ...r, address: e.target.value }))}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:border-accent/50"
          />
          <select
            value={newRule.argType}
            onChange={(e) => setNewRule((r) => ({ ...r, argType: e.target.value as "f" | "i" }))}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent/50"
          >
            <option value="f">float</option>
            <option value="i">int</option>
          </select>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={addRule}
            className="px-3 py-1.5 bg-surface-lighter border border-white/10 text-gray-300 hover:text-white hover:border-accent/30 rounded-lg text-sm transition-colors"
          >
            + Add Rule
          </motion.button>
        </div>
      </div>

      {/* Message Log */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-gray-500">Message Log</label>
          <div className="flex gap-2">
            <button
              onClick={() => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() => setEvents([])}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-surface-lighter rounded-lg border border-white/5 overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-2 border-b border-white/5 px-3 py-1.5">
            <span className="text-xs text-gray-600 font-mono">MIDI IN</span>
            <span className="text-xs text-gray-600 font-mono">OSC OUT</span>
          </div>

          {/* Events */}
          <div className="overflow-y-auto h-full">
            {events.length === 0 ? (
              <p className="text-xs text-gray-700 italic px-3 py-3">
                {running ? "Waiting for MIDI input…" : "Start the bridge to see events."}
              </p>
            ) : (
              [...events].reverse().map((evt, i) => (
                <div
                  key={`${evt.midi.timestamp}-${evt.midi.deviceName}-${i}`}
                  className="grid grid-cols-2 border-b border-white/5 last:border-0 px-3 py-1 hover:bg-white/5 transition-colors"
                >
                  <span className="text-xs font-mono text-green-400 truncate pr-2">
                    {formatMidi(evt.midi)}
                  </span>
                  <span className="text-xs font-mono text-indigo-400 truncate">
                    {evt.osc.address}{" "}
                    <span className="text-indigo-300/60">
                      {evt.osc.args.map((a) => String(typeof a.value === "number" ? a.value.toFixed(3) : a.value)).join(" ")}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
