// Builds vendor/geo/land.bin from Natural Earth 1:10m land and minor islands (public domain).
//   bun tools/build-geo.ts [--src <dir with the two geojson files>]
// File layout (all integers are LEB128 varints unless noted):
//   "MLND" (4 bytes), u8 version = 1, u8 levels, then per level: varint ringCount, varint byteLength
//   then the level blocks in order. A block is its rings back to back; a ring is
//     n: varint point count, the first point absolute (zigzag varints lon, lat in 1e-5 degree), then bbox
//     minLon, minLat, maxLon, maxLat as zigzag varints in 1e-3 degree relative to the first point (rounded outward,
//     so culling by it is conservative), then the other n-1 points as deltas (zigzag varints, 1e-5 degree).
// Levels: Douglas-Peucker at 0.25, 0.05, 0.01 degrees and the full data. A ring whose bbox is smaller than the
// tolerance keeps a minimal shape at that level (no level drops a ring: a small island must stay land). Rings are filled with the even-odd rule (holes are rings too).
import { join } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
const NAMES = ["ne_10m_land", "ne_10m_minor_islands"];
export const TOLERANCES = [0.25, 0.05, 0.01, 0];
const Q = 1e5;

type Ring = [number, number][];

/** Douglas-Peucker on an open polyline, iterative. Returns the kept points. */
export function dp(pts: Ring, tol: number): Ring {
  const n = pts.length;
  if (tol <= 0 || n < 3) return pts;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let far = -1, fd = t2;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d: number;
      if (L === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else { const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)); d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2; }
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * A closed ring (first = last): split at the point farthest from the start so the endpoints are not degenerate.
 * No level drops a ring: one that is smaller than the tolerance, or simplifies below 4 points, keeps a minimal
 * shape, its original points if it has 8 or fewer, else the four extreme points of its box.
 */
export function simplifyRing(ring: Ring, tol: number): Ring {
  const bb = bbox(ring);
  const minimal = (): Ring => {
    if (ring.length <= 8) return ring;
    const open = ring.slice(0, -1), at = (f: (p: [number, number]) => number) => open.reduce((a, p) => (f(p) > f(a) ? p : a));
    const e = [at(p => -p[1]), at(p => p[0]), at(p => p[1]), at(p => -p[0])];   // south, east, north, west
    return [...e, e[0]];
  };
  if (tol > 0 && Math.max(bb[2] - bb[0], bb[3] - bb[1]) < tol) return minimal();
  if (tol <= 0) return ring;
  const open = ring.slice(0, -1);
  let k = 0, fd = -1;
  for (let i = 1; i < open.length; i++) { const d = (open[i][0] - open[0][0]) ** 2 + (open[i][1] - open[0][1]) ** 2; if (d > fd) { fd = d; k = i; } }
  const a = dp(open.slice(0, k + 1), tol), b = dp([...open.slice(k), open[0]], tol);
  const pts = [...a, ...b.slice(1)];
  return pts.length >= 4 ? pts : minimal();
}
const bbox = (r: Ring) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };

class W {
  b: number[] = [];
  v(n: number) { while (n >= 128) { this.b.push((n & 127) | 128); n = Math.floor(n / 128); } this.b.push(n); }
  z(n: number) { this.v(n < 0 ? -2 * n - 1 : 2 * n); }
}

export function encodeLevel(rings: Ring[], tol: number): { bytes: Uint8Array; count: number } {
  const w = new W(); let count = 0;
  for (const r of rings) {
    const s = simplifyRing(r, tol);
    count++;
    w.v(s.length);
    const x0 = Math.round(s[0][0] * Q), y0 = Math.round(s[0][1] * Q);
    w.z(x0); w.z(y0);
    const b = bbox(s);
    w.z(Math.floor((b[0] * Q - x0) / 100)); w.z(Math.floor((b[1] * Q - y0) / 100)); w.z(Math.ceil((b[2] * Q - x0) / 100)); w.z(Math.ceil((b[3] * Q - y0) / 100));
    let px = x0, py = y0;
    for (let i = 1; i < s.length; i++) { const qx = Math.round(s[i][0] * Q), qy = Math.round(s[i][1] * Q); w.z(qx - px); w.z(qy - py); px = qx; py = qy; }
  }
  return { bytes: Uint8Array.from(w.b), count };
}

if (import.meta.main) {
  const srcArg = process.argv.indexOf("--src"), src = srcArg > 0 ? process.argv[srcArg + 1] : null;
  const rings: Ring[] = [];
  for (const n of NAMES) {
    const p = src ? join(src, n + ".geojson") : null;
    const j = p && existsSync(p) ? await Bun.file(p).json() : await fetch(BASE + n + ".geojson").then(r => { if (!r.ok) throw new Error(`${n}: ${r.status}`); return r.json(); });
    for (const f of j.features) { const g = f.geometry; for (const poly of g.type === "Polygon" ? [g.coordinates] : g.coordinates) for (const r of poly) rings.push(r); }
  }
  console.log(`${rings.length} rings, ${rings.reduce((a, r) => a + r.length, 0)} points`);
  const levels = TOLERANCES.map(t => encodeLevel(rings, t));
  const head = new W();
  head.b.push(0x4d, 0x4c, 0x4e, 0x44, 1, levels.length);
  for (const l of levels) { head.v(l.count); head.v(l.bytes.length); }
  const total = head.b.length + levels.reduce((a, l) => a + l.bytes.length, 0), out = new Uint8Array(total);
  out.set(head.b); let o = head.b.length;
  for (const l of levels) { out.set(l.bytes, o); o += l.bytes.length; }
  const dir = join(import.meta.dir, "../vendor/geo"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "land.bin"), out);
  levels.forEach((l, i) => console.log(`level ${i} tol ${TOLERANCES[i]}: ${l.count} rings, ${(l.bytes.length / 1024).toFixed(1)} KB`));
  console.log(`total ${(total / 1024).toFixed(1)} KB, sha256 ${createHash("sha256").update(out).digest("hex")}, bytes ${total}`);
}
