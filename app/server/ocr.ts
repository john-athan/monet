// Text in photos, the pure part: PaddleOCR's detection and recognition as numbers in and out, no model, no files.
// The models run in server/ocr-worker.ts. Pipeline as PaddleOCR does it (det DB, rec CTC), simplified where photos
// allow: boxes are axis-aligned (text in photos is mostly level; a slanted line still gets read, just with more
// background), and a crop taller than 1.5 times its width is turned a quarter, as PaddleOCR does.

import type { Img } from "./calc";

/** Bilinear sample of a rectangle of `im` into an out x oh float tensor, NCHW, BGR, normalised per channel. */
function sample(im: Img, x0: number, y0: number, sw: number, sh: number, ow: number, oh: number, mean: number[], std: number[], out: Float32Array, rotate = false) {
  const plane = ow * oh;
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    // rotate: the crop is read turned a quarter counter-clockwise, so a vertical line reads left to right
    const u = rotate ? (oh - 1 - y + .5) / oh : (x + .5) / ow, v = rotate ? (x + .5) / ow : (y + .5) / oh;
    const fx = Math.min(im.w - 1, Math.max(0, x0 + u * sw - .5)), fy = Math.min(im.h - 1, Math.max(0, y0 + v * sh - .5));
    const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy, jx = Math.min(im.w - 1, ix + 1), jy = Math.min(im.h - 1, iy + 1);
    const a = (iy * im.w + ix) * 3, b = (iy * im.w + jx) * 3, c = (jy * im.w + ix) * 3, d = (jy * im.w + jx) * 3;
    for (let ch = 0; ch < 3; ch++) {
      const src = 2 - ch; // BGR: PaddleOCR reads images with OpenCV
      const val = (im.px[a + src] * (1 - ax) + im.px[b + src] * ax) * (1 - ay) + (im.px[c + src] * (1 - ax) + im.px[d + src] * ax) * ay;
      out[ch * plane + y * ow + x] = (val / 255 - mean[ch]) / std[ch];
    }
  }
}

/** The detector's input: the long side at most `limit`, both sides a multiple of 32 (PaddleOCR's DetResizeForTest). */
export function detInput(im: Img, limit = 960) {
  const r = Math.min(1, limit / Math.max(im.w, im.h));
  const w = Math.max(32, Math.round(im.w * r / 32) * 32), h = Math.max(32, Math.round(im.h * r / 32) * 32);
  const data = new Float32Array(3 * w * h);
  sample(im, 0, 0, im.w, im.h, w, h, [.485, .456, .406], [.229, .224, .225], data);
  return { data, w, h, sx: im.w / w, sy: im.h / h };
}

export type Box = { x: number; y: number; w: number; h: number; score: number };

/** DB post-processing: pixels above `thresh` form regions (8-connected); a region whose mean probability is at least
 *  `boxThresh` becomes a box, grown by area * unclip / perimeter as PaddleOCR's unclip does, in map coordinates. */
export function boxesFromMap(prob: Float32Array, w: number, h: number, thresh = .3, boxThresh = .6, unclip = 1.5, minSide = 3): Box[] {
  const seen = new Uint8Array(w * h), stack: number[] = [], out: Box[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || prob[s] <= thresh) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sum = 0, n = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!, px = p % w, py = (p - px) / w;
      sum += prob[p]; n++;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!seen[q] && prob[q] > thresh) { seen[q] = 1; stack.push(q); }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < minSide || sum / n < boxThresh) continue;
    const d = (bw * bh * unclip) / (2 * (bw + bh));
    const x = Math.max(0, x0 - d), y = Math.max(0, y0 - d);
    out.push({ x, y, w: Math.min(w, x1 + 1 + d) - x, h: Math.min(h, y1 + 1 + d) - y, score: sum / n });
  }
  return out;
}

export const REC_H = 48;
/** The recogniser's input for one box of the full image: 48 px high, width kept in proportion (at most `maxW`). */
export function recInput(im: Img, b: Box, maxW = 960) {
  const rotate = b.h > 1.5 * b.w;
  const ratio = rotate ? b.h / b.w : b.w / b.h;
  const w = Math.max(16, Math.min(maxW, Math.ceil(REC_H * ratio / 8) * 8));
  const data = new Float32Array(3 * REC_H * w);
  sample(im, b.x, b.y, b.w, b.h, w, REC_H, [.5, .5, .5], [.5, .5, .5], data, rotate);
  return { data, w };
}

/** CTC greedy decode: best class per step, repeats merged, blank (0) dropped. Classes 1..n are the dictionary
 *  lines, n+1 is the space. Returns the text and the mean confidence of the kept characters. */
export function ctcDecode(logits: Float32Array, steps: number, classes: number, dict: string[]): { text: string; score: number } {
  let text = "", sum = 0, n = 0, prev = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0, bv = -Infinity;
    for (let c = 0; c < classes; c++) { const v = logits[t * classes + c]; if (v > bv) { bv = v; best = c; } }
    if (best !== 0 && best !== prev) { text += best <= dict.length ? dict[best - 1] : " "; sum += bv; n++; }
    prev = best;
  }
  return { text: text.trim(), score: n ? sum / n : 0 };
}

/** Lines in reading order: top to bottom, and left to right within a line (boxes whose centres are within half a
 *  line height of each other). */
export function readingOrder<T extends { box: Box }>(xs: T[]): T[] {
  const s = [...xs].sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2));
  const lines: T[][] = [];
  for (const x of s) {
    const l = lines[lines.length - 1], cy = x.box.y + x.box.h / 2;
    if (l && Math.abs(cy - (l[0].box.y + l[0].box.h / 2)) < l[0].box.h / 2) l.push(x); else lines.push([x]);
  }
  return lines.flatMap(l => l.sort((a, b) => a.box.x - b.box.x));
}
