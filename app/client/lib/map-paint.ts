// How each map technique (shared/styles.ts: technique.map) paints the sea, the land, a place's photos and the
// selection. Karte.svelte does the geometry, the hand and the labels; it calls the technique of the style on screen.
// Every painter leaves the transform at (dpr, 0, 0, dpr, 0, 0) and alpha at 1 when it is done.
import type { Technique } from "../../shared/styles";
import { eachDab, gridLevel, worldSize, hash, rnd, bouquet, type View } from "./map";

/** What a painter draws with: the canvas, its size in CSS pixels, the view and the map colours (--k-* and two UI tokens) */
export interface Brush { ctx: CanvasRenderingContext2D; dpr: number; W: number; H: number; view: View; pal: Record<string, string> }
export interface MapTechnique {
  sea(b: Brush): void;
  land(b: Brush, land: Path2D): void;
  /** a place with `n` photos at x,y, `R` its radius; colour(i) is the lifted colour of its i-th member, colour(-1) that of its head */
  photo(b: Brush, x: number, y: number, R: number, n: number, seed: number, colour: (i: number) => string): void;
  selection(b: Brush, x: number, y: number, R: number): void;
}

const reset = ({ ctx, dpr }: Brush) => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; };

/** a Monet dab: a rounded stroke, rotated */
function dab({ ctx, dpr }: Brush, x: number, y: number, w: number, h: number, rot: number) {
  const c = Math.cos(rot) * dpr, s = Math.sin(rot) * dpr;
  ctx.setTransform(c, s, -s, c, x * dpr, y * dpr);
  ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
}
/** Ernst: a decalcomania blot, the paint pressed off the glass: a ring of lobes of uneven reach, smoothed */
function blot({ ctx, dpr }: Brush, x: number, y: number, r: number, h: number, flat = 0.8) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const n = 9, p: [number, number][] = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, rr = r * (0.5 + rnd(h, 10 + k) * 0.7); p.push([x + Math.cos(a) * rr * 1.25, y + Math.sin(a) * rr * flat]); }
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  ctx.beginPath(); ctx.moveTo(...mid(p[n - 1], p[0]));
  for (let k = 0; k < n; k++) ctx.quadraticCurveTo(p[k][0], p[k][1], ...mid(p[k], p[(k + 1) % n]));
  ctx.closePath();
}
/** Magritte: a still cumulus, the shaded puffs laid first and the lit ones over them, all with hard edges */
function cumulus({ ctx, dpr, pal }: Brush, x: number, y: number, s: number, h: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const puffs: [number, number, number][] = [];
  for (let k = 0; k < 6; k++) { const u = rnd(h, 20 + k) * 2 - 1; puffs.push([x + u * s * 0.45, y - rnd(h, 30 + k) * s * 0.28 * (1 - Math.abs(u) * 0.6), s * (0.16 + rnd(h, 40 + k) * 0.14)]); }
  ctx.fillStyle = pal.li; ctx.beginPath(); ctx.ellipse(x, y + s * 0.08, s * 0.55, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); for (const [px, py, r] of puffs) { ctx.moveTo(px + r, py + r * 0.25); ctx.arc(px, py + r * 0.25, r, 0, Math.PI * 2); } ctx.fill();
  ctx.fillStyle = pal.oc; ctx.beginPath(); for (const [px, py, r] of puffs) { ctx.moveTo(px - r * 0.1 + r * 0.9, py - r * 0.05); ctx.arc(px - r * 0.1, py - r * 0.05, r * 0.9, 0, Math.PI * 2); } ctx.fill();
}
/** Magritte: the photos are apples, in the colour of the photo, modelled round, with a green leaf */
function apple({ ctx, dpr, pal }: Brush, x: number, y: number, r: number, col: string) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const path = () => { ctx.beginPath(); ctx.moveTo(x, y - r * 0.72); ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.15, y - r * 0.6, x + r * 1.02, y + r * 0.1); ctx.bezierCurveTo(x + r * 0.95, y + r * 0.8, x + r * 0.45, y + r * 1.05, x, y + r * 0.92); ctx.bezierCurveTo(x - r * 0.45, y + r * 1.05, x - r * 0.95, y + r * 0.8, x - r * 1.02, y + r * 0.1); ctx.bezierCurveTo(x - r * 1.15, y - r * 0.6, x - r * 0.7, y - r * 1.2, x, y - r * 0.72); ctx.closePath(); };
  path(); ctx.globalAlpha = 1; ctx.lineWidth = 2.2; ctx.strokeStyle = pal.rim; ctx.stroke(); ctx.fillStyle = col; ctx.fill();
  const lit = ctx.createRadialGradient(x - r * 0.38, y - r * 0.3, r * 0.05, x - r * 0.1, y, r * 1.15);
  lit.addColorStop(0, "rgba(255,255,255,.6)"); lit.addColorStop(0.35, "rgba(255,255,255,.08)"); lit.addColorStop(0.75, "rgba(0,0,0,0)"); lit.addColorStop(1, "rgba(0,0,0,.38)");
  path(); ctx.fillStyle = lit; ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.14); ctx.strokeStyle = "#4A3220"; ctx.beginPath(); ctx.moveTo(x, y - r * 0.6); ctx.quadraticCurveTo(x + r * 0.05, y - r * 1.05, x + r * 0.25, y - r * 1.25); ctx.stroke();
  ctx.fillStyle = "#4F8F2A"; ctx.beginPath(); ctx.ellipse(x + r * 0.55, y - r * 1.05, r * 0.42, r * 0.18, -0.45, 0, Math.PI * 2); ctx.fill();
}

