// Die Karte, the pure part: projection, views, the land file, the world grid of dabs, clustering, labels.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as M from "../client/lib/map";
import { encodeLevel, simplifyRing, TOLERANCES } from "../tools/build-geo";

const LAND = join(import.meta.dir, "../vendor/geo/land.bin");

describe("projection and views", () => {
  test("Web Mercator round trip, equator and date line", () => {
    expect(M.wx(-180)).toBe(0); expect(M.wx(180)).toBe(1); expect(M.wy(0)).toBeCloseTo(0.5, 12);
    for (const [lat, lon] of [[35.9, 14.5], [48.14, 11.57], [-33.9, 151.2], [64, -21]]) { expect(M.latOf(M.wy(lat))).toBeCloseTo(lat, 8); expect(M.lonOf(M.wx(lon))).toBeCloseTo(lon, 8); }
    expect(M.wy(90)).toBeGreaterThanOrEqual(0); expect(M.wy(-90)).toBeLessThanOrEqual(1);   // the poles clamp
  });
  test("zoomAt keeps the point under the cursor", () => {
    const v = { cx: 0.54, cy: 0.39, z: 6 }, W = 1000, H = 600, px = 700, py = 200;
    const z = M.zoomAt(v, 3, px, py, W, H), S0 = M.worldSize(v.z), S1 = M.worldSize(z.z);
    expect(v.cx + (px - W / 2) / S0).toBeCloseTo(z.cx + (px - W / 2) / S1, 9);
    expect(v.cy + (py - H / 2) / S0).toBeCloseTo(z.cy + (py - H / 2) / S1, 9);
  });
  test("a view never leaves the world and never zooms past its limits", () => {
    const v = M.panBy({ cx: 0.5, cy: 0.5, z: 5 }, 1e9, 1e9, 800, 600), S = M.worldSize(5);
    expect(v.cx - 400 / S).toBeGreaterThanOrEqual(-1e-12); expect(v.cy - 300 / S).toBeGreaterThanOrEqual(-1e-12);
    expect(M.zoomAt({ cx: 0.5, cy: 0.5, z: 5 }, 99, 0, 0, 800, 600).z).toBe(M.MAX_Z);
    expect(M.zoomAt({ cx: 0.5, cy: 0.5, z: 5 }, -99, 0, 0, 800, 600).z).toBeCloseTo(M.minZoom(600), 9);
  });
  test("fitting one place stops at a city-wide view; many places fit with padding", () => {
    const one = M.fitBox({ x0: M.wx(14.5), y0: M.wy(35.9), x1: M.wx(14.5), y1: M.wy(35.9) }, 1000, 600);
    expect(one.z).toBe(M.FIT_MAX_Z);
    const b = { x0: M.wx(11.5), y0: M.wy(48.2), x1: M.wx(14.6), y1: M.wy(35.8) }, v = M.fitBox(b, 1000, 600), S = M.worldSize(v.z);
    expect((b.x1 - b.x0) * S).toBeLessThan(1000); expect((b.y1 - b.y0) * S).toBeLessThan(600);
  });
  test("the level of detail follows the zoom", () => {
    const ls = [0, 3, 5, 6, 9, 12].map(z => M.levelFor(z));
    expect(ls).toEqual([...ls].sort((a, b) => a - b)); expect(ls[0]).toBe(0); expect(ls.at(-1)).toBe(3);
  });
});

