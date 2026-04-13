import { Input } from "@julusian/midi";
import { EventEmitter } from "events";
import { OscManager } from "./osc-manager";
import { MidiEvent, MidiMappingRule, OscArg, OscMessage, SenderConfig } from "../src/lib/types";

export class MidiManager extends EventEmitter {
  private inputs: Array<{ input: Input; name: string }> = [];
  private running = false;

  constructor(private oscManager: OscManager) {
    super();
  }

  getDevices(): string[] {
    const temp = new Input();
    const count = temp.getPortCount();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      names.push(temp.getPortName(i));
    }
    return names;
  }

  start(
    deviceFilters: string[],
    rules: MidiMappingRule[],
    target: SenderConfig
  ): void {
    if (this.running) this.stop();

    const temp = new Input();
    const count = temp.getPortCount();
    const portNames: string[] = [];
    for (let i = 0; i < count; i++) {
      portNames.push(temp.getPortName(i));
    }
    temp.closePort();

    for (let i = 0; i < portNames.length; i++) {
      const name = portNames[i];
      if (deviceFilters.includes(name)) continue;

      try {
        const input = new Input();
        input.ignoreTypes(true, true, true); // ignore sysex, timing, active sensing
        input.openPort(i);
        input.on("message", (_deltaTime: number, message: number[]) => {
          const event = this.parseMessage(message, name, rules, target);
          if (event) this.emit("event", event);
        });
        this.inputs.push({ input, name });
      } catch (err) {
        this.emit("error", `Failed to open MIDI port "${name}": ${err}`);
      }
    }

    this.running = true;
  }

  stop(): void {
    for (const { input } of this.inputs) {
      try { input.closePort(); } catch { /* ignore */ }
    }
    this.inputs = [];
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private parseMessage(
    message: number[],
    deviceName: string,
    rules: MidiMappingRule[],
    target: SenderConfig
  ): MidiEvent | null {
    const [statusByte = 0, data1 = 0, data2 = 0] = message;
    const statusType = statusByte & 0xF0;
    const channel = (statusByte & 0x0F) + 1; // 1-indexed

    let midiType: MidiEvent["midi"]["type"];
    switch (statusType) {
      case 0x80: midiType = "noteoff"; break;
      case 0x90: midiType = data2 === 0 ? "noteoff" : "noteon"; break;
      case 0xA0: midiType = "aftertouch"; break;
      case 0xB0: midiType = "cc"; break;
      case 0xC0: midiType = "program"; break;
      case 0xD0: midiType = "aftertouch"; break;
      case 0xE0: midiType = "pitch"; break;
      default: return null;
    }

    const rule = this.findRule(rules, midiType, channel, data1);
    let address: string;
    let arg: OscArg;

    if (rule) {
      let rawNormalized: number;
      if (midiType === "pitch") {
        rawNormalized = (((data2 << 7) | data1) - 8192) / 8192;
      } else if (statusType === 0xD0) {
        rawNormalized = data1 / 127; // channel aftertouch: pressure in data1
      } else {
        rawNormalized = data2 / 127;
      }
      const [minOut, maxOut] = rule.scale ?? [0, 1];
      const scaled = minOut + rawNormalized * (maxOut - minOut);
      address = rule.address;
      arg = rule.argType === "i"
        ? { type: "i", value: Math.round(scaled) }
        : { type: "f", value: scaled };
    } else {
      [address, arg] = this.autoMap(midiType, statusType, channel, data1, data2);
    }

    const now = Date.now();
    const osc: OscMessage = {
      address,
      args: [arg],
      timestamp: now,
    };

    this.oscManager.sendMessage(target, address, [arg]).catch((err) => {
      this.emit("error", `OSC send failed: ${err}`);
    });

    return {
      midi: { type: midiType, channel, data1, data2, timestamp: now, deviceName },
      osc,
    };
  }

  private autoMap(
    midiType: MidiEvent["midi"]["type"],
    statusType: number,
    channel: number,
    data1: number,
    data2: number
  ): [string, OscArg] {
    switch (midiType) {
      case "noteon":
        return [`/midi/ch${channel}/note/${data1}/on`, { type: "f", value: data2 / 127 }];
      case "noteoff":
        return [`/midi/ch${channel}/note/${data1}/off`, { type: "f", value: data2 / 127 }];
      case "cc":
        return [`/midi/ch${channel}/cc/${data1}`, { type: "f", value: data2 / 127 }];
      case "pitch": {
        const pitchVal = (data2 << 7) | data1;
        return [`/midi/ch${channel}/pitch`, { type: "f", value: (pitchVal - 8192) / 8192 }];
      }
      case "aftertouch":
        if (statusType === 0xA0) {
          // Poly aftertouch: data1=note, data2=pressure
          return [`/midi/ch${channel}/aftertouch/${data1}`, { type: "f", value: data2 / 127 }];
        }
        // Channel aftertouch: data1=pressure
        return [`/midi/ch${channel}/aftertouch`, { type: "f", value: data1 / 127 }];
      case "program":
        return [`/midi/ch${channel}/program`, { type: "i", value: data1 }];
    }
  }

  private findRule(
    rules: MidiMappingRule[],
    type: MidiEvent["midi"]["type"],
    channel: number,
    data1: number
  ): MidiMappingRule | undefined {
    return rules.find((r) => {
      if (r.type !== type) return false;
      if (r.channel !== undefined && r.channel !== channel) return false;
      if (r.data1 !== undefined && r.data1 !== data1) return false;
      return true;
    });
  }
}
