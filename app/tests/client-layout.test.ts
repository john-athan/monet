import { test, expect } from "bun:test";
import { justify, layoutDays, dayAt, visibleRange, PHONE, WIDE } from "../client/lib/layout";
import { fillMonths, dabs, forest, clouds, years } from "../client/lib/band";
import { neighbour } from "../client/lib/neighbour";

const photo = (i: number) => ({ w: [4000, 3000, 6000, 3000][i % 4], h: [3000, 4000, 4000, 3000][i % 4] });
const day = (n: number, seed = 0) => ({ items: Array.from({ length: n }, (_, i) => photo(i + seed)) });

test("justified rows fill the width exactly and keep their order", () => {
  const items = Array.from({ length: 23 }, (_, i) => photo(i));
  const rows = justify(items, 1180);
  expect(rows.flatMap(r => r.tiles.map(t => t.i))).toEqual(items.map((_, i) => i));
  for (const r of rows.slice(0, -1)) {
    const sum = r.tiles.reduce((s, t) => s + t.w, 0) + WIDE.gap * (r.tiles.length - 1);
    expect(Math.abs(sum - 1180)).toBeLessThan(0.01);
    expect(r.h).toBeLessThanOrEqual(WIDE.target + 0.01);
  }
});

test("a short last row keeps the target height instead of stretching", () => {
  const rows = justify([photo(0), photo(1), photo(0), photo(1), photo(0), photo(1), photo(0)], 1180);
  const last = rows.at(-1)!;
  expect(last.h).toBeLessThanOrEqual(WIDE.target * 1.8);
  if (last.tiles.length === 1) expect(last.h).toBe(WIDE.target);
});

test("layout heights add up: phone and desktop", () => {
  const days = [day(7), day(1), day(12, 3)];
  const p = layoutDays(days, 368, false);
  const cell = (368 - 2 * PHONE.gap) / 3;
  expect(p.days[0].height).toBeCloseTo(PHONE.head + 3 * cell + 2 * PHONE.gap, 5);
  expect(p.days[1].top).toBe(p.days[0].height);
  expect(p.total).toBeCloseTo(p.days.reduce((s, d) => s + d.height, 0), 5);
  const w = layoutDays(days, 1180, true);
  expect(w.days[2].top).toBeCloseTo(w.days[0].height + w.days[1].height, 5);
});

test("a 50 000 item library lays out in milliseconds and renders only the days in view", () => {
  const days = Array.from({ length: 12_000 }, (_, i) => day(1 + (i % 7) * 1, i)); // about 50 000 items
  const n = days.reduce((s, d) => s + d.items.length, 0);
  expect(n).toBeGreaterThan(45_000);
  for (const wide of [false, true]) {
    const t0 = performance.now();
    const l = layoutDays(days, wide ? 1180 : 368, wide);
    const took = performance.now() - t0;
    expect(took).toBeLessThan(400);
    // the viewport somewhere in the middle: a screen and one and a half screens of margin on each side
    const y = l.total / 2, [a, b] = visibleRange(l, y, y + 900, 1080);
    expect(b - a).toBeLessThan(60);
    expect(l.days[a].top).toBeLessThanOrEqual(y - 1080 + 0.01 + l.days[a].height);
    const t1 = performance.now();
    for (let k = 0; k < 1000; k++) dayAt(l, (k * 7919) % l.total);
    expect(performance.now() - t1).toBeLessThan(50); // binary search
  }
});

test("dayAt finds the day that holds a position", () => {
  const l = layoutDays([day(3), day(9), day(4)], 368, false);
  expect(dayAt(l, 0)).toBe(0);
  expect(dayAt(l, l.days[1].top)).toBe(1);
  expect(dayAt(l, l.days[2].top + 5)).toBe(2);
  expect(dayAt(l, l.total + 500)).toBe(2);
});

test("the band: gaps stay gaps, newest first on the phone, dabs are deterministic", () => {
  const months = [{ ym: "2019-12", n: 40, colors: ["#111111", "#222222", "#333333"] }, { ym: "2019-10", n: 3, colors: ["#aa0000", "#00aa00", "#0000aa"] }];
  const f = fillMonths(months);
  expect(f.map(m => m.ym)).toEqual(["2019-10", "2019-11", "2019-12"]);
  expect(f[1].n).toBe(0);
  expect(fillMonths(months, true)[0].ym).toBe("2019-12");
  const v = dabs(fillMonths(months, true), true), v2 = dabs(fillMonths(months, true), true);
  expect(v).toEqual(v2);
  // three months fill the whole band: each gets as many dabs as its width holds, the sparse one fewer and faint
  expect(v.length).toBeGreaterThan(40);
  // a long library (15 years) keeps three dabs per full month, as in the design
  const long = fillMonths([{ ym: "2011-01", n: 40, colors: ["#111111"] }, { ym: "2025-12", n: 40, colors: ["#111111"] }], true);
  expect(dabs(long, true).length).toBe(3 + 3);
  expect(v.every(d => !d.style.includes("NaN"))).toBe(true);
  expect(years([{ ym: "2018-12", n: 1, colors: [] }, { ym: "2019-01", n: 1, colors: [] }, { ym: "2019-02", n: 1, colors: [] }])).toEqual([{ y: "2018", n: 1 }, { y: "2019", n: 2 }]);
});

const rect = (x: number, y: number, w = 100, h = 100) => ({ left: x, top: y, width: w, height: h }) as DOMRect;
test("arrow keys move between tiles by position", () => {
  const grid = [rect(0, 0), rect(100, 0), rect(200, 0), rect(0, 100), rect(100, 100), rect(200, 100)];
  expect(neighbour(grid, 1, "ArrowRight")).toBe(2);
  expect(neighbour(grid, 1, "ArrowLeft")).toBe(0);
  expect(neighbour(grid, 1, "ArrowDown")).toBe(4);
  expect(neighbour(grid, 4, "ArrowUp")).toBe(1);
  expect(neighbour(grid, 4, "ArrowDown")).toBe(-1);
});

test("the band in Ernst and Magritte: a trunk or a cloud per full month, the fuller month the bigger one", () => {
  const f = fillMonths([{ ym: "2024-01", n: 2, colors: ["#112233"] }, { ym: "2024-03", n: 200, colors: ["#445566"] }]);
  const t = forest(f, false), c = clouds(f, false);
  expect(t.length).toBe(2); expect(c.length).toBe(2);           // the empty February is a clearing, a clear sky
  expect(forest(f, false)).toEqual(t);                           // the same library paints the same forest
  const top = (d: string) => Math.min(...d.slice(1, -1).split("L").map(p => Number(p.split(",")[1])));
  expect(top(t[1].d)).toBeLessThan(top(t[0].d));                // the full month stands taller
  expect(t[0].fill).toContain("#112233");
  const w = (s: string) => Number(/width:([\d.]+)px/.exec(s)![1]);
  expect(w(c[1].style)).toBeGreaterThan(w(c[0].style));
  const v = forest(f, true)[0].d.slice(1).split("L")[0].split(",").map(Number);
  expect(v[0]).toBeGreaterThan(30);                              // on the phone the trunks grow from the right edge
});
