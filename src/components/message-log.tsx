"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import type { OscMessage } from "@/lib/types";

interface MessageLogProps {
  messages: OscMessage[];
  onClear: () => void;
  paused: boolean;
  onTogglePaused: () => void;
}

export function MessageLog({ messages, onClear, paused, onTogglePaused }: MessageLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [filter, setFilter] = useState("");
  const [uniqueOnly, setUniqueOnly] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (pinned && !uniqueOnly && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, pinned, uniqueOnly]);

  const filtered = useMemo(() => {
    let result = filter
      ? messages.filter(
          (m) =>
            m.address.includes(filter) ||
            m.sourceIp?.includes(filter)
        )
      : messages;

    if (uniqueOnly) {
      const seen = new Map<string, OscMessage>();
      for (const msg of result) {
        seen.set(msg.address, msg);
      }
      result = Array.from(seen.values()).sort((a, b) => a.address.localeCompare(b.address));
    }

    return result;
  }, [messages, filter, uniqueOnly]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}.${d.getMilliseconds().toString().padStart(3, "0")}`;
  };

  const formatArgs = (msg: OscMessage) =>
    msg.args.map((a) => `${a.value} (${a.type})`).join(", ");

  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1000);
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter by address or IP..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 bg-surface-lighter border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent/50"
        />
        <button
          onClick={() => setUniqueOnly(!uniqueOnly)}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            uniqueOnly
              ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
              : "bg-surface-lighter border border-white/10 text-gray-400 hover:text-gray-200"
          }`}
        >
          Unique
        </button>
        <button
          onClick={onTogglePaused}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            paused
              ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
              : "bg-surface-lighter border border-white/10 text-gray-400 hover:text-gray-200"
          }`}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={() => setPinned(!pinned)}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            pinned
              ? "bg-accent/20 text-accent border border-accent/30"
              : "bg-surface-lighter border border-white/10 text-gray-400 hover:text-gray-200"
          }`}
        >
          Auto-scroll
        </button>
        <button
          onClick={onClear}
          className="px-3 py-2 rounded-lg text-sm font-medium bg-surface-lighter border border-white/10 text-gray-400 hover:text-red-400 hover:border-red-500/30 transition-colors"
        >
          Clear
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto rounded-lg bg-surface-lighter border border-white/5 font-mono text-xs"
      >
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-light">
            <tr className="text-gray-500 text-left">
              <th className="px-3 py-2 w-28">Time</th>
              <th className="px-3 py-2 w-40">Source</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Values</th>
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((msg, i) => (
              <tr
                key={uniqueOnly ? msg.address : `${msg.timestamp}-${i}`}
                className="border-t border-white/5 hover:bg-white/5 group"
              >
                <td className="px-3 py-1.5 text-gray-500">{formatTime(msg.timestamp)}</td>
                <td className="px-3 py-1.5 text-gray-400">
                  {msg.sourceIp}:{msg.sourcePort}
                </td>
                <td className="px-3 py-1.5 text-accent">{msg.address}</td>
                <td className="px-3 py-1.5 text-gray-300">{formatArgs(msg)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <button
                    onClick={() => copyToClipboard(msg.address, `addr-${i}`)}
                    className={`opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded ${
                      copied === `addr-${i}`
                        ? "text-green-400"
                        : "text-gray-500 hover:text-gray-200"
                    }`}
                  >
                    {copied === `addr-${i}` ? "✓" : "addr"}
                  </button>
                  <button
                    onClick={() => {
                      const values = msg.args.map((a) => a.value).join(", ");
                      copyToClipboard(`${msg.address} ${values}`, `line-${i}`);
                    }}
                    className={`opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded ml-1 ${
                      copied === `line-${i}`
                        ? "text-green-400"
                        : "text-gray-500 hover:text-gray-200"
                    }`}
                  >
                    {copied === `line-${i}` ? "✓" : "all"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-gray-600">
            {messages.length === 0
              ? "No messages received yet. Start a listener to begin."
              : "No messages match your filter."}
          </div>
        )}
      </div>
    </div>
  );
}
