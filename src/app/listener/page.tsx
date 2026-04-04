"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { MessageLog } from "@/components/message-log";
import { useOscListener, useListenerControl } from "@/hooks/use-osc";
import type { OscMessage, ListenerConfig } from "@/lib/types";

export default function ListenerPage() {
  const [messages, setMessages] = useState<OscMessage[]>([]);
  const [port, setPort] = useState("9000");
  const [bindAddress, setBindAddress] = useState("0.0.0.0");
  const [activePorts, setActivePorts] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { start, stop, getActive } = useListenerControl();

  useOscListener(
    useCallback((msgs: OscMessage[]) => {
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
        <h2 className="text-xl font-semibold mb-4">Listener</h2>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bind Address</label>
            <input
              type="text"
              value={bindAddress}
              onChange={(e) => setBindAddress(e.target.value)}
              className="bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:border-accent/50"
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
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleStart}
            className="px-4 py-2 bg-accent text-surface font-medium rounded-lg text-sm hover:bg-accent-dim transition-colors"
          >
            Start Listening
          </motion.button>
        </div>

        {error && (
          <p className="text-red-400 text-sm mt-2">{error}</p>
        )}

        {activePorts.length > 0 && (
          <div className="flex gap-2 mt-3">
            {activePorts.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-2 bg-accent/10 text-accent text-xs px-3 py-1 rounded-full border border-accent/20"
              >
                {bindAddress}:{p}
                <button
                  onClick={() => handleStop(p)}
                  className="hover:text-red-400 transition-colors"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <MessageLog
          messages={messages}
          onClear={() => setMessages([])}
        />
      </div>
    </div>
  );
}
