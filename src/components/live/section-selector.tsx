"use client";

import { motion } from "framer-motion";
import type { TimelineSection, Deck } from "@/lib/types";

interface SectionSelectorProps {
  sections: TimelineSection[];
  activeSectionId: string | null;
  onSelect: (sectionId: string | null) => void;
  deckPresets?: Deck[];
  sectionDeckLinks?: Record<string, string>;
  onLinkDeck?: (sectionId: string, deckId: string | null) => void;
}

export function SectionSelector({ sections, activeSectionId, onSelect, deckPresets, sectionDeckLinks, onLinkDeck }: SectionSelectorProps) {
  if (sections.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-panel/30 shrink-0 overflow-x-auto">
      <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1 shrink-0">
        Section
      </span>
      <button
        onClick={() => onSelect(null)}
        className={`relative text-xs px-3 py-1 rounded-md border transition-colors shrink-0 ${
          activeSectionId === null
            ? "border-deck/50 text-deck bg-deck/10"
            : "border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300"
        }`}
      >
        All
        {activeSectionId === null && (
          <motion.div
            layoutId="section-indicator"
            className="absolute inset-0 rounded-md border border-deck/50"
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        )}
      </button>
      {sections.map((section) => {
        const isActive = activeSectionId === section.id;
        const color = section.color ?? "#6b7280";
        const linkedDeckId = sectionDeckLinks?.[section.id];
        return (
          <div key={section.id} className="flex flex-col items-center gap-0.5 shrink-0">
            <button
              onClick={() => onSelect(section.id)}
              className={`relative text-xs px-3 py-1 rounded-md border transition-colors ${
                isActive
                  ? "text-white"
                  : "border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300"
              }`}
              style={
                isActive
                  ? { borderColor: `${color}80`, background: `${color}20`, color }
                  : undefined
              }
            >
              {section.name}
              {isActive && (
                <motion.div
                  layoutId="section-indicator"
                  className="absolute inset-0 rounded-md border"
                  style={{ borderColor: `${color}80` }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
            </button>
            {onLinkDeck && deckPresets && (
              <select
                value={linkedDeckId ?? "__none__"}
                onChange={(e) => {
                  const val = e.target.value;
                  onLinkDeck(section.id, val === "__none__" ? null : val);
                }}
                className="bg-black border border-white/5 rounded text-[9px] text-gray-500 px-1 py-0 outline-none w-16 text-center"
              >
                <option value="__none__">None</option>
                {deckPresets.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}
