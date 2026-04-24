"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageLog } from "@/components/message-log";
import { EndpointPicker } from "@/components/endpoint-picker";
import { useOscListener, useListenerControl, useEndpoints } from "@/hooks/use-osc";
import { useMidiControl, useMidiConfig, useMidiEvents } from "@/hooks/use-midi";
import type { OscMessage, MidiEvent, MidiMappingRule } from "@/lib/types";

// ─── MIDI helpers ──────────────────────────────────────────────────────────────

const MIDI_TYPES = ["noteon", "noteoff", "cc", "pitch", "aftertouch", "program"] as const;

function formatMidi(evt: MidiEvent["midi"]): string {
  switch (evt.type) {
    case "noteon":     return `NoteOn  ch${evt.channel} #${evt.data1} vel=${evt.data2}`;
    case "noteoff":    return `NoteOff ch${evt.channel} #${evt.data1} vel=${evt.data2}`;
    case "cc":         return `CC      ch${evt.channel} #${evt.data1} → ${evt.data2}`;
    case "pitch":      return `Pitch   ch${evt.channel} → ${(evt.data2 << 7) | evt.data1}`;
    case "aftertouch": return `AT      ch${evt.channel} ${evt.data1} ${evt.data2}`;
    case "program":    return `Prog    ch${evt.channel} → ${evt.data1}`;
  }
}

// ─── Listener Panel ────────────────────────────────────────────────────────────

