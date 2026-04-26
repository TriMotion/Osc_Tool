"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { AudioLines, Send, Radio, Clock, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRecorderContext } from "@/contexts/recorder-context";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  accent: string;
  accentBg: string;
  accentBorder: string;
}

const navItems: NavItem[] = [
  {
    href: "/input",
    label: "Input",
    icon: AudioLines,
    accent: "text-input",
    accentBg: "bg-input/10",
    accentBorder: "border-input/25",
  },
  {
    href: "/output",
    label: "Output",
    icon: Send,
    accent: "text-output",
    accentBg: "bg-output/10",
    accentBorder: "border-output/25",
  },
  {
    href: "/deck",
    label: "Live",
    icon: Radio,
    accent: "text-deck",
    accentBg: "bg-deck/10",
    accentBorder: "border-deck/25",
  },
  {
    href: "/timeline",
    label: "Timeline",
    icon: Clock,
    accent: "text-timeline",
    accentBg: "bg-timeline/10",
    accentBorder: "border-timeline/25",
  },
  {
    href: "/diagnostics",
    label: "Diagnostics",
    icon: Wrench,
    accent: "text-diag",
    accentBg: "bg-diag/10",
    accentBorder: "border-diag/25",
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const recorder = useRecorderContext();
  const recName = recorder.recording?.name;

  return (
    <nav className="w-56 bg-black border-r border-white/[0.04] flex flex-col pt-3 pb-6 px-3 gap-1">
      <div className="h-8 mb-2" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      <h1 className="text-input font-bold text-lg px-3 mb-4 tracking-tight">
        Oscilot
      </h1>
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              isActive ? "text-white" : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]"
            }`}
          >
            {isActive && (
              <motion.div
                layoutId="sidebar-active"
                className={`absolute inset-0 ${item.accentBg} border ${item.accentBorder} rounded-lg`}
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
            <Icon
              size={20}
              strokeWidth={1.5}
              className={`relative z-10 ${isActive ? item.accent : ""}`}
            />
            <span className="relative z-10 font-medium">{item.label}</span>
          </Link>
        );
      })}
      <div className="flex-1" />
      {recName && (
        <div className="px-3 py-2 border-t border-white/[0.04]">
          <div className="flex items-center gap-1.5 min-w-0">
            {recorder.hasUnsaved && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            )}
            <span className="text-[11px] text-gray-500 truncate" title={recName}>{recName}</span>
          </div>
        </div>
      )}
    </nav>
  );
}
