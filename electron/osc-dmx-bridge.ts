import type { OscManager } from "./osc-manager";
import type { DmxEngine } from "./dmx-engine";
import type { OscDmxTrigger } from "../src/lib/dmx-types";
import type { OscMessage } from "../src/lib/types";

export class OscDmxBridge {
  private triggers: OscDmxTrigger[] = [];

  constructor(
    private oscManager: OscManager,
    private dmxEngine: DmxEngine,
  ) {
    this.oscManager.on("message", (msg: OscMessage) => this.handleMessage(msg));
  }

  loadTriggers(triggers: OscDmxTrigger[]): void {
    this.triggers = triggers;
  }

  private handleMessage(msg: OscMessage): void {
    for (const trigger of this.triggers) {
      if (msg.address !== trigger.oscAddress) continue;

      if (trigger.mode === "match-only") {
        if (trigger.dmxEffectId) {
          this.dmxEngine.triggerEffect(trigger.dmxEffectId);
        }
      } else {
        const rawValue = this.extractNumericArg(msg);
        if (rawValue === null) continue;
        const inMin = trigger.inputMin ?? 0;
        const inMax = trigger.inputMax ?? 1;
        const outMin = trigger.outputMin ?? 0;
        const outMax = trigger.outputMax ?? 255;
        const ratio = inMax !== inMin ? (rawValue - inMin) / (inMax - inMin) : 0;
        const dmxValue = outMin + ratio * (outMax - outMin);
        const channels = trigger.dmxChannels ?? [];
        for (const ch of channels) {
          this.dmxEngine.setChannel(ch, dmxValue);
        }
      }
    }
  }

  private extractNumericArg(msg: OscMessage): number | null {
    if (!msg.args || msg.args.length === 0) return null;
    const first = msg.args[0];
    if (typeof first.value === "number") return first.value;
    return null;
  }
}