describe("the land file", () => {
  const bin = readFileSync(LAND), land = M.openLand(bin);
  test("is the file the README names", () => {
    const readme = readFileSync(join(import.meta.dir, "../vendor/geo/README.md"), "utf8");
    expect(readme).toContain(createHash("sha256").update(bin).digest("hex"));
    expect(readme).toContain(String(bin.length));
    expect(bin.length).toBeLessThan(4e6);
  });
  test("four levels, each coarser than the next, and no level drops a ring", () => {
    expect(land.levels).toBe(4); expect(new Set(land.counts).size).toBe(1);
    const pts = [0, 1, 2, 3].map(i => M.level(land, i).pts.length);
    expect(pts[0]).toBeLessThan(pts[1]); expect(pts[1]).toBeLessThan(pts[2]); expect(pts[2]).toBeLessThan(pts[3]);
  });
  test("Malta and Munich: Malta is land at every level, Munich is inland, the sea off Malta is not", () => {
    const inside = (lv: M.Level, lon: number, lat: number) => {
      const x = M.wx(lon), y = M.wy(lat); let n = 0;
      for (let r = 0; r < lv.n; r++) {
        if (x < lv.box[r * 4] || x > lv.box[r * 4 + 2] || y < lv.box[r * 4 + 1] || y > lv.box[r * 4 + 3]) continue;
        let c = false;
        for (let i = lv.start[r], j = lv.start[r + 1] - 1; i < lv.start[r + 1]; j = i++) {
          const xi = lv.pts[2 * i], yi = lv.pts[2 * i + 1], xj = lv.pts[2 * j], yj = lv.pts[2 * j + 1];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
        }
        if (c) n++;
      }
      return n % 2 === 1;
    };
    for (const i of [0, 1, 2, 3]) { const lv = M.level(land, i); expect(inside(lv, 14.4, 35.92)).toBe(true); expect(inside(lv, 11.57, 48.14)).toBe(true); expect(inside(lv, 14.9, 35.5)).toBe(false); expect(inside(lv, 5, 40)).toBe(false); }
  });
  test("decoding round-trips a small file made by the builder (1e-5 degree)", () => {
    const sq: [number, number][] = [[10, 40], [10.5, 40], [10.5, 40.4], [10, 40.4], [10, 40]], tiny: [number, number][] = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]];
    const lv = TOLERANCES.map(t => encodeLevel([sq, tiny], t));
    expect(lv.map(l => l.count)).toEqual([2, 2, 2, 2]);   // the tiny ring is kept at every level
    const head: number[] = [0x4d, 0x4c, 0x4e, 0x44, 1, lv.length], v = (n: number) => { while (n >= 128) { head.push((n & 127) | 128); n = Math.floor(n / 128); } head.push(n); };
    for (const l of lv) { v(l.count); v(l.bytes.length); }
    const out = new Uint8Array(head.length + lv.reduce((a, l) => a + l.bytes.length, 0)); out.set(head); let o = head.length; for (const l of lv) { out.set(l.bytes, o); o += l.bytes.length; }
    const l3 = M.level(M.openLand(out), 3);
    expect(l3.n).toBe(2); expect(l3.pts[0]).toBeCloseTo(M.wx(10), 7); expect(l3.pts[1]).toBeCloseTo(M.wy(40), 7); expect(l3.start[2] - l3.start[1]).toBe(4);
    expect(l3.box[0]).toBeLessThanOrEqual(M.wx(10)); expect(l3.box[2]).toBeGreaterThanOrEqual(M.wx(10.5));
  });
  test("Douglas-Peucker keeps corners and drops what lies within the tolerance", () => {
    const ring: [number, number][] = [[0, 0], [1, 0.001], [2, 0], [2, 2], [0, 2], [0, 0]];
    const s = simplifyRing(ring, 0.01)!;
    expect(s.length).toBe(5); expect(s).not.toContainEqual([1, 0.001]);
  });
  test("a tiny island ring survives every level: its original points if 8 or fewer, else its four extreme points", () => {
    const tri: [number, number][] = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]];
    const round: [number, number][] = Array.from({ length: 41 }, (_, i) => [0.002 * Math.cos((i / 40) * 2 * Math.PI), 0.002 * Math.sin((i / 40) * 2 * Math.PI)]);
    round[40] = round[0];
    for (const t of TOLERANCES) {
      expect(simplifyRing(tri, t)).toEqual(tri);
      const r = simplifyRing(round, t);
      expect(r.length).toBeGreaterThanOrEqual(4); expect(r[0]).toEqual(r.at(-1)!);
      if (t >= 0.01) { expect(r.length).toBe(5); const xs = r.map(p => p[0]), ys = r.map(p => p[1]); expect(Math.max(...xs)).toBeCloseTo(0.002, 9); expect(Math.min(...ys)).toBeCloseTo(-0.002, 9); }
    }
  });
  test("lift: no black, hue and saturation kept", () => {
    expect(M.lift("#808080")).toBe("#808080"); expect(M.lift("#000000")).toBe("#595959");
    const c = M.lift("#200808"), v = Math.max(...[1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))) / 255;
    expect(v).toBeGreaterThanOrEqual(0.34); expect(c.slice(3, 5)).toBe(c.slice(5, 7)); expect(parseInt(c.slice(1, 3), 16)).toBeGreaterThan(parseInt(c.slice(3, 5), 16));
  });
});

