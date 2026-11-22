// Pure functions with no database and no I/O: day titles, accent colours, colour clustering.
// Kept apart so the tests can run them without a server.

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** "Heute", "Gestern", "Sonntag, 16. November", and with the year when it is not the current one:
 *  "Samstag, 14. Februar 2015". `date` and `today` are local calendar days, YYYY-MM-DD. */
export function dayTitle(date: string, today: string): string {
  if (date === today) return "Heute";
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  if (Date.UTC(y, m - 1, d) === t - 86400_000) return "Gestern";
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${d}. ${MONTHS[m - 1]}${y === +today.slice(0, 4) ? "" : " " + y}`;
}

/* ---------- colour ---------- */
export type RGB = [number, number, number];
export const hexToRgb = (h: string): RGB => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB;
export const rgbToHex = (c: RGB) => "#" + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export function contrast(a: RGB, b: RGB) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** Chroma (max - min), 0..255. Plain HSL saturation calls near-black pixels "saturated", chroma does not. */
export const chroma = (c: RGB) => Math.max(...c) - Math.min(...c);

function toHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/** Moves lightness one percent at a time (down for a light background, up for a dark one) until the colour reaches
 *  `min`:1 against `bg`. Hue and saturation stay, so the day keeps its colour. */
export function reachContrast(hex: string, bg: string, dir: "darker" | "lighter", min = 4.5): string {
  const b = hexToRgb(bg), [h, s, l0] = toHsl(hexToRgb(hex));
  let l = l0, c = fromHsl(h, s, l);
  for (let i = 0; i < 100 && contrast(hexToRgb(rgbToHex(c)), b) < min; i++) {
    l = dir === "darker" ? l - 0.01 : l + 0.01; c = fromHsl(h, s, Math.max(0, Math.min(1, l)));
  }
  return rgbToHex(c);
}
export const DAY_BG = "#EEF2EA", NIGHT_BG = "#1C2049";
/** The day's accent: its most saturated colour, adjusted for both themes. */
export function daySign(colors: string[]): { sign: string; signNight: string } {
  const best = colors.filter(c => /^#[0-9a-f]{6}$/i.test(c)).sort((a, b) => chroma(hexToRgb(b)) - chroma(hexToRgb(a)))[0] ?? "#6b7a63";
  return { sign: reachContrast(best, DAY_BG, "darker"), signNight: reachContrast(best, NIGHT_BG, "lighter") };
}

/** k-means (k clusters) on RGB points, deterministic: farthest-point seeding, 12 rounds. Centres come back biggest first. */
export function kmeans(px: RGB[], k = 3): { mean: RGB; centres: RGB[] } {
  const n = px.length || 1;
  const mean = px.length ? [0, 1, 2].map(i => px.reduce((s, p) => s + p[i], 0) / n) as RGB : [128, 128, 128] as RGB;
  if (!px.length) return { mean, centres: [mean, mean, mean] };
  const d2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  let cs: RGB[] = [px.reduce((best, p) => d2(p, mean) < d2(best, mean) ? p : best, px[0])];
  while (cs.length < k) cs.push(px.reduce((best, p) => Math.min(...cs.map(c => d2(p, c))) > Math.min(...cs.map(c => d2(best, c))) ? p : best, px[0]));
  let sizes = new Array(k).fill(0);
  for (let it = 0; it < 12; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (const p of px) { let bi = 0, bd = Infinity; cs.forEach((c, i) => { const d = d2(p, c); if (d < bd) { bd = d; bi = i; } }); sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; sum[bi][3]++; }
    cs = cs.map((c, i) => sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] as RGB : c);
    sizes = sum.map(s => s[3]);
  }
  const order = cs.map((c, i) => i).sort((a, b) => sizes[b] - sizes[a]);
  return { mean, centres: order.map(i => cs[i]) };
}

export type Img = { w: number; h: number; px: Uint8Array }; // RGB, 3 bytes per pixel, row by row
/** Parses a binary PPM (P6) as written by vips into an image (server/ocr.ts reads text from it). */
export function readPpmImage(b: Uint8Array): Img {
  let i = 0;
  const tok = () => { for (;;) { while (b[i] === 0x0a || b[i] === 0x20 || b[i] === 0x0d || b[i] === 0x09) i++; if (b[i] !== 0x23) break; while (i < b.length && b[i] !== 0x0a) i++; } let s = ""; while (i < b.length && b[i] > 0x20) s += String.fromCharCode(b[i++]); return s; };
  if (tok() !== "P6") throw new Error("not a P6 ppm");
  const w = +tok(), h = +tok(); if (+tok() !== 255) throw new Error("ppm must be 8 bit"); i++;
  if (b.length - i < w * h * 3) throw new Error("ppm too short");
  return { w, h, px: b.subarray(i, i + w * h * 3) };
}
/** The pixels of a PPM as a list (for kmeans). */
export function readPpm(b: Uint8Array): RGB[] {
  const { w, h, px } = readPpmImage(b), out: RGB[] = [];
  for (let p = 0; p < w * h; p++) out.push([px[p * 3], px[p * 3 + 1], px[p * 3 + 2]]);
  return out;
}

/** A month's palette as a painter would pick it: from the three dominant colours of every photo, the most
 *  saturated ones, at most one per hue region. Averaging the photos' mean colours (the first version) turned every
 *  month grey, Malta included. Grey months stay grey only when no photo holds a real colour. */
export function monthPalette(hexes: string[], max = 6): string[] {
  const hsv = (h: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const hue = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: hue * 60, s: mx === 0 ? 0 : d / mx, v: mx, c: d };
  };
  const scored = hexes.map(x => ({ x, ...hsv(x) })).sort((a, b) => b.c - a.c);
  const out: typeof scored = [];
  for (const p of scored) {
    if (out.length >= max) break;
    // near-greys only once the colourful ones are used up, and never two of the same hue, saturation and brightness
    // (sandstone and a sunset share a hue but are different colours)
    if (p.c < 0.12 && out.length >= 2) continue;
    if (out.some(o => Math.min(Math.abs(o.h - p.h), 360 - Math.abs(o.h - p.h)) < 28 && Math.abs(o.s - p.s) < 0.25 && Math.abs(o.v - p.v) < 0.25)) continue;
    out.push(p);
  }
  return (out.length ? out : scored.slice(0, 1)).map(p => p.x);
}
