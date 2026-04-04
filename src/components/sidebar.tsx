"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

const navItems = [
  { href: "/listener", label: "Listener", icon: "📡" },
  { href: "/sender", label: "Sender", icon: "📤" },
  { href: "/deck", label: "Deck", icon: "🎛" },
  { href: "/diagnostics", label: "Diagnostics", icon: "🔬" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="w-56 bg-surface-light border-r border-white/5 flex flex-col py-6 px-3 gap-1">
      <h1 className="text-accent font-bold text-lg px-3 mb-6 tracking-tight">
        OSC Tool
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
