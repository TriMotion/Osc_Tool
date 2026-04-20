"use client";

import { useMemo, useState } from "react";
import type { LaneAnalysis, LaneBadge, Moment, OscMapping, RedundancyPair } from "@/lib/types";
import { momentColor } from "@/lib/moment-detection";

interface TriggersSidebarProps {
  analyses: LaneAnalysis[] | null;
  pairs: RedundancyPair[] | null;
  moments: Moment[] | null;
  ready: boolean;
  error: string | null;
  userBadges: LaneBadge[];
  laneLabelFor: (laneKey: string) => string;
  onSelectLane: (laneKey: string) => void;
  onSelectPair: (a: string, b: string) => void;
  onSelectMoment: (m: Moment) => void;
  onTagCurrentLane: () => void;
  oscMappings: OscMapping[];
  focusedSectionId: string | null;
}

type SectionKey = "moments" | "rhythm" | "melody" | "dynamic" | "redundant" | "tagged";

export function TriggersSidebar(props: TriggersSidebarProps) {
  const { analyses, pairs, moments, ready, error, userBadges, laneLabelFor, onSelectLane, onSelectPair, onSelectMoment, onTagCurrentLane, oscMappings, focusedSectionId } = props;

  const visible = focusedSectionId
    ? oscMappings.filter((m) => m.sectionId === focusedSectionId)
    : oscMappings.filter((m) => !m.sectionId);

  const mappingsLabel = focusedSectionId
    ? `Mappings in this song — ${visible.length}`
    : `Unassigned mappings — ${visible.length}`;

  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    moments: true, rhythm: true, melody: false, dynamic: false, redundant: false, tagged: true,
  });

  const rhythmic = useMemo(() => {
    if (!analyses) return [];
    return [...analyses]
      .filter((a) => !a.isDead && a.rhythmScore >= 0.5)
      .sort((a, b) => b.rhythmScore - a.rhythmScore)
      .slice(0, 10);
  }, [analyses]);

  const melodic = useMemo(() => {
    if (!analyses) return [];
    return [...analyses]
      .filter((a) => !a.isDead && a.melodyScore !== undefined && a.melodyScore >= 0.5)
      .sort((a, b) => (b.melodyScore ?? 0) - (a.melodyScore ?? 0))
      .slice(0, 5);
  }, [analyses]);

  const dynamicLanes = useMemo(() => {
    if (!analyses) return [];
    return [...analyses]
      .filter((a) => !a.isDead && a.dynamicScore >= 0.5)
      .sort((a, b) => b.dynamicScore - a.dynamicScore)
      .slice(0, 10);
  }, [analyses]);

  const tagged = useMemo(() => {
    const byLabel = new Map<string, LaneBadge[]>();
    for (const b of userBadges) {
      const list = byLabel.get(b.label) ?? [];
      list.push(b);
      byLabel.set(b.label, list);
    }
    return Array.from(byLabel.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [userBadges]);

  const toggle = (k: SectionKey) => setOpen((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div className="w-72 flex-shrink-0 bg-surface-light border-l border-white/10 overflow-y-auto text-xs">
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
        <span className="font-semibold text-sm">Mappings</span>
        {!ready && <span className="text-[10px] text-gray-500 italic">Analyzing…</span>}
      </div>

      <div className="px-3 py-1.5 border-b border-white/5 text-[10px] text-gray-500">
        {mappingsLabel}
        {!focusedSectionId && visible.length > 0 && (
          <p className="text-xs text-amber-300/80 px-2 mb-1">
            These mappings have no song. Extend a song&apos;s range to cover their trigger, or delete.
          </p>
        )}
        {visible.length > 0 ? (
          <div className="flex flex-col gap-1 mt-2">
            {visible.map((m) => (
              <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5 text-xs">
                <span className="font-mono text-accent truncate flex-1">
                  {m.address ?? m.preset ?? "(no address)"}
                </span>
                {!m.sectionId && (
                  <span className="ml-1 px-1 py-0.5 rounded text-[10px] bg-amber-400/10 text-amber-300 border border-amber-400/30">
                    ⚠ outside sections
                  </span>
                )}
                <span className="text-gray-500 text-[10px] truncate max-w-[80px]">{m.deviceId}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-600 px-2 mt-2">No mappings yet.</div>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 text-red-400 text-[10px]">Analysis failed: {error}</div>
      )}

      {ready && !error && analyses && analyses.length === 0 && (
        <div className="px-3 py-2 text-gray-500 italic text-[10px]">No events to analyze.</div>
      )}

      {ready && !error && analyses && analyses.length > 0 && (
        <>
          <Section label="Moments" isOpen={open.moments} onToggle={() => toggle("moments")}>
            {!moments || moments.length === 0 ? <Empty label="No moments detected" /> : moments.map((m) => (
              <button
                key={m.id}
                onClick={() => onSelectMoment(m)}
                className="w-full flex items-center gap-2 px-3 py-1 text-left hover:bg-white/5"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: m.color ?? momentColor(m.kind) }}
                />
                <span className="text-[10px] font-mono text-gray-500 shrink-0 w-10">{fmtMs(m.tMs)}</span>
                <span className="text-[10px] text-gray-300 truncate">{m.label}</span>
              </button>
            ))}
          </Section>

          <Section label="Most rhythmic" isOpen={open.rhythm} onToggle={() => toggle("rhythm")}>
            {rhythmic.length === 0 ? <Empty label="No rhythmic lanes" /> : rhythmic.map((a) => (
              <Row key={a.laneKey} onClick={() => onSelectLane(a.laneKey)} label={laneLabelFor(a.laneKey)} prefix={`♻ ${a.rhythmScore.toFixed(2)}`} />
            ))}
          </Section>

          <Section label="Most melodic" isOpen={open.melody} onToggle={() => toggle("melody")}>
            {melodic.length === 0 ? <Empty label="No melodic lanes" /> : melodic.map((a) => (
              <Row key={a.laneKey} onClick={() => onSelectLane(a.laneKey)} label={laneLabelFor(a.laneKey)} prefix={`🎵 ${(a.melodyScore ?? 0).toFixed(2)}`} />
            ))}
          </Section>

          <Section label="Most dynamic" isOpen={open.dynamic} onToggle={() => toggle("dynamic")}>
            {dynamicLanes.length === 0 ? <Empty label="No dynamic lanes" /> : dynamicLanes.map((a) => (
              <Row key={a.laneKey} onClick={() => onSelectLane(a.laneKey)} label={laneLabelFor(a.laneKey)} prefix={`〜 ${a.dynamicScore.toFixed(2)}`} />
            ))}
          </Section>

          <Section label="Redundant pairs" isOpen={open.redundant} onToggle={() => toggle("redundant")}>
            {!pairs || pairs.length === 0 ? <Empty label="No redundant pairs" /> : pairs.map((p, i) => (
              <Row key={i} onClick={() => onSelectPair(p.laneKeyA, p.laneKeyB)}
                label={`${laneLabelFor(p.laneKeyA)} ↔ ${laneLabelFor(p.laneKeyB)}`}
                prefix={`${Math.round(p.similarity * 100)}%`} />
            ))}
          </Section>

          <Section label="Your tagged" isOpen={open.tagged} onToggle={() => toggle("tagged")}>
            {tagged.length === 0 ? <Empty label="No tagged lanes" /> : tagged.map(([lbl, list]) => (
              <div key={lbl}>
                <div className="px-3 py-1 text-[10px] text-gray-400">⭐ {lbl} ({list.length})</div>
                {list.map((b) => (
                  <Row key={b.id} onClick={() => onSelectLane(b.laneKey)} label={laneLabelFor(b.laneKey)} prefix="" indent />
                ))}
              </div>
            ))}
          </Section>

          <div className="p-3 border-t border-white/10">
            <button
              onClick={onTagCurrentLane}
              className="w-full text-[10px] px-2 py-1.5 border border-white/10 text-gray-300 hover:text-white hover:border-accent/40 rounded"
            >
              + Tag current lane
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ label, isOpen, onToggle, children }: { label: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/5">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold hover:bg-white/5"
      >
        <span className="text-gray-600">{isOpen ? "▾" : "▸"}</span>
        <span>{label}</span>
      </button>
      {isOpen && <div className="pb-1">{children}</div>}
    </div>
  );
}

function Row({ onClick, label, prefix, indent }: { onClick: () => void; label: string; prefix: string; indent?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1 text-left hover:bg-white/5 ${indent ? "pl-8" : ""}`}
    >
      {prefix && <span className="text-accent text-[10px] font-mono shrink-0">{prefix}</span>}
      <span className="truncate text-gray-300 text-[10px]">{label}</span>
    </button>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="px-3 py-1 text-[10px] text-gray-600 italic">{label}</div>;
}

function fmtMs(ms: number): string {
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}
