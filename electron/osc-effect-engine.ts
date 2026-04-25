import type { OscEffect } from "../src/lib/osc-effect-types";
import type { OscManager } from "./osc-manager";
import type { SenderConfig, OscArg } from "../src/lib/types";
import { interpolateCurve } from "../src/lib/dmx-curves";

interface OscEffectTarget {
  host: string;
  port: number;
  address: string;
  argType: "f" | "i";
}

interface RunningOscEffect {
  instanceId: string;
  effect: OscEffect;
  target: OscEffectTarget;
  segmentIndex: number;
  segmentStartTime: number;
  velocityScale: number;
  releasing: boolean;
}

export class OscEffectEngine {
  private effects = new Map<string, OscEffect>();
  private activeEffects: RunningOscEffect[] = [];
  private intervalId: NodeJS.Timeout | null = null;
  private oscManager: OscManager;
  private instanceCounter = 0;

  constructor(oscManager: OscManager) {
    this.oscManager = oscManager;
  }

  loadEffects(effects: OscEffect[]): void {
    this.effects.clear();
    for (const e of effects) this.effects.set(e.id, e);
  }

  triggerEffect(
    effectId: string,
    target: OscEffectTarget,
    velocityScale = 1,
  ): string | null {
    const effect = this.effects.get(effectId);
    if (!effect || effect.segments.length === 0) return null;

    const instanceId = `osc-fx-${++this.instanceCounter}`;
    const now = Date.now();

    this.activeEffects.push({
      instanceId,
      effect,
      target,
      segmentIndex: 0,
      segmentStartTime: now,
      velocityScale: effect.velocitySensitive ? velocityScale : 1,
      releasing: false,
    });

    this.ensureLoop();
    return instanceId;
  }

  releaseEffect(instanceId: string): void {
    const running = this.activeEffects.find((r) => r.instanceId === instanceId);
    if (!running) return;

    if (running.effect.mode === "sustained" && running.effect.releaseSegment) {
      running.releasing = true;
      running.segmentIndex = 0;
      running.segmentStartTime = Date.now();
    } else {
      this.activeEffects = this.activeEffects.filter((r) => r.instanceId !== instanceId);
      this.maybeStopLoop();
    }
  }

  stopEffect(instanceId: string): void {
    this.activeEffects = this.activeEffects.filter((r) => r.instanceId !== instanceId);
    this.maybeStopLoop();
  }

  private ensureLoop(): void {
    if (this.intervalId) return;
    const minInterval = this.getMinTickInterval();
    this.intervalId = setInterval(() => this.tick(), minInterval);
  }

  private maybeStopLoop(): void {
    if (this.activeEffects.length === 0 && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private getMinTickInterval(): number {
    let maxHz = 40;
    for (const r of this.activeEffects) {
      if (r.effect.tickRateHz > maxHz) maxHz = r.effect.tickRateHz;
    }
    return Math.round(1000 / maxHz);
  }

  private tick(): void {
    const now = Date.now();
    const completed: string[] = [];

    for (const running of this.activeEffects) {
      const segments =
        running.releasing && running.effect.releaseSegment
          ? [running.effect.releaseSegment]
          : running.effect.segments;

      const seg = segments[running.segmentIndex];
      if (!seg) {
        completed.push(running.instanceId);
        continue;
      }

      const segElapsed = now - running.segmentStartTime;
      const totalSegDuration = seg.durationMs + seg.holdMs;

      if (totalSegDuration > 0 && segElapsed >= totalSegDuration) {
        running.segmentIndex++;
        running.segmentStartTime = now;

        if (running.segmentIndex >= segments.length) {
          if (running.releasing) {
            completed.push(running.instanceId);
            continue;
          }
          if (running.effect.loop) {
            running.segmentIndex = 0;
          } else if (running.effect.mode === "sustained") {
            running.segmentIndex = segments.length - 1;
            running.segmentStartTime = now;
          } else {
            completed.push(running.instanceId);
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

      value *= running.velocityScale;

      const config: SenderConfig = {
        host: running.target.host,
        port: running.target.port,
      };
      const args: OscArg[] = [
        {
          type: running.target.argType,
          value: running.target.argType === "i" ? Math.round(value) : value,
        },
      ];

      this.oscManager.sendMessage(config, running.target.address, args).catch(() => {});
    }

    for (const id of completed) {
      this.activeEffects = this.activeEffects.filter((r) => r.instanceId !== id);
    }

    this.maybeStopLoop();
  }
}
