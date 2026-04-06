"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { OscInput } from "@/components/osc-input";
import { EndpointPicker } from "@/components/endpoint-picker";
import { useOscSender } from "@/hooks/use-osc";
import type { OscArg } from "@/lib/types";

interface SentEntry {
  address: string;
  args: OscArg[];
  timestamp: number;
}

export default function SenderPage() {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("8000");
  const [history, setHistory] = useState<SentEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [repeating, setRepeating] = useState(false);
  const repeatRef = useRef<NodeJS.Timeout | null>(null);
  const lastSentRef = useRef<{ address: string; args: OscArg[] } | null>(null);
  const { send } = useOscSender();

  const handleSend = useCallback(async (address: string, args: OscArg[]) => {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError("Invalid port number");
      return;
    }
    try {
      setError(null);
      await send({ host, port: portNum }, address, args);
      lastSentRef.current = { address, args };
      setHistory((prev) => [
        { address, args, timestamp: Date.now() },
        ...prev.slice(0, 19),
      ]);
    } catch (err) {
      setError(String(err));
    }
  }, [host, port, send]);

  useEffect(() => {
    if (repeating && lastSentRef.current) {
      const { address, args } = lastSentRef.current;
      repeatRef.current = setInterval(() => {
        handleSend(address, args);
      }, 1000);
    } else {
      if (repeatRef.current) clearInterval(repeatRef.current);
      repeatRef.current = null;
    }
    return () => {
      if (repeatRef.current) clearInterval(repeatRef.current);
    };
  }, [repeating, handleSend]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">Sender</h2>

      <div className="flex items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Target Host</label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Port</label>
          <input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm w-24 focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      <EndpointPicker
        type="sender"
        currentHost={host}
        currentPort={port}
        onSelect={(h, p) => { setHost(h); setPort(p); }}
      />

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="bg-surface-light rounded-xl border border-white/5 p-4">
        <OscInput onSend={handleSend} />
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5">
          <button
            onClick={() => setRepeating(!repeating)}
            disabled={!lastSentRef.current && !repeating}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              repeating
                ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                : "bg-surface-lighter border border-white/10 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            }`}
          >
            {repeating ? "Stop Repeat" : "Repeat every 1s"}
          </button>
          {repeating && lastSentRef.current && (
            <span className="text-xs text-yellow-400/70 animate-pulse">
              Sending {lastSentRef.current.address}
            </span>
          )}
        </div>
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
                  className="flex items-center gap-3 bg-surface-lighter border border-white/5 rounded-lg px-3 py-2 text-xs font-mono hover:border-accent/30 transition-colors text-left"
                >
                  <span className="text-gray-500">{formatTime(entry.timestamp)}</span>
                  <span className="text-accent">{entry.address}</span>
                  <span className="text-gray-400">
                    {entry.args.map((a) => `${a.value}`).join(", ")}
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
