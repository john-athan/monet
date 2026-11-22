// Die Karte, the pure part: Web Mercator, the land file (vendor/geo/land.bin, see tools/build-geo.ts), the world grid
// the brush dabs sit on, and the clustering of the photos. No DOM here, so all of it is testable.
// World coordinates run from 0 to 1 in both directions (x west to east, y north to south); a view is a centre in
// world coordinates and a zoom z, the whole world being 256 * 2^z pixels wide.

export interface View { cx: number; cy: number; z: number }
export const MAX_LAT = 85.0511287798;
export const MIN_Z = 0, MAX_Z = 11, FIT_MAX_Z = 10;
// MAX_Z: the 1:10m land is a few dozen points for all of Malta; closer than this the coast is a visible polygon with
// straight edges, which is geometry, not painting. Photos separate in the cluster Sheet instead.


export const wx = (lon: number) => (lon + 180) / 360;
export const wy = (lat: number) => { const f = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180); return 0.5 - Math.log((1 + f) / (1 - f)) / (4 * Math.PI); };
export const lonOf = (x: number) => x * 360 - 180;
export const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
export const worldSize = (z: number) => 256 * 2 ** z;

/** The lowest zoom at which a canvas of this height still shows no empty space above and below the world. */
export const minZoom = (H: number) => Math.max(MIN_Z, Math.log2(Math.max(1, H) / 256));
export function clampView(v: View, W: number, H: number): View {
  const z = Math.max(minZoom(H), Math.min(MAX_Z, v.z)), S = worldSize(z);
  const hy = H / 2 / S, hx = W / 2 / S;
  // a world narrower than the canvas stays centred; otherwise the edge stops at the canvas edge
  const cx = hx >= 0.5 ? 0.5 : Math.max(hx, Math.min(1 - hx, v.cx)), cy = hy >= 0.5 ? 0.5 : Math.max(hy, Math.min(1 - hy, v.cy));
  return { cx, cy, z };
}
/** Zoom by dz around the screen point (px, py): the world point under it stays under it. */
export function zoomAt(v: View, dz: number, px: number, py: number, W: number, H: number): View {
  const z = Math.max(minZoom(H), Math.min(MAX_Z, v.z + dz)), S0 = worldSize(v.z), S1 = worldSize(z);
  const x = v.cx + (px - W / 2) / S0, y = v.cy + (py - H / 2) / S0;
  return clampView({ cx: x - (px - W / 2) / S1, cy: y - (py - H / 2) / S1, z }, W, H);
}
export function panBy(v: View, dx: number, dy: number, W: number, H: number): View {
  const S = worldSize(v.z);
  return clampView({ ...v, cx: v.cx - dx / S, cy: v.cy - dy / S }, W, H);
}
/** The view that holds a world box with padding (a fraction of the canvas), never closer than FIT_MAX_Z: one place is not shown absurdly close. */
export function fitBox(b: { x0: number; y0: number; x1: number; y1: number }, W: number, H: number, pad = 0.14, maxZ = FIT_MAX_Z): View {
  const dx = Math.max(b.x1 - b.x0, 1e-9), dy = Math.max(b.y1 - b.y0, 1e-9);
  const z = Math.min(maxZ, Math.log2(Math.min((W * (1 - 2 * pad)) / dx, (H * (1 - 2 * pad)) / dy) / 256));
  return clampView({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, z }, W, H);
}
/** Europe, for a library without a single geotag. */
export const europeBox = { x0: wx(-11), y0: wy(62), x1: wx(33), y1: wy(35) };

/* ---------- the land file ---------- */
export interface Level { n: number; /** minX, minY, maxX, maxY per ring, world coordinates */ box: Float64Array; /** point offsets, n + 1 */ start: Uint32Array; /** x, y per point, world coordinates */ pts: Float64Array }
export interface Land { levels: number; tol: number[]; counts: number[]; offsets: number[]; lengths: number[]; buf: Uint8Array; cache: (Level | undefined)[] }
export const LEVEL_TOL = [0.25, 0.05, 0.01, 0];

export function openLand(data: ArrayBuffer | Uint8Array): Land {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf[0] !== 0x4d || buf[1] !== 0x4c || buf[2] !== 0x4e || buf[3] !== 0x44 || buf[4] !== 1) throw new Error("land.bin: wrong file");
  const levels = buf[5]; let p = 6;
  const rd = () => { let r = 0, m = 1, b; do { b = buf[p++]; r += (b & 127) * m; m *= 128; } while (b & 128); return r; };
  const counts: number[] = [], lengths: number[] = [];
  for (let i = 0; i < levels; i++) { counts.push(rd()); lengths.push(rd()); }
  const offsets: number[] = []; let o = p;
  for (let i = 0; i < levels; i++) { offsets.push(o); o += lengths[i]; }
  return { levels, tol: LEVEL_TOL.slice(0, levels), counts, offsets, lengths, buf, cache: [] };
}

