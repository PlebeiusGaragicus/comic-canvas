/** Dialogue-bubble tail geometry, mirrored by api/story_panels_print.py
 * (_speech_tail_geometry) so print and web tails match. Works in any
 * consistent unit; callers pass printable-page points (360×576). */

export type TailPoint = { x: number; y: number };

export type SpeechTailGeometry = {
  /** Borderless triangle drawn over the bubble edge to open the throat. */
  fill: [TailPoint, TailPoint, TailPoint];
  /** The two visible tail sides, boundary point → tip. */
  edges: [TailPoint, TailPoint][];
};

type Rect = { x: number; y: number; w: number; h: number };

/** Signed distance to the stadium (pill) boundary inscribed in rect. */
function stadiumSignedDistance(rect: Rect, px: number, py: number): number {
  const r = Math.min(rect.w, rect.h) / 2;
  let ax: number;
  let ay: number;
  let bx: number;
  let by: number;
  if (rect.w >= rect.h) {
    ay = rect.y + rect.h / 2;
    by = ay;
    ax = rect.x + r;
    bx = rect.x + rect.w - r;
  } else {
    ax = rect.x + rect.w / 2;
    bx = ax;
    ay = rect.y + r;
    by = rect.y + rect.h - r;
  }
  const vx = bx - ax;
  const vy = by - ay;
  const denom = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / denom));
  const qx = ax + vx * t;
  const qy = ay + vy * t;
  return Math.hypot(px - qx, py - qy) - r;
}

function stadiumBoundaryPoint(rect: Rect, angle: number): TailPoint {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  let lo = 0;
  let hi = rect.w + rect.h;
  for (let step = 0; step < 24; step += 1) {
    const mid = (lo + hi) / 2;
    if (stadiumSignedDistance(rect, cx + ux * mid, cy + uy * mid) < 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { x: cx + ux * lo, y: cy + uy * lo };
}

/** Tail triangle for a stadium bubble; null when the tip sits inside the bubble. */
export function speechTailGeometry(rect: Rect, tip: TailPoint): SpeechTailGeometry | null {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  if (stadiumSignedDistance(rect, tip.x, tip.y) < 1) return null;
  const angle = Math.atan2(tip.y - cy, tip.x - cx);
  const base = stadiumBoundaryPoint(rect, angle);
  const radial = Math.hypot(base.x - cx, base.y - cy) || 1;
  const offset = Math.min(0.6, (Math.min(rect.w, rect.h) * 0.28) / radial);
  const side1 = stadiumBoundaryPoint(rect, angle + offset);
  const side2 = stadiumBoundaryPoint(rect, angle - offset);
  const inset = (point: TailPoint): TailPoint => ({
    x: cx + (point.x - cx) * 0.88,
    y: cy + (point.y - cy) * 0.88,
  });
  return {
    fill: [inset(side1), { ...tip }, inset(side2)],
    edges: [
      [side1, { ...tip }],
      [side2, { ...tip }],
    ],
  };
}