describe("the world grid of dabs", () => {
  const W = 800, H = 500;
  const collect = (v: M.View, salt = 1) => { const out = new Map<string, number[]>(); const S = M.worldSize(v.z); M.eachDab(v, W, H, 40, salt, 2.2, (sx, sy, a, b, c, d, cell, h) => out.set(String(h), [v.cx - W / 2 / S + sx / S, v.cy - H / 2 / S + sy / S, a, b, c, d, cell / S])); return out; };
  test("a dab stays where it is while the view pans (same world position and look)", () => {
    const a = collect({ cx: 0.54, cy: 0.39, z: 9 }), b = collect({ cx: 0.5404, cy: 0.3902, z: 9 });
    let shared = 0;
    for (const [k, v] of a) { const w = b.get(k); if (!w) continue; shared++; v.forEach((x, i) => expect(w[i]).toBeCloseTo(x, 12)); }
    expect(shared).toBeGreaterThan(a.size * 0.8);
  });
  test("screen density stays within a factor of 3 over every zoom (cells are powers of two: area varies 2x, plus the border cells)", () => {
    const counts: number[] = [];
    for (let z = 4; z <= 14; z += 0.25) { let n = 0; M.eachDab({ cx: 0.54, cy: 0.39, z }, W, H, 40, 1, 2, () => n++); counts.push(n); }
    expect(Math.max(...counts) / Math.min(...counts)).toBeLessThan(3);
  });
  test("is deterministic and every value is in [0, 1)", () => {
    expect([...collect({ cx: 0.3, cy: 0.4, z: 7 })]).toEqual([...collect({ cx: 0.3, cy: 0.4, z: 7 })]);
    for (const v of collect({ cx: 0.3, cy: 0.4, z: 7 }).values()) for (const x of v.slice(2, 6)) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});

describe("clustering", () => {
  const mk = (n: number, around: [number, number], spread: number): M.Points => {
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return M.toPoints({ ids: Array.from({ length: n }, (_, i) => i + 1), lat: Array.from({ length: n }, () => around[0] + (r() - 0.5) * spread), lon: Array.from({ length: n }, () => around[1] + (r() - 0.5) * spread), color: Array.from({ length: n }, () => "#336699") });
  };
  test("every photo in view lands in exactly one cluster; zooming in splits clusters", () => {
    const p = mk(500, [35.9, 14.5], 0.2), view = { cx: M.wx(14.5), cy: M.wy(35.9), z: 8 };
    const far = M.cluster(p, view, 1000, 700), near = M.cluster(p, { ...view, z: 13 }, 1000, 700);
    expect(far.clusters.reduce((a, c) => a + c.n, 0)).toBe(500);
    const ids = new Set<number>(); for (const c of far.clusters) for (const i of M.members(c, far.next)) ids.add(i);
    expect(ids.size).toBe(500);
    expect(far.clusters.length).toBeLessThan(near.clusters.length + 1);
    expect(near.clusters.reduce((a, c) => a + c.n, 0)).toBeLessThanOrEqual(500);
  });
  test("grouping does not change when the view pans a little (the grid is anchored to the world)", () => {
    const p = mk(300, [48.1, 11.6], 0.05), v = { cx: M.wx(11.6), cy: M.wy(48.1), z: 12 };
    const key = (r: ReturnType<typeof M.cluster>) => r.clusters.map(c => M.members(c, r.next).sort((a, b) => a - b).join(",")).sort();
    const a = key(M.cluster(p, v, 1000, 700)), b = key(M.cluster(p, { ...v, cx: v.cx + 28 / M.worldSize(12) * 3, cy: v.cy }, 1000, 700));
    const shared = a.filter(x => b.includes(x)).length;
    expect(shared).toBeGreaterThan(a.length * 0.9);
  });
  test("photos outside the view are left out", () => {
    const p = M.toPoints({ ids: [1, 2], lat: [35.9, 48.1], lon: [14.5, 11.6], color: ["#fff", "#000"] });
    expect(M.cluster(p, { cx: M.wx(14.5), cy: M.wy(35.9), z: 12 }, 800, 600).clusters.map(c => c.n)).toEqual([1]);
  });
  test("50 000 photos cluster in well under a frame", () => {
    const p = mk(50000, [48, 12], 8), view = { cx: M.wx(12), cy: M.wy(48), z: 5 };
    M.cluster(p, view, 1440, 900);
    const t = performance.now(); let r; for (let i = 0; i < 10; i++) r = M.cluster(p, view, 1440, 900);
    const ms = (performance.now() - t) / 10;
    console.log(`cluster 50k: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(16); expect(r!.clusters.reduce((a, c) => a + c.n, 0)).toBe(50000);
  });
  test("bouquets: up to 7 dabs, growing with sqrt(n), deterministic", () => {
    expect(M.bouquet(1, 5).length).toBe(1); expect(M.bouquet(3, 5).length).toBe(3); expect(M.bouquet(500, 5).length).toBe(7);
    expect(M.bouquet(40, 9)).toEqual(M.bouquet(40, 9));
    expect(M.bouquetRadius(100)).toBeGreaterThan(M.bouquetRadius(4)); expect(M.bouquetRadius(1e6)).toBeLessThanOrEqual(30);
  });
});

describe("labels", () => {
  test("a label that would overlap one already drawn is skipped, the next candidate is tried", () => {
    const taken = [{ x0: 0, y0: 0, x1: 100, y1: 20 }];
    expect(M.place([{ x0: 10, y0: 5, x1: 60, y1: 18 }], taken)).toBeNull();
    expect(M.place([{ x0: 10, y0: 5, x1: 60, y1: 18 }, { x0: 10, y0: 30, x1: 60, y1: 44 }], taken)).toEqual({ x0: 10, y0: 30, x1: 60, y1: 44 });
  });
  test("the nearest place names a cluster", () => {
    const ps = [{ name: "Valletta", lat: 35.9, lon: 14.51, count: 34 }, { name: "München", lat: 48.14, lon: 11.57, count: 4 }, { name: "Mosta", lat: 35.91, lon: 14.42, count: 18 }];
    expect(M.nearestPlace(ps, M.wx(14.45), M.wy(35.91))?.name).toBe("Mosta");
    expect(M.nearestPlace(ps, M.wx(11.6), M.wy(48.1))?.name).toBe("München");
    expect(M.nearestPlace([], 0.5, 0.5)).toBeNull();
  });
});
