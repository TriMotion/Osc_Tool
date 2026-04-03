"use client";

import { useState } from "react";
import { useOscThroughput, useWebServer } from "@/hooks/use-osc";

export function StatusBar() {
  const throughput = useOscThroughput();
  const { running, url, start, stop } = useWebServer();
  const [webPort, setWebPort] = useState("4000");

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
        <button
          onClick={handleToggle}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            running
              ? "bg-accent/20 text-accent border border-accent/30"
              : "bg-surface border border-white/10 text-gray-400 hover:text-gray-200"
          }`}
        >
          {running ? `Web: ${url}` : "Start Web UI"}
        </button>
      </div>
    </div>
  );
}