/** Decodes one level once (the full one holds about 480 000 points, a few tens of milliseconds). */
export function level(land: Land, i: number): Level {
  const hit = land.cache[i]; if (hit) return hit;
  const n = land.counts[i], buf = land.buf;
  let p = land.offsets[i];
  const rd = () => { let r = 0, m = 1, b; do { b = buf[p++]; r += (b & 127) * m; m *= 128; } while (b & 128); return r; };
  const zz = () => { const v = rd(); return v % 2 ? -(v + 1) / 2 : v / 2; };
  const box = new Float64Array(n * 4), start = new Uint32Array(n + 1);
  let pts = new Float64Array(Math.max(1024, land.lengths[i]));  // a point takes at least 2 bytes, so this is enough
  let k = 0;
  for (let r = 0; r < n; r++) {
    const m = rd(), x0 = zz(), y0 = zz();
    const bx0 = x0 + zz() * 100, by0 = y0 + zz() * 100, bx1 = x0 + zz() * 100, by1 = y0 + zz() * 100;  // 1e-5 degree
    box[r * 4] = wx(bx0 / 1e5); box[r * 4 + 1] = wy(by1 / 1e5); box[r * 4 + 2] = wx(bx1 / 1e5); box[r * 4 + 3] = wy(by0 / 1e5);
    start[r] = k;
    if (k + m > pts.length / 2) { const bigger = new Float64Array(pts.length * 2); bigger.set(pts); pts = bigger; }
    let qx = x0, qy = y0;
    pts[2 * k] = wx(qx / 1e5); pts[2 * k + 1] = wy(qy / 1e5); k++;
    for (let j = 1; j < m; j++) { qx += zz(); qy += zz(); pts[2 * k] = wx(qx / 1e5); pts[2 * k + 1] = wy(qy / 1e5); k++; }
  }
  start[n] = k;
  return (land.cache[i] = { n, box, start, pts: pts.slice(0, 2 * k) });
}

/** The level of detail whose simplification error stays under about a pixel at this zoom. */
export function levelFor(z: number, levels = 4): number {
  const ppd = worldSize(z) / 360;
  const i = ppd <= 4.5 ? 0 : ppd <= 40 ? 1 : ppd <= 160 ? 2 : 3;
  return Math.min(i, levels - 1);
}

/* ---------- the world grid of dabs ---------- */
export function hash(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35) ^ Math.imul(d | 0, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
export const rnd = (h: number, i: number) => hash(h, i, 17, 3) / 4294967296;

/** The grid level for a zoom: cells are powers of two of the world, so they stay between cellPx/1.41 and cellPx*1.41 on screen. */
export const gridLevel = (z: number, cellPx: number) => Math.round(Math.log2(worldSize(z) / cellPx));

/**
 * Calls `cb` for every dab of the visible world cells. A dab belongs to a cell of the world grid and is placed by a
 * hash of that cell, so it stays where it is while the map is panned. `r0..r3` are four values in [0, 1) for the
 * dab (size, angle, colour, spare); `cell` is the cell's size in pixels.
 */
export function eachDab(v: View, W: number, H: number, cellPx: number, salt: number, perCell: number, cb: (sx: number, sy: number, r0: number, r1: number, r2: number, r3: number, cell: number, h: number) => void) {
  const S = worldSize(v.z), L = gridLevel(v.z, cellPx), cells = 2 ** L, cell = S / cells;
  const left = v.cx - W / 2 / S, top = v.cy - H / 2 / S;
  const g0 = Math.floor(left * cells) - 1, g1 = Math.floor((left + W / S) * cells) + 1, t0 = Math.floor(top * cells) - 1, t1 = Math.floor((top + H / S) * cells) + 1;
  for (let gy = t0; gy <= t1; gy++) for (let gx = g0; gx <= g1; gx++) {
    const h = hash(gx, gy, L, salt);
    const k = perCell >= 1 ? Math.floor(perCell) + (rnd(h, 99) < perCell % 1 ? 1 : 0) : rnd(h, 99) < perCell ? 1 : 0;
    for (let j = 0; j < k; j++) {
      const hj = hash(h, j, 5, salt);
      cb(((gx + rnd(hj, 0)) / cells - left) * S, ((gy + rnd(hj, 1)) / cells - top) * S, rnd(hj, 2), rnd(hj, 3), rnd(hj, 4), rnd(hj, 5), cell, hj);
    }
  }
}

/* ---------- the photos ---------- */
export interface Points { n: number; x: Float64Array; y: Float64Array; color: string[]; ids: number[] }
export function toPoints(m: { ids: number[]; lat: number[]; lon: number[]; color: string[] }): Points {
  const n = m.ids.length, x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = wx(m.lon[i]); y[i] = wy(m.lat[i]); }
  return { n, x, y, color: m.color, ids: m.ids };
}
export function boundsOf(p: Points): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!p.n) return null;
  let x0 = 2, y0 = 2, x1 = -1, y1 = -1;
  for (let i = 0; i < p.n; i++) { if (p.x[i] < x0) x0 = p.x[i]; if (p.x[i] > x1) x1 = p.x[i]; if (p.y[i] < y0) y0 = p.y[i]; if (p.y[i] > y1) y1 = p.y[i]; }
  return { x0, y0, x1, y1 };
}

