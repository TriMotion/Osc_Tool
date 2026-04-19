"use client";

import { createContext, useContext, useRef } from "react";
import { useRecorder } from "@/hooks/use-recorder";
import { useMidiConfig } from "@/hooks/use-midi";
import type { MidiMappingRule } from "@/lib/types";

type RecorderContextValue = ReturnType<typeof useRecorder>;

const RecorderContext = createContext<RecorderContextValue | null>(null);

export function RecorderProvider({ children }: { children: React.ReactNode }) {
  const { rules } = useMidiConfig();
  const rulesRef = useRef<MidiMappingRule[]>(rules);
  rulesRef.current = rules;

  const recorder = useRecorder({
    getMappingRulesSnapshot: () => rulesRef.current,
  });

  return (
    <RecorderContext.Provider value={recorder}>
      {children}
    </RecorderContext.Provider>
  );
}

export function useRecorderContext(): RecorderContextValue {
  const ctx = useContext(RecorderContext);
  if (!ctx) throw new Error("useRecorderContext must be used within RecorderProvider");
  return ctx;
}
