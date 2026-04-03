# OSC Test Tool — Design Spec

## Overview

A cross-platform Electron desktop application for testing OSC (Open Sound Control) communication between applications like Unreal Engine, Resolume Arena, and any other OSC-compatible software. The tool provides a polished GUI for monitoring incoming OSC messages, sending freeform or preset messages, and running self-diagnostics to ensure the tool itself is not a bottleneck.

An optional web interface allows remote debugging from any browser on the network — useful in venue environments.

## Target Platforms

- macOS (`.dmg`)
- Windows (`.exe` via NSIS installer)
- No code signing initially

## Tech Stack

- **Framework:** Electron + Next.js (renderer)
- **Language:** TypeScript throughout
- **OSC Library:** `osc-js` (Node.js UDP transport)
- **Styling:** Tailwind CSS + Framer Motion
- **Package Manager:** pnpm
- **Build:** electron-builder

## Architecture

Two-process Electron architecture:

- **Main process (Node.js):** All OSC communication (UDP send/receive), preset storage, optional web server for remote debugging, diagnostics engine.
- **Renderer process (Next.js):** Polished UI with four views. Communicates with main process via Electron IPC.

### Data Flow

```
External App (Unreal/Resolume/etc.)
        | UDP
   Main Process (Node.js OSC)
        | IPC              | WebSocket (optional)
   Renderer (Next.js)     Web Client (browser)
```

## Supported OSC Types

- float32
- int32
- string
- boolean

Single values and multiple arguments per message. No bundles, blobs, or wildcards in v1.

## UI Design

Dark theme by default (standard in AV/stage environments). Sidebar navigation + main content area.

### View 1: Listener

- Live scrolling log of incoming OSC messages
- Each entry: timestamp, source IP:port, OSC address, value(s), type tags
- Filter by address pattern (e.g. `/resolume/*`) or source IP
- Pause/resume to freeze the feed for inspection
- Clear button
- Auto-scroll with "pinned to bottom" toggle
- Connection config: listen port, bind address (defaults to `0.0.0.0`)
- Support for multiple simultaneous listen ports

### View 2: Sender

- Freeform mode: OSC address field, type dropdown, value field, send button
- Multiple arguments per message (add/remove argument rows)
- Target config: destination IP (default `127.0.0.1`) + port
- Keyboard shortcut: Cmd/Ctrl+Enter to send
- Recent send history for quick resend

### View 3: Presets

- Saved message templates: name, OSC address, default values
- One-click send with defaults, or edit values before sending
- Import/export as JSON for sharing between machines or team members
- Drag to reorder

### View 4: Diagnostics

- **Loopback self-test:** sends a burst of N messages at configurable rate using two ports (send port A, listen port B) since UDP can't bind the same port for both
- Results: throughput (msg/sec), latency (min/avg/max), drop rate
- Port pair auto-configured and torn down after test
- **Live throughput counter** visible in all views via a subtle status bar

## Networking

- Listener binds to `0.0.0.0` by default (all interfaces)
- Sender defaults to `127.0.0.1`, editable for network targets
- Multiple listener ports supported (e.g. 8000 for Resolume, 9000 for Unreal)

## Web Interface (Optional)

- Toggled on/off from the desktop app
- Main process starts Express + WebSocket server on configurable port (default 4000)
- Lightweight React page bundled with the app
- Same look and feel as the desktop UI
- Supports listening and sending only (no preset management or diagnostics)
- Accessible at `http://<machine-ip>:4000`

## Presets Storage

- JSON file in Electron's user data directory (`electron.app.getPath('userData')`)
- Simple, portable, hand-editable

## Project Structure

```
osc_tool/
├── electron/
│   ├── main.ts              # Electron main process entry
│   ├── osc-manager.ts       # UDP send/receive, port management
│   ├── presets-store.ts      # Read/write presets JSON
│   ├── web-server.ts         # Optional Express + WebSocket server
│   ├── diagnostics.ts        # Loopback test logic
│   └── ipc-handlers.ts       # IPC bridge between main and renderer
├── src/                      # Next.js renderer
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx          # Redirect to listener
│   │   ├── listener/
│   │   ├── sender/
│   │   ├── presets/
│   │   └── diagnostics/
│   ├── components/
│   │   ├── sidebar.tsx
│   │   ├── message-log.tsx
│   │   ├── osc-input.tsx
│   │   ├── preset-card.tsx
│   │   └── status-bar.tsx    # Live throughput indicator
│   ├── hooks/
│   │   └── use-osc.ts        # IPC communication hook
│   └── lib/
│       └── types.ts          # Shared OSC message types
├── web/                      # Lightweight web client for remote debugging
│   └── index.tsx             # Standalone React app via WebSocket
├── package.json
├── electron-builder.yml
├── tailwind.config.ts
└── tsconfig.json
```

### Key Decisions

- OSC logic lives entirely in the main process — the renderer never touches UDP directly
- The web client is a separate lightweight bundle, not the full Next.js app
- IPC handlers centralized in one file for maintainability
