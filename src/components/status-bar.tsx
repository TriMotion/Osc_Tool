"use client";

import { useState, useCallback, useEffect } from "react";
import { useOscThroughput, useWebServer } from "@/hooks/use-osc";

export function StatusBar() {
  const [localIp, setLocalIp] = useState("");
  const throughput = useOscThroughput();

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api) {
      api.invoke("system:get-local-ip").then((ip: string) => setLocalIp(ip));
    }
  }, []);
  const { running, url, start, stop } = useWebServer();
  const [webPort, setWebPort] = useState("4000");
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = useCallback(async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [url]);

  const handleToggle = async () => {
    if (running) {
      await stop();
    } else {
      await start(parseInt(webPort, 10));
    }
  };

  return (
    <div className="h-8 bg-surface-light border-t border-white/5 flex items-center px-4 text-xs text-gray-500 gap-4">
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            throughput > 0 ? "bg-accent animate-pulse" : "bg-gray-600"
          }`}
        />
        <span>{throughput} msg/s</span>
      </div>
      {localIp && (
        <span className="text-gray-600">{localIp}</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {!running && (
          <input
            type="text"
            value={webPort}
            onChange={(e) => setWebPort(e.target.value)}
            className="bg-surface border border-white/10 rounded px-2 py-0.5 w-16 text-xs"
            placeholder="Port"
          />
        )}
        {running && (
          <button
            onClick={handleCopyUrl}
            className="px-2 py-0.5 rounded text-xs text-accent hover:text-accent-dim transition-colors"
          >
            {copied ? "Copied!" : url}
          </button>
        )}
        <button
          onClick={handleToggle}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            running
              ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
              : "bg-surface border border-white/10 text-gray-400 hover:text-gray-200"
          }`}
        >
          {running ? "Stop" : "Start Web UI"}
        </button>
      </div>
    </div>
  );
}
