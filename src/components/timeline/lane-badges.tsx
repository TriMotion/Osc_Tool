"use client";

import { useState } from "react";
import type { LaneAnalysis, LaneBadge } from "@/lib/types";

type AnalysisBadgeType = "rhythm" | "dynamic" | "melody";

interface LaneBadgesProps {
  analysis?: LaneAnalysis;
  userBadges?: LaneBadge[];
  onAddClick: () => void;
  onBadgeClick: (badge: LaneBadge) => void;
  onDeleteBadge?: (id: string) => void;
  suppressedTypes?: Set<AnalysisBadgeType>;
  onSuppressBadge?: (type: AnalysisBadgeType) => void;
}

export function LaneBadges({ analysis, userBadges, onAddClick, onBadgeClick, onDeleteBadge, suppressedTypes, onSuppressBadge }: LaneBadgesProps) {
  const items: React.ReactNode[] = [];

  if (analysis?.isDead) {
    items.push(
      <span key="dead" title="Dead lane (very few events)" className="inline-block w-1.5 h-1.5 rounded-full bg-gray-600" />
    );
  }
  if (analysis && !analysis.isDead && analysis.rhythmScore >= 0.5 && !suppressedTypes?.has("rhythm")) {
    items.push(
      <AnalysisBadgePill key="rhythm" label={`♻ ${analysis.rhythmScore.toFixed(2)}`} title={`Rhythm ${analysis.rhythmScore.toFixed(2)}`} className="bg-accent/20 text-accent border-accent/30" onSuppress={onSuppressBadge ? () => onSuppressBadge("rhythm") : undefined} />
    );
  }
  if (analysis && !analysis.isDead && analysis.dynamicScore >= 0.5 && !suppressedTypes?.has("dynamic")) {
    items.push(
      <AnalysisBadgePill key="dyn" label="〜 wide" title={`Dynamic ${analysis.dynamicScore.toFixed(2)}`} className="bg-green-500/20 text-green-300 border-green-500/30" onSuppress={onSuppressBadge ? () => onSuppressBadge("dynamic") : undefined} />
    );
  }
  if (analysis && analysis.melodyScore !== undefined && analysis.melodyScore >= 0.5 && !suppressedTypes?.has("melody")) {
    items.push(
      <AnalysisBadgePill key="mel" label={`🎵 ${analysis.melodyScore!.toFixed(2)}`} title={`Melody ${analysis.melodyScore!.toFixed(2)}`} className="bg-pink-500/20 text-pink-300 border-pink-500/30" onSuppress={onSuppressBadge ? () => onSuppressBadge("melody") : undefined} />
    );
  }

  for (const b of userBadges ?? []) {
    items.push(<BadgePill key={b.id} badge={b} onBadgeClick={onBadgeClick} onDeleteBadge={onDeleteBadge} />);
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

function AnalysisBadgePill({ label, title, className, onSuppress }: {
  label: string;
  title: string;
  className: string;
  onSuppress?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      className="inline-flex items-center gap-0.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span title={title} className={`inline-block text-[9px] px-1.5 py-[1px] rounded-full border ${className}`}>
        {label}
      </span>
      {onSuppress && (
        <button
          onClick={(e) => { e.stopPropagation(); onSuppress(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-[9px] text-gray-600 hover:text-red-400 leading-none transition-opacity"
          style={{ opacity: hovered ? 1 : 0 }}
          title="Dismiss"
        >
          ×
        </button>
      )}
    </span>
  );
}

function BadgePill({ badge, onBadgeClick, onDeleteBadge }: {
  badge: LaneBadge;
  onBadgeClick: (b: LaneBadge) => void;
  onDeleteBadge?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = badge.color ?? hashColor(badge.label);
  return (
    <span
      className="inline-flex items-center gap-0.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onBadgeClick(badge); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="text-[9px] px-1.5 py-[1px] rounded-full border"
        style={{ background: `${color}33`, color, borderColor: `${color}55` }}
        title="Click to edit"
      >
        ⭐ {badge.label}
      </button>
      {onDeleteBadge && (
        <button
          onClick={(e) => { e.stopPropagation(); onDeleteBadge(badge.id); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-[9px] text-gray-600 hover:text-red-400 leading-none transition-opacity"
          style={{ opacity: hovered ? 1 : 0 }}
          title="Remove badge"
        >
          ×
        </button>
      )}
    </span>
  );
}

function hashColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 60%, 65%)`;
}
