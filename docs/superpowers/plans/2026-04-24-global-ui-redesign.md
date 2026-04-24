# Global UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Oscilot desktop app from dark blue-gray + single cyan accent to true black + semantic domain-colored accents, consolidate navigation from 8 to 5 items, and add toast notifications, solid modals, and a global MIDI bridge in the status bar.

**Architecture:** Foundation-first approach — theme tokens and layout come first, then navigation consolidation, then new route pages, then infrastructure (toast, modals), then component restyling pass. Each task produces a buildable app.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, Framer Motion 12, Lucide React (new), Electron 41

**Spec:** `docs/superpowers/specs/2026-04-24-global-ui-redesign-design.md`

---

### Task 1: Install Lucide Icons

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install lucide-react**

```bash
pnpm add lucide-react
```

- [ ] **Step 2: Verify installation**

```bash
pnpm next build 2>&1 | tail -5
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add lucide-react icon library"
```

---

### Task 2: Theme Foundation — Tailwind Config & Global CSS

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace tailwind.config.ts with new color system**

Replace the entire `theme.extend.colors` object. Keep the old `surface` and `accent` tokens temporarily as aliases so the build doesn't break while we migrate components.

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // New surface system
        panel: "#0a0a0a",
        elevated: "#111111",

        // Domain accents
        input: {
          DEFAULT: "#00ff8c",
          dim: "#00cc70",
        },
        output: {
          DEFAULT: "#f59e0b",
          dim: "#d97706",
        },
        deck: {
          DEFAULT: "#b91c1c",
          dim: "#991b1b",
        },
        timeline: {
          DEFAULT: "#4488ff",
          dim: "#3366cc",
        },
        diag: {
          DEFAULT: "#555555",
          dim: "#444444",
        },

        // Semantic status
        success: "#22c55e",
        warning: "#f59e0b",
        error: "#ef4444",
        info: "#888888",

        // Legacy aliases (remove after migration)
        surface: {
          DEFAULT: "#000000",
          light: "#0a0a0a",
          lighter: "#111111",
        },
        accent: {
          DEFAULT: "#00ff8c",
          dim: "#00cc70",
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

Note: The legacy `surface` and `accent` aliases now point to the new values (`#000`, `#0a0a0a`, `#111`, `#00ff8c`). This means existing components immediately get the true black theme without individually updating each one. They'll be cleaned up in the restyling tasks.

- [ ] **Step 2: Add scrollbar and base styles to globals.css**

```css
@import "tailwindcss";

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: #222;
}
::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: #555;
}

/* Hide scrollbar until hover on scrollable containers */
.scroll-thin {
  scrollbar-width: thin;
  scrollbar-color: #444 #222;
}
```

- [ ] **Step 3: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

Expected: Build succeeds. The app now renders on true black via the aliased surface tokens.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts src/app/globals.css
git commit -m "feat: true black theme foundation with domain color tokens"
```

---

### Task 3: Layout — True Black Body

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Update body and layout classes**

In `src/app/layout.tsx`, change the body class from `bg-surface` to `bg-black`:

```tsx
<body className="bg-black text-gray-100 h-screen flex flex-col overflow-hidden">
```

No other changes to layout.tsx yet — sidebar and status bar are updated in their own tasks.

- [ ] **Step 2: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: true black body background"
```

---

### Task 4: Sidebar — 5 Items with Domain Colors and Lucide Icons

**Files:**
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Rewrite sidebar with new nav items, icons, and domain colors**

Replace the entire file:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { AudioLines, Send, LayoutGrid, Clock, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
    label: "Deck",
    icon: LayoutGrid,
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
    </nav>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

Expected: Build succeeds. Sidebar now shows 5 items with Lucide icons and domain colors. Navigating to old routes (e.g. `/listener`) will 404 — that's expected until we create the new route pages.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat: 5-item sidebar with domain colors and Lucide icons"
```

---

### Task 5: Home Redirect

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Change redirect from /listener to /input**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/input");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: redirect home to /input"
```

---

### Task 6: Input Page — Merge Listener + MIDI with Tabs

**Files:**
- Create: `src/app/input/page.tsx`

This page renders a tab bar with "OSC Listener" and "MIDI Devices" tabs. Each tab renders the content that currently lives in `src/app/listener/page.tsx` and `src/app/midi/page.tsx`. We move the actual content inline rather than importing pages (Next.js pages can't be imported as components).

- [ ] **Step 1: Create the Input page with tab state and both panels**

Create `src/app/input/page.tsx`. This file combines the state and UI from both `listener/page.tsx` (121 lines) and `midi/page.tsx` (345 lines) into a single tabbed page.

```tsx
"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// --- Import all hooks and components used by both pages ---
// Listener imports
import { MessageLog } from "@/components/message-log";
import { EndpointPicker } from "@/components/endpoint-picker";
import { useOscListener, useListenerControl } from "@/hooks/use-osc";
// MIDI imports
import { useMidiControl, useMidiConfig, useMidiEvents } from "@/hooks/use-midi";
import { useEndpoints } from "@/hooks/use-osc";
// Types
import type { OscMessage, OscArg, MidiEvent, MidiMappingRule, SavedEndpoint } from "@/lib/types";

type Tab = "listener" | "midi";

export default function InputPage() {
  const [activeTab, setActiveTab] = useState<Tab>("listener");

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-white/[0.06] shrink-0">
        <button
          onClick={() => setActiveTab("listener")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
            activeTab === "listener" ? "text-input" : "text-[#444] hover:text-gray-300"
          }`}
        >
          OSC Listener
          {activeTab === "listener" && (
            <motion.div
              layoutId="input-tab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-input"
              transition={{ duration: 0.15 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab("midi")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
            activeTab === "midi" ? "text-input" : "text-[#444] hover:text-gray-300"
          }`}
        >
          MIDI Devices
          {activeTab === "midi" && (
            <motion.div
              layoutId="input-tab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-input"
              transition={{ duration: 0.15 }}
            />
          )}
        </button>
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="flex-1 overflow-auto pt-4"
        >
          {activeTab === "listener" ? <ListenerPanel /> : <MidiPanel />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
```

The `<ListenerPanel />` component should contain the full content from `src/app/listener/page.tsx` (lines 10–120, everything inside the `ListenerPage` function return, plus its state/hooks). The `<MidiPanel />` should contain the full content from `src/app/midi/page.tsx` (lines 27–344, state/hooks/return).

Extract them as function components in the same file or as separate files at `src/components/input/listener-panel.tsx` and `src/components/input/midi-panel.tsx`.

**Key restyling to apply during extraction:**
- Replace all `bg-surface`, `bg-surface-light`, `bg-surface-lighter` with `bg-black`, `bg-panel`, `bg-elevated`
- Replace all `text-accent`, `border-accent` with `text-input`, `border-input`
- Replace all `bg-accent` with `bg-input`
- Replace emoji references if any remain
- Add `title` attributes to all truncated text (device names, addresses)
- Remove the MIDI bridge start/stop UI from the MIDI panel (bridge moves to status bar in Task 8)

- [ ] **Step 2: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 3: Verify in dev mode**

```bash
pnpm electron:dev
```

Navigate to Input tab. Verify both tabs render and switch with fade animation.

- [ ] **Step 4: Commit**

```bash
git add src/app/input/
git commit -m "feat: Input page merging OSC Listener and MIDI Devices with tabs"
```

---

### Task 7: Output Page — Merge Sender + DMX with Tabs

**Files:**
- Create: `src/app/output/page.tsx`

Same pattern as Task 6. Tab bar with "OSC Sender" and "DMX" tabs.

- [ ] **Step 1: Create the Output page with tab state and both panels**

Create `src/app/output/page.tsx` following the exact same tab pattern as the Input page (Task 6), but using the Output domain accent (`text-output`, `bg-output`, `border-output`).

Extract sender content from `src/app/sender/page.tsx` (287 lines) into a `<SenderPanel />` and DMX content from `src/app/dmx/page.tsx` (387 lines) into a `<DmxPanel />`. These can live as separate files at `src/components/output/sender-panel.tsx` and `src/components/output/dmx-panel.tsx`.

**Key restyling during extraction:**
- Replace `text-accent`/`border-accent`/`bg-accent` → `text-output`/`border-output`/`bg-output`
- Replace `bg-surface*` → `bg-black`/`bg-panel`/`bg-elevated`
- Replace `text-amber-500/70` DMX warnings → use semantic `text-warning` or keep `text-amber-500` (it matches the Output domain)
- Add `title` attributes to truncated effect names and addresses

- [ ] **Step 2: Verify build and test in dev mode**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/app/output/
git commit -m "feat: Output page merging OSC Sender and DMX with tabs"
```

---

### Task 8: Status Bar — MIDI Bridge Integration

**Files:**
- Modify: `src/components/status-bar.tsx`

The status bar absorbs the MIDI bridge control. It needs to import `useMidiControl` and show bridge status + start/stop.

- [ ] **Step 1: Rewrite status-bar.tsx with bridge controls**

```tsx
"use client";

import { useState, useCallback, useEffect } from "react";
import { useOscThroughput, useWebServer } from "@/hooks/use-osc";
import { useMidiControl } from "@/hooks/use-midi";

export function StatusBar() {
  const [localIp, setLocalIp] = useState("");
  const throughput = useOscThroughput();
  const { running: bridgeRunning, start: startBridge, stop: stopBridge } = useMidiControl();
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api) {
      api.invoke("system:get-local-ip").then((ip: string) => setLocalIp(ip));
    }
  }, []);

  const { running: webRunning, url, start: startWeb, stop: stopWeb } = useWebServer();
  const [webPort, setWebPort] = useState("4000");
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = useCallback(async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [url]);

  const handleWebToggle = async () => {
    if (webRunning) await stopWeb();
    else await startWeb(parseInt(webPort, 10));
  };

  const handleBridgeToggle = async () => {
    try {
      setBridgeError(null);
      if (bridgeRunning) await stopBridge();
      else await startBridge();
    } catch (err) {
      setBridgeError(String(err));
    }
  };

  return (
    <div className="h-8 bg-black border-t border-white/[0.04] flex items-center px-4 text-xs text-[#444] gap-4">
      {/* MIDI Bridge */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full transition-colors duration-200 ${
            bridgeRunning ? "bg-success shadow-[0_0_6px_#22c55e]" : "bg-[#333]"
          }`}
        />
        <span className="text-[#666]">Bridge</span>
        <button
          onClick={handleBridgeToggle}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            bridgeRunning
              ? "bg-error/10 text-error border border-error/20 hover:bg-error/20"
              : "bg-elevated border border-white/[0.06] text-[#666] hover:text-[#aaa]"
          }`}
        >
          {bridgeRunning ? "Stop" : "Start"}
        </button>
        {bridgeError && (
          <span className="text-error truncate max-w-[200px]" title={bridgeError}>
            {bridgeError}
          </span>
        )}
      </div>

      <span className="text-[#222]">|</span>

      {/* OSC Throughput */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full transition-colors duration-200 ${
            throughput > 0 ? "bg-input animate-pulse" : "bg-[#333]"
          }`}
        />
        <span>{throughput} msg/s</span>
      </div>

      {localIp && (
        <>
          <span className="text-[#222]">|</span>
          <span className="text-[#666]">{localIp}</span>
        </>
      )}

      {/* Web UI */}
      <div className="ml-auto flex items-center gap-2">
        {!webRunning && (
          <input
            type="text"
            value={webPort}
            onChange={(e) => setWebPort(e.target.value)}
            className="bg-elevated border border-white/[0.06] rounded px-2 py-0.5 w-16 text-xs focus:border-input/18 focus:outline-none"
            placeholder="Port"
          />
        )}
        {webRunning && (
          <button
            onClick={handleCopyUrl}
            className="px-2 py-0.5 rounded text-xs text-input hover:text-input-dim transition-colors"
          >
            {copied ? "Copied!" : url}
          </button>
        )}
        <button
          onClick={handleWebToggle}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${
            webRunning
              ? "bg-error/10 text-error border border-error/20 hover:bg-error/20"
              : "bg-elevated border border-white/[0.06] text-[#666] hover:text-[#aaa]"
          }`}
        >
          {webRunning ? "Stop" : "Start Web UI"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/components/status-bar.tsx
git commit -m "feat: global MIDI bridge control in status bar"
```

---

### Task 9: Deck Page — Edit/Perform Toggle

**Files:**
- Modify: `src/app/deck/page.tsx`

Add a segmented `Edit | Live` toggle in the topbar. When in Live mode, hide toolbar/config panel, show full-width grid + live components (SectionSelector, DeviceStrip, ActivityFeed).

- [ ] **Step 1: Add perform mode state and imports**

At the top of `src/app/deck/page.tsx`, add imports for live components:

```tsx
import { SectionSelector } from "@/components/live/section-selector";
import { DeviceStrip } from "@/components/live/device-strip";
import { ActivityFeed } from "@/components/live/activity-feed";
import { useLiveMonitor } from "@/hooks/use-live-monitor";
import { useRecorderContext } from "@/contexts/recorder-context";
import { useMidiControl } from "@/hooks/use-midi";
```

Add a `mode` state:

```tsx
const [mode, setMode] = useState<"edit" | "live">("edit");
```

Add live monitoring hooks (only active in live mode):

```tsx
const recorder = useRecorderContext();
const { devices: connectedPorts } = useMidiControl();
const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
const [liveEndpoints, setLiveEndpoints] = useState<SavedEndpoint[]>([]);

useEffect(() => {
  window.electronAPI?.invoke("endpoints:get-all", "sender").then((res) => {
    setLiveEndpoints((res as SavedEndpoint[]) ?? []);
  });
}, []);

const { entries, deviceActivity } = useLiveMonitor({
  recording: recorder.recording,
  endpoints: liveEndpoints,
  activeSectionId,
});
```

- [ ] **Step 2: Add mode toggle to the topbar area**

After the `DeckTopbar` component, add a segmented control:

```tsx
<div className="flex items-center gap-2 shrink-0 px-4 py-2 border-b border-white/[0.04]">
  <DeckTopbar {/* ... existing props ... */} />
  <div className="ml-auto flex bg-elevated rounded-lg p-0.5 border border-white/[0.06]">
    <button
      onClick={() => setMode("edit")}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        mode === "edit"
          ? "bg-deck text-white"
          : "text-[#666] hover:text-[#aaa]"
      }`}
    >
      Edit
    </button>
    <button
      onClick={() => setMode("live")}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        mode === "live"
          ? "bg-deck text-white"
          : "text-[#666] hover:text-[#aaa]"
      }`}
    >
      Live
    </button>
  </div>
</div>
```

- [ ] **Step 3: Conditionally render edit vs live layout**

Wrap the existing grid + toolbar + config panel in a mode check:

```tsx
{mode === "edit" ? (
  <div className="flex-1 flex overflow-hidden">
    {/* existing: DeckToolbar + DeckGrid + DeckConfigPanel */}
  </div>
) : (
  <div className="flex-1 flex flex-col overflow-hidden">
    <SectionSelector
      recording={recorder.recording}
      activeSectionId={activeSectionId}
      onSelect={setActiveSectionId}
    />
    <DeviceStrip devices={connectedPorts} activity={deviceActivity} />
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 overflow-auto">
        <DeckGrid
          {/* ... existing props, but editMode={false} ... */}
        />
      </div>
      <ActivityFeed entries={entries} />
    </div>
  </div>
)}
```

- [ ] **Step 4: Restyle deck page surfaces**

Replace all `bg-surface*` → `bg-black`/`bg-panel`/`bg-elevated` and `text-accent`/`border-accent` → `text-deck`/`border-deck` throughout the file.

- [ ] **Step 5: Verify build and test**

```bash
pnpm next build 2>&1 | tail -5
```

Test in dev mode: verify Edit mode preserves all existing functionality. Toggle to Live mode and verify live components render.

- [ ] **Step 6: Commit**

```bash
git add src/app/deck/page.tsx
git commit -m "feat: deck edit/perform mode toggle with live components"
```

---

### Task 10: Toast Notification System

**Files:**
- Create: `src/components/toast.tsx`
- Create: `src/contexts/toast-context.tsx`
- Modify: `src/components/client-layout.tsx`

- [ ] **Step 1: Create toast context**

Create `src/contexts/toast-context.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useState } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-2), { id, message, type, createdAt: Date.now() }]);
    setTimeout(() => removeToast(id), 4000);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