/** Monet and Ernst set the sea down in short strokes: dabs for Monet, fine calm lines for Ernst and Magritte */
function sea(b: Brush, kind: "dabs" | "fine" | "still") {
  const { ctx, W, H, view, pal } = b, wcol = [pal.w1, pal.w2, pal.w3];
  ctx.fillStyle = pal.water; ctx.fillRect(0, 0, W, H);
  if (kind === "dabs") eachDab(view, W, H, 46, 1, 2.4, (x, y, r0, r1, r2, r3, cell) => {
    ctx.globalAlpha = 0.3 + r3 * 0.45; ctx.fillStyle = wcol[Math.floor(r2 * 3)];
    dab(b, x, y, cell * (0.4 + r0 * 0.6), 3 + r1 * 4, (r1 - 0.5) * 0.05); ctx.fill();
  });
  else {
    const fine = kind === "fine";
    ctx.lineCap = "round";
    eachDab(view, W, H, 46, 1, fine ? 1.6 : 0.9, (x, y, r0, r1, r2, r3, cell) => {
      ctx.globalAlpha = fine ? 0.3 + r3 * 0.4 : 0.25 + r3 * 0.35; ctx.strokeStyle = wcol[Math.floor(r2 * 3)];
      ctx.lineWidth = fine ? 0.8 + r1 * 1.2 : 0.6 + r1 * 0.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + cell * (0.2 + r0 * (fine ? 0.5 : 0.25)), y + (r1 - 0.5) * 0.8); ctx.stroke();
    });
  }
  reset(b);
}

/** the photos as a bouquet of marks in their own colours, each with a rim */
function bouquetOf(b: Brush, x: number, y: number, n: number, seed: number, colour: (i: number) => string, mark: (d: ReturnType<typeof bouquet>[number]) => void) {
  const { ctx, pal } = b;
  for (const d of bouquet(n, seed)) {
    mark(d);
    ctx.globalAlpha = 0.95; ctx.strokeStyle = pal.rim; ctx.lineWidth = 3.2; ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = colour(d.pick); ctx.fill();
  }
}

/** a patchy choice among the land colours: neighbouring cells tend to the same one */
function patchy(b: Brush, cellPx: number, salt: number, perCell: number, spread: number, cuts: [number, number, number], cb: (x: number, y: number, r0: number, r1: number, r3: number, h: number, colour: string) => void) {
  const { W, H, view, pal } = b, lcol = [pal.g1, pal.g2, pal.oc, pal.li];
  const L = gridLevel(view.z, 30), S = worldSize(view.z), left = view.cx - W / 2 / S, top = view.cy - H / 2 / S, coarse = 2 ** (L - 2);
  eachDab(view, W, H, cellPx, salt, perCell, (x, y, r0, r1, r2, r3, _cell, hh) => {
    const patch = rnd(hash(Math.floor((left + x / S) * coarse), Math.floor((top + y / S) * coarse), L, 7), 0);
    const t = r2 + (patch - 0.5) * spread;
    cb(x, y, r0, r1, r3, hh, lcol[t < cuts[0] ? 0 : t < cuts[1] ? 1 : t < cuts[2] ? 2 : 3]);
  });
}

