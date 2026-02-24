import type { CurvePoint } from '../types';

/**
 * Catmull-Rom spline interpolation between control points.
 * Returns the Y value (energy, clamped 0–1) at a given X position (0–1).
 */
export function sampleCurve(points: CurvePoint[], x: number): number {
  if (points.length === 0) return 0.5;
  if (points.length === 1) return clamp(points[0].y, 0, 1);

  // Sort points by x just in case
  const sorted = [...points].sort((a, b) => a.x - b.x);

  // Clamp to the curve's range
  if (x <= sorted[0].x) return clamp(sorted[0].y, 0, 1);
  if (x >= sorted[sorted.length - 1].x) return clamp(sorted[sorted.length - 1].y, 0, 1);

  // Find the segment containing x
  let segIdx = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (x >= sorted[i].x && x <= sorted[i + 1].x) {
      segIdx = i;
      break;
    }
  }

  const p0 = sorted[Math.max(segIdx - 1, 0)];
  const p1 = sorted[segIdx];
  const p2 = sorted[segIdx + 1];
  const p3 = sorted[Math.min(segIdx + 2, sorted.length - 1)];

  // Parametric t within the segment [p1.x, p2.x]
  const t = (x - p1.x) / (p2.x - p1.x);

  const y = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
  return clamp(y, 0, 1);
}

/**
 * Catmull-Rom interpolation formula.
 * alpha = 0.5 (centripetal variant)
 */
function catmullRom(y0: number, y1: number, y2: number, y3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * y1 +
      (-y0 + y2) * t +
      (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
      (-y0 + 3 * y1 - 3 * y2 + y3) * t3)
  );
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Generate SVG path data for the curve across N sample points.
 * Returns a smooth cubic bezier path string.
 */
export function buildSvgPath(
  points: CurvePoint[],
  svgWidth: number,
  svgHeight: number,
  samples = 200,
): string {
  if (points.length < 2) return '';

  const pts: [number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    const y = sampleCurve(points, x);
    pts.push([x * svgWidth, (1 - y) * svgHeight]);
  }

  if (pts.length === 0) return '';

  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  }
  return d;
}
