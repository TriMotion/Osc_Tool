import OSC from "osc-js";
import { OscMessage, OscArg, ListenerConfig, SenderConfig } from "../src/lib/types";
import { EventEmitter } from "events";
import dgram from "dgram";

export class OscManager extends EventEmitter {
  private listeners: Map<number, dgram.Socket> = new Map();
  private sendSocket: dgram.Socket | null = null;
  private throughputCount = 0;
  private throughputInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startThroughputCounter();
  }

  async startListener(config: ListenerConfig): Promise<void> {
    if (this.listeners.has(config.port)) {
      throw new Error(`Already listening on port ${config.port}`);
    }

    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    socket.on("message", (buf, rinfo) => {
      try {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const header = buf.slice(0, 8).toString();

        if (header === "#bundle\0") {
          const bundle = new OSC.Bundle();
          bundle.unpack(dv);
          const now = Date.now();
          for (const el of bundle.bundleElements) {
            if (el.address) {
              this.throughputCount++;
              this.emit("message", {
                address: el.address,
                args: el.args.map((arg: unknown) => ({
                  type: this.inferType(arg),
                  value: arg as number | string | boolean,
                })),
                timestamp: now,
                sourceIp: rinfo.address,
                sourcePort: rinfo.port,
              } satisfies OscMessage);
            }
          }
        } else {
          const oscMsg = new OSC.Message();
          oscMsg.unpack(dv);

          this.throughputCount++;
          this.emit("message", {
            address: oscMsg.address,
            args: oscMsg.args.map((arg: unknown) => ({
              type: this.inferType(arg),
              value: arg as number | string | boolean,
            })),
            timestamp: Date.now(),
            sourceIp: rinfo.address,
            sourcePort: rinfo.port,
          } satisfies OscMessage);
        }
      } catch (err) {
        this.emit("error", `Failed to parse OSC message: ${err}`);
      }
    });

    return new Promise((resolve, reject) => {
      const bindAddr = config.bindAddress === "0.0.0.0" ? undefined : config.bindAddress;
      socket.bind(config.port, bindAddr, () => {
        socket.setBroadcast(true);
        this.listeners.set(config.port, socket);
        resolve();
      });
      socket.on("error", reject);
    });
  }

  stopListener(port: number): void {
    const socket = this.listeners.get(port);
    if (socket) {
      socket.close();
      this.listeners.delete(port);
    }
  }

  private getSendSocket(): dgram.Socket {
    if (!this.sendSocket) {
      this.sendSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      this.sendSocket.unref();
    }
    return this.sendSocket;
  }

  private packMessage(address: string, args: OscArg[]): Buffer {
    const oscArgs = args.map((arg) => {
      switch (arg.type) {
        case "f": return { type: "f", value: Number(arg.value) };
        case "i": return { type: "i", value: Math.round(Number(arg.value)) };
        case "s": return { type: "s", value: String(arg.value) };
        case "T": return { type: "T", value: true };
        case "F": return { type: "F", value: false };
      }
    });
    const oscMsg = new OSC.TypedMessage(address, oscArgs);
    return Buffer.from(oscMsg.pack());
  }

  async sendMessage(config: SenderConfig, address: string, args: OscArg[]): Promise<void> {
    const buffer = this.packMessage(address, args);
    const socket = this.getSendSocket();
    return new Promise((resolve, reject) => {
      socket.send(buffer, 0, buffer.length, config.port, config.host, (err) => {
        if (err) reject(err);
        else {
          this.throughputCount++;
          resolve();
        }
      });
    });
  }

  async sendBatch(messages: Array<{ config: SenderConfig; address: string; args: OscArg[] }>): Promise<void> {
    const socket = this.getSendSocket();
    const promises: Promise<void>[] = [];
    for (const msg of messages) {
      const buffer = this.packMessage(msg.address, msg.args);
      promises.push(new Promise((resolve, reject) => {
        socket.send(buffer, 0, buffer.length, msg.config.port, msg.config.host, (err) => {
          if (err) reject(err);
          else {
            this.throughputCount++;
            resolve();
          }
        });
      }));
    }
    await Promise.all(promises);
  }

  getActiveListeners(): number[] {
    return Array.from(this.listeners.keys());
  }

  stopAll(): void {
    for (const [port] of this.listeners) {
      this.stopListener(port);
    }
    if (this.sendSocket) {
      this.sendSocket.close();
      this.sendSocket = null;
    }
    if (this.throughputInterval) clearInterval(this.throughputInterval);
  }

  private inferType(value: unknown): OscArg["type"] {
    if (typeof value === "boolean") return value ? "T" : "F";
    if (typeof value === "string") return "s";
    if (typeof value === "number") return Number.isInteger(value) ? "i" : "f";
    return "s";
  }

  private startThroughputCounter(): void {
    this.throughputInterval = setInterval(() => {
      this.emit("throughput", this.throughputCount);
      this.throughputCount = 0;
    }, 1000);
  }
}
