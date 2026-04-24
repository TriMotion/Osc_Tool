import { Sender } from "sacn";
import { EventEmitter } from "events";
import type { DmxEffect, SacnConfig } from "../src/lib/dmx-types";
import { interpolateCurve } from "../src/lib/dmx-curves";

interface RunningEffect {
  effect: DmxEffect;
  startTime: number;
  segmentIndex: number;
  segmentStartTime: number;
  velocityScale: number;
}

export class DmxEngine extends EventEmitter {
  private buffer = new Uint8Array(512);
  private prevBuffer = new Uint8Array(512);
  private activeEffects: RunningEffect[] = [];
  private directValues = new Map<number, number>();
  private sender: Sender | null = null;
  private loopInterval: NodeJS.Timeout | null = null;
  private config: SacnConfig = { universe: 7, enabled: false };
  private effects = new Map<string, DmxEffect>();

  start(config: SacnConfig): void {
    this.stop();
    this.config = config;
    if (!config.enabled) return;

    try {
      this.sender = new Sender({
        universe: config.universe,
        iface: config.networkInterface || undefined,
        defaultPacketOptions: {
          sourceName: "Oscilot",
          priority: 100,
          useRawDmxValues: true,
        },
      });
      this.sender.socket.on("error", (err: Error) => {
        console.error("[DMX] sACN socket error:", err.message);
        this.stop();
      });
    } catch (err) {
      console.error("[DMX] Failed to create sACN sender:", err);
      this.sender = null;
      return;
    }

    this.loopInterval = setInterval(() => this.tick(), 23);
  }

  stop(): void {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
    if (this.sender) {
      this.sender.close();
      this.sender = null;
    }
    this.activeEffects = [];
    this.buffer.fill(0);
    this.prevBuffer.fill(0);
  }

  setConfig(config: SacnConfig): void {
    this.start(config);
  }

  loadEffects(effects: DmxEffect[]): void {
    this.effects.clear();
    for (const e of effects) this.effects.set(e.id, e);
  }

  triggerEffect(effectId: string, velocityScale = 1): void {
    const effect = this.effects.get(effectId);
    if (!effect || effect.segments.length === 0) return;
    const now = Date.now();
    this.activeEffects.push({
      effect,
      startTime: now,
      segmentIndex: 0,
      segmentStartTime: now,
      velocityScale: effect.velocitySensitive ? velocityScale : 1,
    });
  }

  stopEffect(effectId: string): void {
    this.activeEffects = this.activeEffects.filter((r) => r.effect.id !== effectId);
  }

  setChannel(channel: number, value: number): void {
    if (channel < 1 || channel > 512) return;
    this.directValues.set(channel, Math.max(0, Math.min(255, Math.round(value))));
  }

  releaseChannel(channel: number): void {
    this.directValues.delete(channel);
  }

  getBuffer(): number[] {
    return Array.from(this.buffer);
  }

  private tick(): void {
    const now = Date.now();
    const channelValues = new Map<number, number>();

    // Compute effect contributions
    const completed: number[] = [];
    for (let i = 0; i < this.activeEffects.length; i++) {
      const running = this.activeEffects[i];
      const seg = running.effect.segments[running.segmentIndex];
      if (!seg) { completed.push(i); continue; }

      const segElapsed = now - running.segmentStartTime;
      const totalSegDuration = seg.durationMs + seg.holdMs;

      if (totalSegDuration > 0 && segElapsed >= totalSegDuration) {
        running.segmentIndex++;
        running.segmentStartTime = now;
        if (running.segmentIndex >= running.effect.segments.length) {
          if (running.effect.loop) {
            running.segmentIndex = 0;
          } else {
            completed.push(i);
            continue;
          }
        }
        continue;
      }

      let value: number;
      if (seg.durationMs <= 0) {
        value = seg.endValue;
      } else if (segElapsed >= seg.durationMs) {
        value = seg.endValue;
      } else {
        const t = segElapsed / seg.durationMs;
        value = interpolateCurve(seg.curve, t, seg.startValue, seg.endValue, segElapsed);
      }

      value = Math.round(value * running.velocityScale);
      value = Math.max(0, Math.min(255, value));

      for (const ch of seg.channels) {
        const existing = channelValues.get(ch) ?? 0;
        channelValues.set(ch, Math.max(existing, value));
      }
    }

    // Remove completed effects (reverse order to keep indices valid)
    for (let i = completed.length - 1; i >= 0; i--) {
      this.activeEffects.splice(completed[i], 1);
    }

    // HTP merge: effects + direct values
    this.buffer.fill(0);
    for (const [ch, val] of channelValues) {
      this.buffer[ch - 1] = Math.max(this.buffer[ch - 1], val);
    }
    for (const [ch, val] of this.directValues) {
      this.buffer[ch - 1] = Math.max(this.buffer[ch - 1], val);
    }

    // Dirty check — only send if buffer changed
    let dirty = false;
    for (let i = 0; i < 512; i++) {
      if (this.buffer[i] !== this.prevBuffer[i]) { dirty = true; break; }
    }
    if (!dirty) return;

    this.prevBuffer.set(this.buffer);

    if (this.sender) {
      const payload: Record<number, number> = {};
      for (let i = 0; i < 512; i++) {
        if (this.buffer[i] > 0) payload[i + 1] = this.buffer[i];
      }
      this.sender.send({ payload }).catch((err) => {
        this.emit("error", `sACN send failed: ${err}`);
      });
    }

    this.emit("buffer", this.getBuffer());
  }
}
