"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useDiagnostics } from "@/hooks/use-osc";
import type { DiagnosticsResult } from "@/lib/types";

export default function DiagnosticsPage() {
  const [count, setCount] = useState("100");
  const [rate, setRate] = useState("1000");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const { runLoopback, progress } = useDiagnostics();

  const handleRun = async () => {
    const c = parseInt(count, 10);
    const r = parseInt(rate, 10);
    if (isNaN(c) || isNaN(r) || c < 1 || r < 1) return;

    setRunning(true);
    setResult(null);
    try {
      const res = await runLoopback(c, r);
      setResult(res);
    } finally {
      setRunning(false);
    }
  };

  const StatCard = ({
    label,
    value,
    unit,
    status,
  }: {
    label: string;
    value: string;
    unit: string;
    status?: "good" | "warn" | "bad";
  }) => {
    const statusColors = {
      good: "text-green-400",
      warn: "text-yellow-400",
      bad: "text-red-400",
    };
    return (
      <div className="bg-elevated border border-white/5 rounded-lg p-4">
        <div className="text-xs text-gray-500 mb-1">{label}</div>
        <div className={`text-2xl font-semibold ${status ? statusColors[status] : "text-gray-200"}`}>
          {value}
          <span className="text-sm text-gray-500 ml-1">{unit}</span>
        </div>
      </div>
    );
  };

  const getDropRateStatus = (rate: number): "good" | "warn" | "bad" => {
    if (rate === 0) return "good";
    if (rate < 5) return "warn";
    return "bad";
  };

  const getLatencyStatus = (ms: number): "good" | "warn" | "bad" => {
    if (ms < 1) return "good";
    if (ms < 5) return "warn";
    return "bad";
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">Diagnostics</h2>

      <div className="bg-panel rounded-lg border border-white/5 p-6">
        <h3 className="text-sm font-medium text-gray-400 mb-1">Loopback Self-Test</h3>
        <p className="text-xs text-gray-600 mb-4">
          Sends messages from port 57120 to port 57121 on localhost. Measures throughput, latency, and drop rate to verify the tool is not a bottleneck.
        </p>

        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Message Count</label>
            <input
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm w-28 focus:outline-none focus:border-diag/18"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Rate (msg/sec)</label>
            <input
              type="number"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="bg-elevated border border-white/10 rounded-lg px-3 py-2 text-sm w-28 focus:outline-none focus:border-diag/18"
            />
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleRun}
            disabled={running}
            className="px-4 py-2 bg-diag text-white font-medium rounded-lg text-sm hover:bg-diag-dim transition-colors disabled:opacity-50"
          >
            {running ? "Running..." : "Run Test"}
          </motion.button>
        </div>

        {running && progress && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Receiving messages...</span>
              <span>
                {progress.received} / {progress.total}
              </span>
            </div>
            <div className="w-full bg-elevated rounded-full h-2">
              <motion.div
                className="bg-diag h-2 rounded-full"
                initial={{ width: 0 }}
                animate={{
                  width: `${(progress.received / progress.total) * 100}%`,
                }}
                transition={{ duration: 0.2 }}
              />
            </div>
          </div>
        )}
      </div>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        >
          <StatCard
            label="Throughput"
            value={result.throughput.toFixed(0)}
            unit="msg/s"
          />
          <StatCard
            label="Drop Rate"
            value={result.dropRate.toFixed(1)}
            unit="%"
            status={getDropRateStatus(result.dropRate)}
          />
          <StatCard
            label="Latency (avg)"
            value={result.latencyAvg.toFixed(2)}
            unit="ms"
            status={getLatencyStatus(result.latencyAvg)}
          />
          <StatCard
            label="Latency (max)"
            value={result.latencyMax.toFixed(2)}
            unit="ms"
            status={getLatencyStatus(result.latencyMax)}
          />
          <StatCard label="Sent" value={result.messagesSent.toString()} unit="msgs" />
          <StatCard label="Received" value={result.messagesReceived.toString()} unit="msgs" />
          <StatCard label="Latency (min)" value={result.latencyMin.toFixed(2)} unit="ms" />
          <StatCard
            label="Verdict"
            value={result.dropRate === 0 && result.latencyAvg < 1 ? "PASS" : result.dropRate < 5 ? "WARN" : "FAIL"}
            unit=""
            status={getDropRateStatus(result.dropRate)}
          />
        </motion.div>
      )}
    </div>
  );
}
