"use client";

import { useRef } from "react";

interface ResizeHandleProps {
  currentHeight: number;
  minHeight?: number;
  onResize: (newHeight: number) => void;
}

export function ResizeHandle({ currentHeight, minHeight = 16, onResize }: ResizeHandleProps) {
  const startYRef = useRef<number | null>(null);
  const startHeightRef = useRef(currentHeight);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    startYRef.current = e.clientY;
    startHeightRef.current = currentHeight;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startYRef.current === null) return;
    const delta = e.clientY - startYRef.current;
    onResize(Math.max(minHeight, startHeightRef.current + delta));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    startYRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="absolute left-0 right-0 bottom-0 h-1 cursor-ns-resize z-[3] hover:bg-accent/40 transition-colors"
    />
  );
}