function ListenerPanel() {
  const [messages, setMessages] = useState<OscMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const [port, setPort] = useState("9000");
  const [bindAddress, setBindAddress] = useState("0.0.0.0");
  const [activePorts, setActivePorts] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { start, stop, getActive } = useListenerControl();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useOscListener(
    useCallback((msgs: OscMessage[]) => {
      if (pausedRef.current) return;
      setMessages((prev) => [...prev, ...msgs].slice(-500));
    }, [])
  );

  const handleStart = async () => {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError("Invalid port number");
      return;
    }
    try {
      setError(null);
      await start({ port: portNum, bindAddress });
      setActivePorts(await getActive());
    } catch (err) {
      setError(String(err));
    }
  };

  const handleStop = async (p: number) => {
    await stop(p);
    setActivePorts(await getActive());
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <div>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bind Address</label>
            <input
              type="text"
              value={bindAddress}
              onChange={(e) => setBindAddress(e.target.value)}
              className="bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:border-input/18"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Port</label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm w-24 focus:outline-none focus:border-input/18"
            />
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleStart}
            className="px-4 py-2 bg-input text-black font-medium rounded-lg text-sm hover:bg-input-dim transition-colors"
          >
            Start Listening
          </motion.button>
        </div>

        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}

        {activePorts.length > 0 && (
          <div className="flex gap-2 mt-3">
            {activePorts.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-2 bg-input/10 text-input text-xs px-3 py-1 rounded-full border border-input/20"
              >
                <span title={`${bindAddress}:${p}`}>{bindAddress}:{p}</span>
                <button
                  onClick={() => handleStop(p)}
                  className="hover:text-red-400 transition-colors"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <EndpointPicker
        type="listener"
        currentHost={bindAddress}
        currentPort={port}
        onSelect={(host, p) => { setBindAddress(host); setPort(p); }}
      />

      <div className="flex-1 min-h-0">
        <MessageLog
          messages={messages}
          onClear={() => setMessages([])}
          paused={paused}
          onTogglePaused={() => setPaused((p) => !p)}
        />
      </div>
    </div>
  );
}

// ─── MIDI Panel ────────────────────────────────────────────────────────────────

function MidiPanel() {
  const { running, devices, refreshDevices } = useMidiControl();
  const { rules, deviceFilters, target, saveRules, saveDeviceFilters, saveTarget } = useMidiConfig();
  const { endpoints } = useEndpoints("sender");

  const [events, setEvents] = useState<MidiEvent[]>([]);
  const [hostInput, setHostInput] = useState(target.host);
  const [portInput, setPortInput] = useState(String(target.port));
  const [newRule, setNewRule] = useState<Omit<MidiMappingRule, "id">>({
    type: "cc",
    address: "",
    argType: "f",
  });
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [selectedEndpointId, setSelectedEndpointId] = useState("");

  // Sync host/port inputs once after async store load
  const targetSynced = useRef(false);
  useEffect(() => {
    if (targetSynced.current) return;
    targetSynced.current = true;
    setHostInput(target.host);
    setPortInput(String(target.port));
  }, [target.host, target.port]);

  useMidiEvents(
    useCallback((incoming: MidiEvent[]) => {
      if (pausedRef.current) return;
      setEvents((prev) => [...prev, ...incoming].slice(-500));
    }, [])
  );

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
      {/* Device Filters */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">MIDI Devices</label>
        {devices.length === 0 ? (
          <p className="text-xs text-gray-600 italic">
            No MIDI devices detected. Connect a device and start the bridge.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {devices.map((name) => {
              const disabled = deviceFilters.includes(name);
              return (
                <button
                  key={name}
                  onClick={() => toggleDevice(name)}
                  title={name}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    disabled
                      ? "border-white/10 text-gray-600 bg-transparent"
                      : "border-input/30 text-input bg-input/10"
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
            className="bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:border-input/18"
          />
          <input
            type="text"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            onBlur={handleTargetBlur}
            placeholder="8000"
            className="bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm w-20 focus:outline-none focus:border-input/18"
          />
          {endpoints.length > 0 && (
            <select
              value={selectedEndpointId}
              onChange={(e) => {
                const ep = endpoints.find((ep) => ep.id === e.target.value);
                if (ep) { selectEndpoint(ep.host, ep.port); setSelectedEndpointId(""); }
              }}
              className="bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-400 focus:outline-none focus:border-input/18"
            >
              <option value="" disabled>Saved endpoints…</option>
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.name} ({ep.host}:{ep.port})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Mapping Rules */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">
          Mapping Rules{" "}
          <span className="text-gray-600">(auto-map is default when no rule matches)</span>
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
                    <td
                      className="px-3 py-1.5 text-input font-mono truncate max-w-[160px]"
                      title={rule.address}
                    >
                      {rule.address}
                    </td>
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
            className="bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-input/18"
          >
            {MIDI_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="number"
            placeholder="ch (any)"
            min={1}
            max={16}
            value={newRule.channel ?? ""}
            onChange={(e) => setNewRule((r) => ({ ...r, channel: e.target.value ? parseInt(e.target.value) : undefined }))}
            className="bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-sm w-24 focus:outline-none focus:border-input/18"
          />
          <input
            type="number"
            placeholder="#note/cc (any)"
            min={0}
            max={127}
            value={newRule.data1 ?? ""}
            onChange={(e) => setNewRule((r) => ({ ...r, data1: e.target.value ? parseInt(e.target.value) : undefined }))}
            className="bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:border-input/18"
          />
          <input
            type="text"
            placeholder="/osc/address"
            value={newRule.address}
            onChange={(e) => setNewRule((r) => ({ ...r, address: e.target.value }))}
            className="bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:border-input/18"
          />
          <select
            value={newRule.argType}
            onChange={(e) => setNewRule((r) => ({ ...r, argType: e.target.value as "f" | "i" }))}
            className="bg-elevated border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-input/18"
          >
            <option value="f">float</option>
            <option value="i">int</option>
          </select>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={addRule}
            className="px-3 py-1.5 bg-elevated border border-white/10 text-gray-300 hover:text-white hover:border-input/30 rounded-lg text-sm transition-colors"
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
              onClick={() => {
                pausedRef.current = !pausedRef.current;
                setPaused(pausedRef.current);
              }}
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

        <div className="flex-1 min-h-0 bg-elevated rounded-lg border border-white/5 overflow-hidden">
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
                  <span
                    className="text-xs font-mono text-input truncate pr-2"
                    title={formatMidi(evt.midi)}
                  >
                    {formatMidi(evt.midi)}
                  </span>
                  <span
                    className="text-xs font-mono text-input truncate"
                    title={`${evt.osc.address} ${evt.osc.args.map((a) => String(typeof a.value === "number" ? a.value.toFixed(3) : a.value)).join(" ")}`}
                  >
                    {evt.osc.address}{" "}
                    <span className="text-input/60">
                      {evt.osc.args
                        .map((a) =>
                          String(typeof a.value === "number" ? a.value.toFixed(3) : a.value)
                        )
                        .join(" ")}
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

// ─── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "listener", label: "OSC Listener" },
  { id: "midi",     label: "MIDI Devices" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function InputPage() {
  const [activeTab, setActiveTab] = useState<TabId>("listener");

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
                isActive ? "text-input" : "text-[#444] hover:text-[#666]"
              }`}
            >
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId="input-tab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-input rounded-full"
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
            {activeTab === "listener" ? <ListenerPanel /> : <MidiPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
