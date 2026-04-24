"use client";

import { useState, useCallback, useEffect } from "react";
import { useOscThroughput, useWebServer } from "@/hooks/use-osc";
import { useMidiControl } from "@/hooks/use-midi";

export function StatusBar() {
  const [localIp, setLocalIp] = useState("");
  const throughput = useOscThroughput();
  const { running: bridgeRunning, start: startBridge, stop: stopBridge } = useMidiControl();
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api) {
      api.invoke("system:get-local-ip").then((ip: string) => setLocalIp(ip));
    }
  }, []);

  const { running: webRunning, url, start: startWeb, stop: stopWeb } = useWebServer();
  const [webPort, setWebPort] = useState("4000");
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = useCallback(async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [url]);

  const handleWebToggle = async () => {
    if (webRunning) await stopWeb();
    else await startWeb(parseInt(webPort, 10));
  };

  const handleBridgeToggle = async () => {
    try {
      setBridgeError(null);
      if (bridgeRunning) await stopBridge();
      else await startBridge();
    } catch (err) {
      setBridgeError(String(err));
    }
  };

  return (
    <div className="h-8 bg-black border-t border-white/[0.04] flex items-center px-4 text-xs text-[#444] gap-4">
      {/* MIDI Bridge */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full transition-colors duration-200 ${
            bridgeRunning ? "bg-success shadow-[0_0_6px_#22c55e]" : "bg-[#333]"
          }`}
        />
        <span className="text-[#666]">Bridge</span>
        <button
          onClick={handleBridgeToggle}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            bridgeRunning
              ? "bg-error/10 text-error border border-error/20 hover:bg-error/20"
              : "bg-elevated border border-white/[0.06] text-[#666] hover:text-[#aaa]"
          }`}
        >
          {bridgeRunning ? "Stop" : "Start"}
        </button>
        {bridgeError && (
          <span className="text-error truncate max-w-[200px]" title={bridgeError}>
            {bridgeError}
          </span>
        )}
      </div>

      <span className="text-[#222]">|</span>

      {/* OSC Throughput */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full transition-colors duration-200 ${
            throughput > 0 ? "bg-input animate-pulse" : "bg-[#333]"
          }`}
        />
        <span>{throughput} msg/s</span>
      </div>

      {localIp && (
        <>
          <span className="text-[#222]">|</span>
          <span className="text-[#666]">{localIp}</span>
        </>
      )}

      {/* Web UI */}
      <div className="ml-auto flex items-center gap-2">
        {!webRunning && (
          <input
            type="text"
            value={webPort}
            onChange={(e) => setWebPort(e.target.value)}
            className="bg-elevated border border-white/[0.06] rounded px-2 py-0.5 w-16 text-xs focus:border-input/18 focus:outline-none"
            placeholder="Port"
          />
        )}
        {webRunning && (
          <button
            onClick={handleCopyUrl}
            className="px-2 py-0.5 rounded text-xs text-input hover:text-input-dim transition-colors"
          >
            {copied ? "Copied!" : url}
          </button>
        )}
        <button
          onClick={handleWebToggle}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            webRunning
              ? "bg-error/10 text-error border border-error/20 hover:bg-error/20"
              : "bg-elevated border border-white/[0.06] text-[#666] hover:text-[#aaa]"
          }`}
        >
          {webRunning ? "Stop" : "Start Web UI"}
        </button>
      </div>
    </div>
  );
}
