"use client";

import { useEffect, useRef, useState } from "react";

export function useFlash(trigger: number, durationMs = 300): boolean {
  const [flashing, setFlashing] = useState(false);
  const prevRef = useRef(trigger);

  useEffect(() => {
    if (trigger === prevRef.current) return;
    prevRef.current = trigger;
    setFlashing(true);
    const id = setTimeout(() => setFlashing(false), durationMs);
    return () => clearTimeout(id);
  }, [trigger, durationMs]);

  return flashing;
}
