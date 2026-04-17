"use client";

interface PitchSparklineProps {
  contour: number[];           // 32 values; pitch means per bucket
  pitchRange: [number, number]; // MIDI note min/max
  width?: number;
  height?: number;
}

export function PitchSparkline({ contour, pitchRange, width = 80, height = 16 }: PitchSparklineProps) {
  if (contour.length < 2) return null;
  const [pMin, pMax] = pitchRange;
  const span = Math.max(1, pMax - pMin);
  const n = contour.length;

  const points: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * width;
    const y = (1 - (contour[i] - pMin) / span) * height;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="rgba(255, 174, 215, 0.7)"
        strokeWidth={1}
      />
    </svg>
  );
}
