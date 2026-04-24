import type { CurveDefinition } from "./dmx-types";

function solveCubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const x = 3 * (1 - mid) * (1 - mid) * mid * x1 + 3 * (1 - mid) * mid * mid * x2 + mid * mid * mid;
    if (x < t) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
}

export function interpolateCurve(
  curve: CurveDefinition,
  t: number,
  startValue: number,
  endValue: number,
  elapsedMs: number,
): number {
  const range = endValue - startValue;

  switch (curve.type) {
    case "snap":
      return t >= 1 ? endValue : startValue;

    case "linear":
      return startValue + range * t;

    case "ease-in":
      return startValue + range * t * t;

    case "ease-out":
      return startValue + range * (1 - (1 - t) * (1 - t));

    case "ease-in-out":
      return startValue + range * (t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2);

    case "sine":
      return startValue + range * (Math.sin(2 * Math.PI * curve.hz * elapsedMs / 1000) + 1) / 2;

    case "strobe": {
      const period = 1000 / curve.hz;
      return (elapsedMs % period) < period / 2 ? endValue : startValue;
    }

    case "bezier":
      return startValue + range * solveCubicBezier(curve.x1, curve.y1, curve.x2, curve.y2, t);
  }
}
