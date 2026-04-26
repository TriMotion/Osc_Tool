export type CurveDefinition =
  | { type: "snap" }
  | { type: "linear" }
  | { type: "ease-in" }
  | { type: "ease-out" }
  | { type: "ease-in-out" }
  | { type: "sine"; hz: number }
  | { type: "strobe"; hz: number }
  | { type: "bezier"; x1: number; y1: number; x2: number; y2: number };

export interface DmxSegment {
  channels: number[];
  startValue: number;
  endValue: number;
  durationMs: number;
  curve: CurveDefinition;
  holdMs: number;
}

export interface DmxEffect {
  id: string;
  name: string;
  segments: DmxSegment[];
  loop: boolean;
  velocitySensitive: boolean;
}

export interface SacnConfig {
  universe: number;
  networkInterface?: string;
  enabled: boolean;
}

export interface OscDmxTrigger {
  id: string;
  name: string;
  oscAddress: string;
  mode: "match-only" | "passthrough";
  dmxEffectId?: string;
  dmxChannels?: number[];
  inputMin?: number;
  inputMax?: number;
  outputMin?: number;
  outputMax?: number;
  sectionId?: string;
}

export interface DmxTriggerConfig {
  dmxEffectId: string;
}

export interface DmxFaderConfig {
  channel: number;
  min: number;
  max: number;
}

export interface DmxFlashConfig {
  channels: number[];
  value: number;
}
