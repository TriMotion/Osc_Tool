import type { CurveDefinition } from "./dmx-types";

export interface OscEffectSegment {
  startValue: number;
  endValue: number;
  durationMs: number;
  curve: CurveDefinition;
  holdMs: number;
}

export interface OscEffect {
  id: string;
  name: string;
  segments: OscEffectSegment[];
  loop: boolean;
  velocitySensitive: boolean;
  mode: "one-shot" | "sustained";
  releaseSegment?: OscEffectSegment;
  tickRateHz: number;
}
