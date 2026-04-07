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

interface FileEntry {
  address: string;
  args: OscArg[];
}

function parseOscLine(line: string): FileEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Find first OSC address in the line (starts with /)
  const match = trimmed.match(/(\/\S+)/);
  if (!match) return null;
  const address = match[1];
  // Get everything after the address as potential arguments
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

export default function SenderPage() {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("8000");
  const [history, setHistory] = useState<SentEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [repeating, setRepeating] = useState(false);
  const repeatRef = useRef<NodeJS.Timeout | null>(null);
  const lastSentRef = useRef<{ address: string; args: OscArg[] } | null>(null);
  const { send } = useOscSender();

  // File entries
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loopIndex, setLoopIndex] = useState(0);
  const loopIndexRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Repeat logic: single message or loop through file entries
  useEffect(() => {
    if (!repeating) {
      if (repeatRef.current) clearInterval(repeatRef.current);
      repeatRef.current = null;
      return;
    }

    if (fileEntries.length > 0) {
      // Loop through file entries
      loopIndexRef.current = 0;
      setLoopIndex(0);
      repeatRef.current = setInterval(() => {
        const entry = fileEntries[loopIndexRef.current];
        if (entry) handleSend(entry.address, entry.args);
        loopIndexRef.current = (loopIndexRef.current + 1) % fileEntries.length;
        setLoopIndex(loopIndexRef.current);
      }, 1000);
    } else if (lastSentRef.current) {
      // Repeat single message
      const { address, args } = lastSentRef.current;
      repeatRef.current = setInterval(() => {
        handleSend(address, args);
      }, 1000);
    }

    return () => {
      if (repeatRef.current) clearInterval(repeatRef.current);
    };
  }, [repeating, handleSend, fileEntries]);

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

  const canRepeat = fileEntries.length > 0 || !!lastSentRef.current;

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
            disabled={!canRepeat}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              repeating
                ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                : "bg-surface-lighter border border-white/10 text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            }`}
          >
            {repeating
              ? "Stop"
              : fileEntries.length > 0
                ? `Loop ${fileEntries.length} addresses`
                : "Repeat every 1s"}
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

      {/* File upload section */}
      <div className="bg-surface-light rounded-xl border border-white/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400">Address List</h3>
          <div className="flex items-center gap-2">
            {fileName && (
              <>
                <span className="text-xs text-gray-500">{fileName}</span>
                <button
                  onClick={handleClearFile}
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                >
                  clear
                </button>
              </>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-xs bg-surface-lighter border border-white/10 rounded-lg text-gray-400 hover:text-gray-200 transition-colors"
            >
              Upload .txt / .md
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.text"
              onChange={handleFileUpload}
              className="hidden"
            />
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
                    : "bg-surface-lighter border border-white/5 hover:border-accent/30"
                }`}
              >
                <span className="text-gray-600 w-6 text-right">{i + 1}</span>
                <span className="text-accent">{entry.address}</span>
                <span className="text-gray-400">
                  {entry.args.map((a) => `${a.value}`).join(", ")}
                </span>
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
