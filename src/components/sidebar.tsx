"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

const navItems = [
  { href: "/listener", label: "Listener", icon: "📡" },
  { href: "/sender", label: "Sender", icon: "📤" },
  { href: "/deck", label: "Deck", icon: "🎛" },
  { href: "/midi", label: "MIDI", icon: "🎹" },
  { href: "/timeline", label: "Timeline", icon: "📼" },
  { href: "/live", label: "Live", icon: "🎙" },
  { href: "/diagnostics", label: "Diagnostics", icon: "🔬" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="w-56 bg-surface-light border-r border-white/5 flex flex-col pt-3 pb-6 px-3 gap-1">
      <div className="h-8 mb-2" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      <h1 className="text-accent font-bold text-lg px-3 mb-4 tracking-tight">
        Oscilot
      </h1>
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              isActive ? "text-white" : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
            }`}
          >
            {isActive && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute inset-0 bg-accent/10 border border-accent/20 rounded-lg"
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
            <span className="relative z-10">{item.icon}</span>
            <span className="relative z-10 font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