```

- [ ] **Step 2: Create toast display component**

Create `src/components/toast.tsx`:

```tsx
"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useToast } from "@/contexts/toast-context";

const borderColors = {
  success: "border-l-success",
  error: "border-l-error",
  warning: "border-l-warning",
  info: "border-l-info",
};

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="fixed bottom-12 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.15 }}
            className={`pointer-events-auto bg-panel border border-white/[0.06] rounded-lg px-4 py-3 text-sm text-[#aaa] max-w-sm border-l-2 ${borderColors[toast.type]} flex items-start gap-3`}
          >
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-[#444] hover:text-[#aaa] transition-colors shrink-0"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 3: Wire into client-layout**

In `src/components/client-layout.tsx`, wrap children with `ToastProvider` and render `ToastContainer`:

```tsx
import { ToastProvider } from "@/contexts/toast-context";
import { ToastContainer } from "@/components/toast";

// Inside the return:
<ToastProvider>
  <RecorderProvider>
    {children}
  </RecorderProvider>
  <ToastContainer />
</ToastProvider>
```

- [ ] **Step 4: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/contexts/toast-context.tsx src/components/toast.tsx src/components/client-layout.tsx
git commit -m "feat: toast notification system with context provider"
```

---

### Task 11: Replace Browser Alerts

**Files:**
- Modify: `src/app/timeline/page.tsx` (lines 196, 280, 378, 618)

- [ ] **Step 1: Import useToast and replace all 4 alert() calls**

Add import at top of `src/app/timeline/page.tsx`:

```tsx
import { useToast } from "@/contexts/toast-context";
```

Inside the component:

```tsx
const { addToast } = useToast();
```

Replace each `alert()`:

- Line 196: `alert("Start the MIDI bridge first (MIDI tab).")` → `addToast("Start the MIDI bridge first.", "warning")`
- Line 280: `alert("Stop the current recording before loading another file.")` → `addToast("Stop the current recording before loading another file.", "warning")`
- Line 378: `alert("Stop the current recording before importing a MIDI file.")` → `addToast("Stop the current recording before importing a MIDI file.", "warning")`
- Line 618: `alert("Hover a lane first to choose which one to tag.")` → `addToast("Hover a lane first to choose which one to tag.", "info")`

- [ ] **Step 2: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/app/timeline/page.tsx
git commit -m "fix: replace browser alert() calls with toast notifications"
```

---

### Task 12: Modal Restyling — Solid Backgrounds

**Files:**
- Modify: `src/components/timeline/badge-editor-modal.tsx`
- Modify: `src/app/timeline/page.tsx` (discard modal, note editor modal)

- [ ] **Step 1: Fix badge-editor-modal.tsx backdrop**

In `src/components/timeline/badge-editor-modal.tsx`, replace the backdrop:

Old: `className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"`
New: `className="fixed inset-0 bg-black flex items-center justify-center z-50"`

Replace inner container styling:

Old: `className="bg-surface-light border border-white/10 rounded-lg p-4 w-72 shadow-xl"`
New: `className="bg-panel border border-white/[0.06] rounded-lg p-4 w-72"`

Replace any `text-accent`/`border-accent`/`bg-accent` → `text-timeline`/`border-timeline`/`bg-timeline` (this modal is used from the Timeline page).

- [ ] **Step 2: Fix discard confirmation modal in timeline/page.tsx**

Search for `bg-black/60` in `src/app/timeline/page.tsx` and replace all occurrences with `bg-black`. Replace `bg-surface-light` with `bg-panel` in modal containers.

- [ ] **Step 3: Fix note editor modal**

Same pattern — find the note editor modal backdrop, replace `bg-black/60` → `bg-black`, restyle container.

- [ ] **Step 4: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/components/timeline/badge-editor-modal.tsx src/app/timeline/page.tsx
git commit -m "fix: solid black backgrounds on all modals, no opacity overlays"
```

---

### Task 13: Remove Old Routes

**Files:**
- Delete: `src/app/listener/page.tsx`
- Delete: `src/app/sender/page.tsx`
- Delete: `src/app/midi/page.tsx`
- Delete: `src/app/dmx/page.tsx`
- Delete: `src/app/live/page.tsx`

- [ ] **Step 1: Delete old page files**

Only do this after Tasks 6 and 7 are complete and verified.

```bash
rm src/app/listener/page.tsx
rm src/app/sender/page.tsx
rm src/app/midi/page.tsx
rm src/app/dmx/page.tsx
rm src/app/live/page.tsx
rmdir src/app/listener src/app/sender src/app/midi src/app/dmx src/app/live
```

- [ ] **Step 2: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

Expected: Build succeeds. No imports reference the deleted files (content was moved to new pages).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove old routes (listener, sender, midi, dmx, live)"
```

---

### Task 14: Timeline Page Restyling

**Files:**
- Modify: `src/app/timeline/page.tsx`
- Modify: `src/components/timeline/osc-mapping-editor.tsx`
- Modify: `src/components/timeline/badge-editor-modal.tsx`
- Modify: `src/components/timeline/device-section.tsx`
- Modify: `src/components/timeline/triggers-sidebar.tsx`
- Modify: `src/components/timeline/lane-badges.tsx`
- Modify: `src/components/timeline/hover-card.tsx`
- Modify: `src/components/timeline/note-tag-editor.tsx`
- Modify: `src/components/timeline/timeline-toolbar.tsx`

Apply these find-and-replace patterns across all timeline files:

- [ ] **Step 1: Surface colors**

In every file listed above:
- `bg-surface-lighter` → `bg-elevated`
- `bg-surface-light` → `bg-panel`
- `bg-surface` → `bg-black`

- [ ] **Step 2: Accent colors**

- `text-accent` → `text-timeline`
- `border-accent` → `border-timeline`
- `bg-accent` → `bg-timeline`
- `text-accent-dim` → `text-timeline-dim`
- `focus:border-accent/50` → `focus:border-timeline/18`

- [ ] **Step 3: Hardcoded color conflicts**

In `osc-mapping-editor.tsx`:
- `bg-[#1e3a5f] border-blue-500/40 text-blue-300` (OSC output) → `bg-output/10 border-output/25 text-output`
- `bg-amber-500/15 border-amber-500/40 text-amber-300` (DMX output) → `bg-output/10 border-output/25 text-output`

In `lane-badges.tsx`:
- `bg-pink-500/20 text-pink-300` → `bg-timeline/20 text-timeline`

In `triggers-sidebar.tsx`:
- Replace emoji `🎵` with a Lucide icon (e.g. `Music` from lucide-react)

- [ ] **Step 4: Remove MIDI bridge bar from timeline page**

In `src/app/timeline/page.tsx`, remove the bridge status/start/stop UI that currently renders at the top. Bridge is now in the global status bar (Task 8). Keep the bridge state hooks only if other timeline functionality depends on `bridgeRunning` (e.g. recording control).

- [ ] **Step 5: Border radius standardization**

Replace any `rounded-xl` with `rounded-lg` across all timeline files.

- [ ] **Step 6: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add src/app/timeline/ src/components/timeline/
git commit -m "feat: restyle timeline page and components to true black theme"
```

---

### Task 15: Shared Components Restyling

**Files:**
- Modify: `src/components/message-log.tsx`
- Modify: `src/components/osc-input.tsx`
- Modify: `src/components/endpoint-picker.tsx`

These are used across multiple pages. They should use generic classes that the parent page context provides color for, or accept an accent color prop.

- [ ] **Step 1: Restyle message-log.tsx**

- `bg-surface*` → `bg-panel`/`bg-elevated`
- `text-accent` → accept as a prop `accentClass?: string` defaulting to `"text-input"`
- Add `title` attributes to any truncated address text

- [ ] **Step 2: Restyle osc-input.tsx**

- `bg-surface*` → `bg-elevated`
- `text-accent`/`border-accent` → accept as prop or use contextual color
- `focus:border-accent/50` → `focus:border-white/10`

- [ ] **Step 3: Restyle endpoint-picker.tsx**

- Same surface and accent replacements
- Add `title` attribute on endpoint name display if truncated

- [ ] **Step 4: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/components/message-log.tsx src/components/osc-input.tsx src/components/endpoint-picker.tsx
git commit -m "feat: restyle shared components to true black theme"
```

---

### Task 16: Deck Components Restyling

**Files:**
- Modify: `src/components/deck-topbar.tsx`
- Modify: `src/components/deck-toolbar.tsx`
- Modify: `src/components/deck-grid.tsx`
- Modify: `src/components/deck-item.tsx`
- Modify: `src/components/deck-group.tsx`
- Modify: `src/components/deck-config-panel.tsx`

- [ ] **Step 1: Apply surface and accent replacements**

Across all deck component files:
- `bg-surface*` → `bg-black`/`bg-panel`/`bg-elevated`
- `text-accent`/`border-accent`/`bg-accent` → `text-deck`/`border-deck`/`bg-deck`
- `rounded-xl` → `rounded-lg`

- [ ] **Step 2: Add title attributes to truncated addresses**

In `deck-item.tsx`:
- Line with `truncate max-w-full` for OSC address — add `title={address}`
- Lines with `truncate` for `xAddress`/`yAddress` — add `title={xAddress}` and `title={yAddress}`

- [ ] **Step 3: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/components/deck-*.tsx
git commit -m "feat: restyle deck components to true black theme"
```

---

### Task 17: Live Components Restyling

**Files:**
- Modify: `src/components/live/activity-feed.tsx`
- Modify: `src/components/live/device-strip.tsx`
- Modify: `src/components/live/live-deck.tsx`
- Modify: `src/components/live/mapping-config-panel.tsx`
- Modify: `src/components/live/section-selector.tsx`

- [ ] **Step 1: Apply surface, accent, and domain color replacements**

Across all live component files:
- `bg-surface*` → `bg-black`/`bg-panel`/`bg-elevated`
- `text-accent`/`border-accent`/`bg-accent` → `text-deck`/`border-deck`/`bg-deck` (live components now live in the Deck page)
- MIDI activity blue (`shadow-[0_0_6px_rgba(96,165,250,0.8)]`) → keep as-is or use `text-input` glow for input activity
- OSC activity amber → keep as-is (matches output domain)

- [ ] **Step 2: Add title attributes**

In `activity-feed.tsx`: add `title={entry.address}` to the truncated address span.

- [ ] **Step 3: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/components/live/
git commit -m "feat: restyle live components to true black theme"
```

---

### Task 18: Diagnostics Page Restyling

**Files:**
- Modify: `src/app/diagnostics/page.tsx`

- [ ] **Step 1: Apply surface and accent replacements**

- `bg-surface*` → `bg-black`/`bg-panel`/`bg-elevated`
- `text-accent`/`border-accent` → `text-diag`/`border-diag`
- `rounded-xl` → `rounded-lg`

- [ ] **Step 2: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/app/diagnostics/page.tsx
git commit -m "feat: restyle diagnostics page to true black theme"
```

---

### Task 19: DMX Components Restyling

**Files:**
- Modify: `src/components/dmx/dmx-settings.tsx`
- Modify: `src/components/dmx/osc-trigger-panel.tsx`
- Modify: `src/components/dmx/curve-editor.tsx`
- Modify: `src/components/dmx/segment-strip.tsx`
- Modify: `src/components/dmx/dmx-fader-tile.tsx`
- Modify: `src/components/dmx/dmx-flash-tile.tsx`
- Modify: `src/components/dmx/dmx-trigger-tile.tsx`

- [ ] **Step 1: Apply surface and accent replacements**

- `bg-surface*` → `bg-black`/`bg-panel`/`bg-elevated`
- `text-accent`/`border-accent`/`bg-accent` → `text-output`/`border-output`/`bg-output` (DMX lives in the Output page)
- Replace emoji icons with Lucide equivalents if any exist in these files

- [ ] **Step 2: Add title to truncated effect names**

In `dmx-trigger-tile.tsx`: add `title={effectName}` to truncated names.

- [ ] **Step 3: Verify build**

```bash
pnpm next build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/components/dmx/
git commit -m "feat: restyle DMX components to true black theme"
```

---

### Task 20: Remove Legacy Color Aliases

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Remove legacy surface and accent aliases**

After all component restyling is complete and verified, remove the legacy aliases from `tailwind.config.ts`:

Delete these entries:
```typescript
// Legacy aliases (remove after migration)
surface: {
  DEFAULT: "#000000",
  light: "#0a0a0a",
  lighter: "#111111",
},
accent: {
  DEFAULT: "#00ff8c",
  dim: "#00cc70",
},
```

- [ ] **Step 2: Verify build — hunt for any remaining references**

```bash
pnpm next build 2>&1 | tail -20
grep -r "bg-surface\|text-surface\|border-surface\|text-accent\|bg-accent\|border-accent" src/ --include="*.tsx" --include="*.ts" -l
```

Expected: No files found. If any remain, fix them before proceeding.

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "chore: remove legacy surface/accent color aliases"
```

---

### Task 21: Final Build Verification

- [ ] **Step 1: Full production build**

```bash
pnpm next build 2>&1 | tail -10
```

Expected: Zero errors, zero warnings about missing classes.

- [ ] **Step 2: Dev mode smoke test**

```bash
pnpm electron:dev
```

Navigate through all 5 tabs. Verify:
- Input: Both OSC Listener and MIDI tabs render, tab switching works
- Output: Both OSC Sender and DMX tabs render
- Deck: Edit/Live toggle works, grid renders in both modes
- Timeline: All lanes render, badge editor opens with solid background
- Diagnostics: Renders correctly
- Status bar: Bridge start/stop works, throughput shows, web UI toggle works
- Toast: Trigger a warning (e.g. try to tag a lane without hovering) — toast appears bottom-right

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final UI polish and build verification"
```