export interface Cluster { n: number; /** mean position, world */ x: number; y: number; /** screen position */ sx: number; sy: number; head: number }
/**
 * Groups the photos in view by a grid of `cell` px that is anchored to the world (so panning never regroups) and
 * returns the clusters; `next` is the linked list of members (head, then next[head], until -1).
 */
export function cluster(p: Points, v: View, W: number, H: number, cell = 28, next?: Int32Array): { clusters: Cluster[]; next: Int32Array } {
  const S = worldSize(v.z), nx = next && next.length >= p.n ? next : new Int32Array(p.n), k = S / cell;
  const left = v.cx - W / 2 / S, top = v.cy - H / 2 / S;
  // cells are world-anchored (floor(x * S / cell)), counted from the first one in view, so they sit in plain arrays
  const gx0 = Math.floor(left * k) - 1, gy0 = Math.floor(top * k) - 1, gw = Math.ceil((W / S) * k) + 4, gh = Math.ceil((H / S) * k) + 4;
  const head = new Int32Array(gw * gh).fill(-1), cnt = new Uint32Array(gw * gh), sx = new Float64Array(gw * gh), sy = new Float64Array(gw * gh);
  for (let i = 0; i < p.n; i++) {
    const x = p.x[i], y = p.y[i], gx = Math.floor(x * k) - gx0, gy = Math.floor(y * k) - gy0;
    if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue;
    const c = gy * gw + gx;
    nx[i] = head[c]; head[c] = i; cnt[c]++; sx[c] += x; sy[c] += y;
  }
  const clusters: Cluster[] = [];
  for (let c = 0; c < head.length; c++) {
    if (head[c] < 0) continue;
    const n = cnt[c], x = sx[c] / n, y = sy[c] / n;
    clusters.push({ n, x, y, sx: (x - left) * S, sy: (y - top) * S, head: head[c] });
  }
  return { clusters, next: nx };
}
export function members(c: Cluster, next: Int32Array): number[] { const out: number[] = []; for (let i = c.head; i >= 0; i = next[i]) out.push(i); return out; }

/** The radius of a bouquet of n photos in px. */
export const bouquetRadius = (n: number) => (n <= 1 ? 6 : Math.min(30, 8 + 3.4 * Math.sqrt(n)));
/** Up to 7 dabs of a bouquet: offset from the centre, size, angle, colour index among the members. Deterministic by the first member's id. */
export interface BouquetDab { dx: number; dy: number; w: number; h: number; rot: number; pick: number }
export function bouquet(n: number, seed: number): BouquetDab[] {
  const m = Math.min(7, n), R = bouquetRadius(n), out: BouquetDab[] = [];
  if (n <= 1) return [{ dx: 0, dy: 0, w: 14, h: 8, rot: (rnd(seed, 1) - 0.5) * 0.4, pick: 0 }];
  for (let i = 0; i < m; i++) {
    const a = i * 2.39996 + rnd(seed, 2) * 6.28, d = i === 0 ? 0 : R * 0.62 * Math.sqrt((i + 0.4) / m) + rnd(seed, 10 + i) * 2;
    out.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.8, w: 11 + Math.sqrt(n) * 0.5 + rnd(seed, 20 + i) * 4, h: 7 + rnd(seed, 30 + i) * 2, rot: (rnd(seed, 40 + i) - 0.5) * 0.7, pick: Math.floor((i * n) / m) });
  }
  return out;
}

/* ---------- labels ---------- */
export interface Box { x0: number; y0: number; x1: number; y1: number }
export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
/** The first candidate that touches none of the boxes already drawn, or null. */
export function place(cands: Box[], taken: Box[]): Box | null { return cands.find(c => !taken.some(t => overlaps(c, t))) ?? null; }

export interface Named { name: string; lat: number; lon: number; count: number }
/** The place nearest to a world point, by great-circle-ish distance in degrees. */
export function nearestPlace<T extends Named>(places: T[], x: number, y: number): T | null {
  let best: T | null = null, bd = Infinity;
  const lat = latOf(y), lon = lonOf(x), k = Math.cos((lat * Math.PI) / 180);
  for (const p of places) { const d = (p.lat - lat) ** 2 + ((p.lon - lon) * k) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
}

/** The design has no black: a dab colour with HSV value below `min` is lifted to it, hue and saturation kept. */
export function lift(hex: string, min = 0.35): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, v = Math.max(r, g, b);
  if (v >= min) return hex;
  if (v === 0) { const c = Math.round(min * 255).toString(16).padStart(2, "0"); return `#${c}${c}${c}`; }
  const f = min / v, h = (x: number) => Math.min(255, Math.round(x * f * 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
