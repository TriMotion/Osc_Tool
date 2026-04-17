"use client";

import type { LaneAnalysis, LaneBadge } from "@/lib/types";

interface LaneBadgesProps {
  analysis?: LaneAnalysis;
  userBadges?: LaneBadge[];
  onAddClick: () => void;
  onBadgeClick: (badge: LaneBadge) => void;
}

export function LaneBadges({ analysis, userBadges, onAddClick, onBadgeClick }: LaneBadgesProps) {
  const items: React.ReactNode[] = [];

  if (analysis?.isDead) {
    items.push(
      <span key="dead" title="Dead lane (very few events)" className="inline-block w-1.5 h-1.5 rounded-full bg-gray-600" />
    );
  }
  if (analysis && !analysis.isDead && analysis.rhythmScore >= 0.5) {
    items.push(
      <span key="rhythm" title={`Rhythm ${analysis.rhythmScore.toFixed(2)}`} className="inline-block text-[9px] px-1.5 py-[1px] rounded-full bg-accent/20 text-accent border border-accent/30">
        ♻ {analysis.rhythmScore.toFixed(2)}
      </span>
    );
  }
  if (analysis && !analysis.isDead && analysis.dynamicScore >= 0.5) {
    items.push(
      <span key="dyn" title={`Dynamic ${analysis.dynamicScore.toFixed(2)}`} className="inline-block text-[9px] px-1.5 py-[1px] rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
        〜 wide
      </span>
    );
  }
  if (analysis && analysis.melodyScore !== undefined && analysis.melodyScore >= 0.5) {
    items.push(
      <span key="mel" title={`Melody ${analysis.melodyScore.toFixed(2)}`} className="inline-block text-[9px] px-1.5 py-[1px] rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30">
        🎵 {analysis.melodyScore.toFixed(2)}
      </span>
    );
  }

  for (const b of userBadges ?? []) {
    const color = b.color ?? hashColor(b.label);
    items.push(
      <button
        key={b.id}
        onClick={(e) => { e.stopPropagation(); onBadgeClick(b); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="inline-block text-[9px] px-1.5 py-[1px] rounded-full border"
        style={{ background: `${color}33`, color, borderColor: `${color}55` }}
        title="Click to edit"
      >
        ⭐ {b.label}
      </button>
    );
  }

  items.push(
    <button
      key="add"
      onClick={(e) => { e.stopPropagation(); onAddClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      className="inline-block text-[9px] w-4 h-4 rounded-full border border-white/10 text-gray-500 hover:text-white hover:border-accent/40 leading-none"
      title="Tag this lane"
    >
      +
    </button>
  );

  return <div className="flex items-center gap-1 flex-wrap mt-0.5">{items}</div>;
}

function hashColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 60%, 65%)`;
}
