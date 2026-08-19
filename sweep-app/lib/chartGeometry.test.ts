// lib/chartGeometry.test.ts — where the price line's pieces land.
//   npm run test:chart     (plain node, no device)
//
// The geometry is tested rather than eyeballed because a chart that is subtly
// wrong still looks like a chart.
import { type ChartPoint, buildLine, downsample } from "./chartGeometry";

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};
const near = (a: number, b: number, tolerance = 0.01) => Math.abs(a - b) <= tolerance;

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const at = (days: number, price: number): ChartPoint => ({
  price,
  checkedAt: new Date(T0 + days * DAY).toISOString(),
});

const W = 300;
const H = 100;
const THICK = 2;

console.log("\n— nothing to draw —");
check("empty series", buildLine([], W, H, THICK) === null);
check("zero width", buildLine([at(0, 100)], 0, H, THICK) === null);
check("zero height", buildLine([at(0, 100)], W, 0, THICK) === null);

console.log("\n— a single point is a dot, not nothing —");
const single = buildLine([at(0, 500)], W, H, THICK)!;
check("renders", single !== null);
check("no segments", single.segments.length === 0, single.segments);
check("one dot", single.dots.length === 1, single.dots);
check("centred horizontally", near(single.dots[0].x, W / 2), single.dots[0].x);

console.log("\n— segments join the points —");
// Two points, rising. The rotated rectangle's ends must land on both.
const two = buildLine([at(0, 100), at(1, 200)], W, H, THICK)!;
check("one segment for two points", two.segments.length === 1, two.segments.length);
const seg = two.segments[0];
// Reconstruct the endpoints from left/top/width/angle the way the transform
// does, and check they match where the points should be.
const radians = (seg.angle * Math.PI) / 180;
const cx = seg.left + seg.width / 2;
const cy = seg.top + THICK / 2;
const endA = {
  x: cx - (Math.cos(radians) * seg.width) / 2,
  y: cy - (Math.sin(radians) * seg.width) / 2,
};
const endB = {
  x: cx + (Math.cos(radians) * seg.width) / 2,
  y: cy + (Math.sin(radians) * seg.width) / 2,
};
check("starts at the left edge", near(endA.x, THICK / 2), endA);
check("ends at the right edge", near(endB.x, W - THICK / 2), endB);
check("starts at the bottom (cheapest)", near(endA.y, H - THICK / 2), endA);
check("ends at the top (dearest)", near(endB.y, THICK / 2), endB);

console.log("\n— higher prices sit higher —");
const rising = buildLine([at(0, 100), at(1, 300), at(2, 200)], W, H, THICK)!;
check("low/high read off the data", rising.low === 100 && rising.high === 300, rising);
check("two segments for three points", rising.segments.length === 2);

console.log("\n— spacing follows TIME, not position in the list —");
// Three checks: two a day apart, then a 30-day gap. Index spacing would put
// the middle point halfway across; the gap is what makes that wrong.
const uneven = buildLine([at(0, 100), at(1, 110), at(31, 120)], W, H, THICK)!;
const midX = uneven.segments[0].left + uneven.segments[0].width;
check(
  "the one-day gap uses a thirty-first of the width, not half",
  midX < W * 0.15,
  { midX, halfWouldBe: W / 2 },
);

console.log("\n— a flat price is a flat line down the middle —");
// Pinning it to the floor would read as "cheapest it has ever been".
const flat = buildLine([at(0, 999), at(1, 999), at(2, 999)], W, H, THICK)!;
check("all segments level", flat.segments.every((s) => near(s.angle, 0)), flat.segments);
check(
  "drawn mid-height, not on the floor",
  near(flat.segments[0].top + THICK / 2, H / 2),
  flat.segments[0].top,
);
check("no 'low' dot when nothing is lower", !flat.dots.some((d) => d.kind === "low"), flat.dots);

console.log("\n— points arriving out of order —");
const shuffled = buildLine([at(2, 300), at(0, 100), at(1, 200)], W, H, THICK)!;
check("sorted by time", shuffled.first < shuffled.last, {
  first: shuffled.first,
  last: shuffled.last,
});
check(
  "line rises left to right after sorting",
  shuffled.segments.every((s) => s.angle < 0),
  shuffled.segments.map((s) => s.angle),
);

console.log("\n— identical timestamps don't stack or divide by zero —");
const sameTime = buildLine([at(0, 100), at(0, 200), at(0, 150)], W, H, THICK)!;
check("still produces segments", sameTime.segments.length === 2, sameTime.segments.length);
check(
  "every coordinate is a real number",
  sameTime.segments.every(
    (s) => Number.isFinite(s.left) && Number.isFinite(s.top) && Number.isFinite(s.width) && Number.isFinite(s.angle),
  ),
  sameTime.segments,
);

console.log("\n— the line stays inside the box —");
const many = Array.from({ length: 40 }, (_, i) => at(i, 100 + (i % 7) * 50));
const bounded = buildLine(many, W, H, THICK)!;
check(
  "no segment starts above the top or below the bottom",
  bounded.segments.every((s) => s.top >= -0.01 && s.top + THICK <= H + 0.01),
  bounded.segments.filter((s) => s.top < 0 || s.top + THICK > H).slice(0, 3),
);
check(
  "dots stay inside horizontally",
  bounded.dots.every((d) => d.x >= 0 && d.x <= W),
  bounded.dots,
);

console.log("\n— 'now' is always marked —");
check("last point carries the now dot", bounded.dots.some((d) => d.kind === "now"));
check(
  "the now dot is the last point in time",
  near(bounded.dots.find((d) => d.kind === "now")!.x, W - THICK / 2),
);

console.log("\n— downsampling keeps the ends —");
const long = Array.from({ length: 500 }, (_, i) => at(i, 100 + i));
const thinned = downsample(long, 60);
check("respects the cap", thinned.length <= 60, thinned.length);
check("keeps the first point", thinned[0].checkedAt === long[0].checkedAt);
check(
  "keeps the last point",
  thinned[thinned.length - 1].checkedAt === long[long.length - 1].checkedAt,
);
check("short series pass through untouched", downsample(long.slice(0, 10), 60).length === 10);
check("stays in time order", thinned.every((p, i) => i === 0 || p.checkedAt >= thinned[i - 1].checkedAt));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
