// The arithmetic of zooming a photo: where the picture may be, which pyramid level is needed, which tiles are seen.
// Coordinates: the picture's box ("frame") is laid out at fx, fy with size fw x fh inside a stage of W x H (CSS px);
// the view moves it by x, y and scales it by s around its top left corner. s = 1 is the fitted picture.

export type View = { s: number; x: number; y: number };
export type Box = { fx: number; fy: number; fw: number; fh: number; W: number; H: number };
export type Pyramid = { w: number; h: number; tile: number; overlap: number; maxLevel: number };
export type Tile = { key: string; level: number; col: number; row: number; left: number; top: number; width: number; height: number };

/** Largest zoom: two device pixels per photo pixel, and never less than twice the fitted size. */
export const maxScale = (b: Box, imgW: number, dpr: number) => Math.max(2, (2 * imgW) / (b.fw * dpr));
/** The zoom at which one photo pixel is one device pixel. */
export const oneToOne = (b: Box, imgW: number, dpr: number) => imgW / (b.fw * dpr);

function axis(pos: number, size: number, room: number, f: number) {
  // smaller than the stage: centred; larger: no gap at either edge
  const v = size <= room ? (room - size) / 2 - f : Math.min(-f, Math.max(room - f - size, pos));
  return v || 0; // no negative zero
}
/** The view moved back inside its bounds. */
export function clamp(v: View, b: Box, sMax: number): View {
  const s = Math.min(sMax, Math.max(1, v.s));
  return { s, x: axis(v.x, b.fw * s, b.W, b.fx), y: axis(v.y, b.fh * s, b.H, b.fy) };
}
/** Scale to `s` keeping the stage point (px, py) on the same spot of the picture. */
export function zoomAt(v: View, s: number, px: number, py: number, b: Box): View {
  const qx = (px - b.fx - v.x) / v.s, qy = (py - b.fy - v.y) / v.s;
  return { s, x: px - b.fx - s * qx, y: py - b.fy - s * qy };
}

/** The pyramid level whose width just covers what the screen shows, or -1 when the base picture (baseW wide) is enough. */
export function levelFor(p: Pyramid, b: Box, s: number, dpr: number, baseW: number): number {
  const need = b.fw * s * dpr;
  if (need <= baseW * 1.15) return -1;
  const L = p.maxLevel - Math.floor(Math.log2(p.w / need));
  return Math.max(0, Math.min(p.maxLevel, L));
}
/** The tiles of a level that the stage shows, positioned in percent of the picture's box. */
export function tilesFor(p: Pyramid, level: number, v: View, b: Box, cap = 160): Tile[] {
  if (level < 0) return [];
  const f = 2 ** (p.maxLevel - level), lw = Math.ceil(p.w / f), lh = Math.ceil(p.h / f), T = p.tile, O = p.overlap;
  // the part of the picture on screen, in level pixels
  const x0 = Math.max(0, (-b.fx - v.x) / v.s) * lw / b.fw, x1 = Math.min(b.fw, (b.W - b.fx - v.x) / v.s) * lw / b.fw;
  const y0 = Math.max(0, (-b.fy - v.y) / v.s) * lh / b.fh, y1 = Math.min(b.fh, (b.H - b.fy - v.y) / v.s) * lh / b.fh;
  if (x1 <= x0 || y1 <= y0) return [];
  const lastC = Math.ceil(lw / T) - 1, lastR = Math.ceil(lh / T) - 1;
  const c0 = Math.max(0, Math.floor(x0 / T)), c1 = Math.min(lastC, Math.floor((x1 - .001) / T));
  const r0 = Math.max(0, Math.floor(y0 / T)), r1 = Math.min(lastR, Math.floor((y1 - .001) / T));
  const out: Tile[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const ax = c * T - (c > 0 ? O : 0), bx = Math.min(lw, (c + 1) * T + O), ay = r * T - (r > 0 ? O : 0), by = Math.min(lh, (r + 1) * T + O);
    out.push({ key: `${level}/${c}_${r}`, level, col: c, row: r, left: ax / lw * 100, top: ay / lh * 100, width: (bx - ax) / lw * 100, height: (by - ay) / lh * 100 });
    if (out.length >= cap) return out;
  }
  return out;
}
