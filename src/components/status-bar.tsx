"use client";

import { useOscThroughput } from "@/hooks/use-osc";

export function StatusBar() {
  const throughput = useOscThroughput();

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
    </div>
  );
}