export const MAP: Record<Technique["map"], MapTechnique> = {
  // Monet: sea and land in dabs, a soft surf round the coast, the photos a bouquet of dabs, the selection a sun ring
  dabs: {
    sea: b => sea(b, "dabs"),
    land(b, lp) {
      const { ctx, pal } = b;
      ctx.lineJoin = "round"; ctx.strokeStyle = pal.surf;
      ctx.globalAlpha = 0.28; ctx.lineWidth = 11; ctx.stroke(lp);
      ctx.globalAlpha = 0.5; ctx.lineWidth = 4.5; ctx.stroke(lp);
      ctx.globalAlpha = 1; ctx.fillStyle = pal.land; ctx.fill(lp, "evenodd");
      ctx.save(); ctx.clip(lp, "evenodd");
      patchy(b, 30, 2, 2.1, 0.7, [0.4, 0.62, 0.86], (x, y, r0, _r1, r3, hh, col) => {
        ctx.fillStyle = col;
        // sizes as in the Pinselband (band.ts): 11 to 23 px long, 5 to 9 px high, within 5 degrees, a little alpha
        ctx.globalAlpha = 0.2 + r3 * 0.26;
        dab(b, x, y, 11 + r0 * 12, 5 + rnd(hh, 7) * 4, (rnd(hh, 8) - 0.5) * 0.175); ctx.fill();
      });
      ctx.restore(); reset(b);
    },
    photo: (b, x, y, _R, n, seed, colour) => { bouquetOf(b, x, y, n, seed, colour, d => dab(b, x + d.dx, y + d.dy, d.w, d.h, d.rot)); reset(b); },
    selection({ ctx, pal }, x, y, R) { ctx.beginPath(); ctx.arc(x, y, R + 6, 0, Math.PI * 2); ctx.strokeStyle = pal.sun; ctx.lineWidth = 1.5; ctx.stroke(); },
  },
  // Ernst, Europe after the Rain: a rust ground, decalcomania blots of moss, ochre and burnt earth pressed into it,
  // the veins the lifted paint leaves, and a dark coast drawn round it; a calm teal sea in fine strokes
  decalcomania: {
    sea: b => sea(b, "fine"),
    land(b, lp) {
      const { ctx, pal, W, H, view, dpr } = b;
      ctx.fillStyle = pal.land; ctx.fill(lp, "evenodd");
      ctx.save(); ctx.clip(lp, "evenodd");
      patchy(b, 24, 2, 2.4, 0.8, [0.35, 0.6, 0.85], (x, y, r0, _r1, r3, hh, col) => {
        ctx.fillStyle = col; ctx.globalAlpha = 0.4 + r3 * 0.45;
        blot(b, x, y, 3 + r0 * 8, hh); ctx.fill();
      });
      ctx.lineCap = "round"; ctx.strokeStyle = pal.oc;
      eachDab(view, W, H, 60, 3, 1.2, (x, y, r0, r1, _r2, r3, _cell, hh) => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 0.35 + r3 * 0.3; ctx.lineWidth = 0.6 + r0 * 0.6;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (rnd(hh, 50 + k) - 0.5) * 16; y += (rnd(hh, 60 + k) - 0.3) * 10 * (r1 + 0.4); ctx.lineTo(x, y); }
        ctx.stroke();
      });
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineJoin = "round"; ctx.strokeStyle = pal.surf; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.4; ctx.stroke(lp);
      reset(b);
    },
    photo: (b, x, y, _R, n, seed, colour) => { bouquetOf(b, x, y, n, seed, colour, d => blot(b, x + d.dx, y + d.dy, d.w * 0.42, hash(seed, d.pick, 3, 11), 0.85)); reset(b); },
    // his ring sun round it, with its halo
    selection({ ctx, pal }, x, y, R) {
      ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.arc(x, y, R + 12, 0, Math.PI * 2); ctx.strokeStyle = pal.sun; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, R + 7, 0, Math.PI * 2); ctx.lineWidth = 3.5; ctx.stroke();
    },
  },
  // Magritte: the land is a piece of day sky with its clouds, cut out of a still night sea with an exact contour;
  // the photos are apples, the selection is framed
  daysky: {
    sea: b => sea(b, "still"),
    land(b, lp) {
      const { ctx, pal, W, H, view, dpr } = b;
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, pal.g1); sky.addColorStop(0.6, pal.land); sky.addColorStop(1, pal.g2);
      ctx.fillStyle = sky; ctx.fill(lp, "evenodd");
      ctx.save(); ctx.clip(lp, "evenodd");
      eachDab(view, W, H, 110, 4, 0.75, (x, y, r0, _r1, _r2, _r3, cell, hh) => cumulus(b, x, y, Math.min(140, cell * (0.3 + r0 * 0.35)), hh));
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1;
      ctx.lineJoin = "round"; ctx.strokeStyle = pal.surf; ctx.lineWidth = 1.1; ctx.stroke(lp);
      reset(b);
    },
    photo: (b, x, y, R, _n, _seed, colour) => { apple(b, x, y, Math.max(6, R * 0.72), colour(-1)); reset(b); },
    // a frame: two exact rings
    selection({ ctx, pal }, x, y, R) {
      ctx.strokeStyle = pal.ink; ctx.lineWidth = 1.2;
      for (const d of [8, 11]) { ctx.beginPath(); ctx.arc(x, y, R + d, 0, Math.PI * 2); ctx.stroke(); }
    },
  },
};
