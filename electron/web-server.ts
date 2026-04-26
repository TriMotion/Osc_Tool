import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import path from "path";
import { OscManager } from "./osc-manager";
import type { OscMessage, OscArg, SenderConfig } from "../src/lib/types";

export class WebServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  private onValueChange?: (itemId: string, value: unknown) => void;

  constructor(private oscManager: OscManager) {}

  setValueChangeHandler(handler: (itemId: string, value: unknown) => void) {
    this.onValueChange = handler;
  }

  start(port: number): string {
    const app = express();
    app.use(express.static(path.join(__dirname, "../web")));

    this.server = http.createServer(app);
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "send") {
            const config: SenderConfig = { host: msg.host, port: msg.port };
            this.oscManager.sendMessage(config, msg.address, msg.args as OscArg[]);
          }
        } catch {
          // ignore malformed
        }
      });
    });

    this.oscManager.on("message", (oscMsg: OscMessage) => {
      const payload = JSON.stringify({ type: "message", data: oscMsg });
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    });

    this.oscManager.on("throughput", (count: number) => {
      const payload = JSON.stringify({ type: "throughput", data: count });
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    });

    this.server.listen(port, "0.0.0.0");

    const { networkInterfaces } = require("os");
    const nets = networkInterfaces();
    let localIp = "localhost";
    // Prefer common LAN interfaces (en0, eth0, Wi-Fi) over VPN/tunnel interfaces
    const preferred = ["en0", "en1", "eth0", "Wi-Fi", "Ethernet"];
    for (const ifName of preferred) {
      const addrs = nets[ifName];
      if (!addrs) continue;
      const ipv4 = addrs.find((n: any) => n.family === "IPv4" && !n.internal);
      if (ipv4) { localIp = ipv4.address; break; }
    }
    // Fallback: any non-internal, non-tunnel IPv4
    if (localIp === "localhost") {
      for (const name of Object.keys(nets)) {
        if (name.startsWith("utun") || name.startsWith("tun")) continue;
        for (const net of nets[name]) {
          if (net.family === "IPv4" && !net.internal) {
            localIp = net.address;
            break;
          }
        }
        if (localIp !== "localhost") break;
      }
    }

    return `http://${localIp}:${port}`;
  }

  broadcastMessage(msg: unknown): void {
    const payload = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  stop(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss?.close();
    this.server?.close();
    this.server = null;
    this.wss = null;
  }

  isRunning(): boolean {
    return this.server !== null;
  }
}
