// lib/chartGeometry.ts
//
// Where to put the pieces of a price line, in pixels.
//
// Split from the component because the maths is the part that can be wrong in
// ways nobody notices: a segment that lands two pixels off looks fine, and a
// series whose gaps are misrepresented looks fine too, right up until someone
// reads a flat month as a busy one.
//
// Two decisions worth stating, because both are about honesty rather than
// looks:
//
//  1. Points are spaced by TIME, not by index. Sweep checks prices on an
//     adaptive schedule — an item that hasn't moved in weeks is checked far
//     less often — so evenly spacing the points would stretch quiet periods
//     and compress busy ones. The horizontal axis means something, so it has
//     to actually mean it.
//
//  2. A line, not columns. Columns read as discrete events, which is what
//     "the price was X on Tuesday" implies. A price is a step function that
//     holds between observations, and a continuous line is the closer lie.

export interface ChartPoint {
  price: number;
  /** ISO timestamp. */
  checkedAt: string;
}

/**
 * One straight piece of the line, positioned for a rotated View.
 *
 * `left`/`top` place the rectangle's TOP-LEFT corner, sized `width` ×
 * thickness, and the rotation happens about its centre — which is React
 * Native's default transform origin. Placing the centre at the midpoint of the
 * two points is what makes the rotated ends land exactly on them.
 */
export interface Segment {
  left: number;
  top: number;
  width: number;
  /** Degrees, for a `rotate` transform. */
  angle: number;
}

export interface Dot {
  x: number;
  y: number;
  price: number;
  kind: "low" | "now";
}

export interface ChartLayout {
  segments: Segment[];
  dots: Dot[];
  low: number;
  high: number;
  first: string;
  last: string;
}

/**
 * Lay out a price series inside a box.
 *
 * Returns null when there is nothing to draw at all. A SINGLE point is not
 * nothing — it renders as one dot with no line, which is the truthful picture
 * of "we have looked once".
 */
export function buildLine(
  points: ChartPoint[],
  width: number,
  height: number,
  thickness: number,
): ChartLayout | null {
  if (points.length === 0 || width <= 0 || height <= 0) return null;

  const sorted = [...points].sort(
    (a, b) => Date.parse(a.checkedAt) - Date.parse(b.checkedAt),
  );

  const prices = sorted.map((p) => p.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const range = high - low;

  const times = sorted.map((p) => Date.parse(p.checkedAt));
  const start = times[0];
  const span = times[times.length - 1] - start;

  // Keep the stroke fully inside the box; a line at the exact top would be
  // clipped in half by its own thickness.
  const inset = thickness / 2;
  const usableHeight = Math.max(0, height - thickness);
  const usableWidth = Math.max(0, width - thickness);

  const xy = sorted.map((point, index) => {
    // Every point sharing a timestamp (or a single point) has no span to
    // divide by; fall back to even spacing rather than stacking them.
    const xRatio =
      span > 0
        ? (Date.parse(point.checkedAt) - start) / span
        : sorted.length === 1
          ? 0.5
          : index / (sorted.length - 1);

    // A flat series has no range. Draw it down the middle rather than pinning
    // it to the floor, which would read as "the price is at its lowest ever".
    const yRatio = range > 0 ? (point.price - low) / range : 0.5;

    return {
      x: inset + xRatio * usableWidth,
      // Inverted: bigger prices sit higher.
      y: inset + (1 - yRatio) * usableHeight,
      price: point.price,
    };
  });

  const segments: Segment[] = [];
  for (let i = 1; i < xy.length; i++) {
    const from = xy[i - 1];
    const to = xy[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    segments.push({
      left: (from.x + to.x) / 2 - length / 2,
      top: (from.y + to.y) / 2 - thickness / 2,
      width: length,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }

  // The two points worth marking: what it costs now, and the best it has been.
  const lastPoint = xy[xy.length - 1];
  const lowIndex = xy.findIndex((p) => p.price === low);
  const dots: Dot[] = [];
  if (lowIndex !== -1 && range > 0) {
    dots.push({ ...xy[lowIndex], kind: "low" });
  }
  dots.push({ ...lastPoint, kind: "now" });

  return {
    segments,
    dots,
    low,
    high,
    first: sorted[0].checkedAt,
    last: sorted[sorted.length - 1].checkedAt,
  };
}

/**
 * Thin a long series down to something worth rendering.
 *
 * Keeps recent points at full resolution and thins older ones, because a price
 * series matters most at its right-hand edge — that's the price you'd pay
 * today. The first and last points are always kept, so the axis dates stay
 * true to the real range.
 */
export function downsample(points: ChartPoint[], max: number): ChartPoint[] {
  if (points.length <= max) return points;

  const recentCount = Math.floor(max / 2);
  const recent = points.slice(-recentCount);
  const older = points.slice(0, -recentCount);
  const olderSlots = max - recentCount;
  const step = older.length / olderSlots;

  const thinned: ChartPoint[] = [];
  for (let i = 0; i < olderSlots; i++) {
    thinned.push(older[Math.floor(i * step)]);
  }

  return [...thinned, ...recent];
}
