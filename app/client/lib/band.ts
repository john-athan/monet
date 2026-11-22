// The Pinselband: every month as a few dabs in the colours of its photos. The dabs are placed by the same
// deterministic pseudo random function as in the design canvas, so a given library always paints the same picture.
export interface BandMonth { ym: string; n: number; colors: string[] }
export interface Dab { style: string; key: number }

const rnd = (i: number) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };
const add = (ym: string, k: number) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };

/** The months from the oldest to the newest with no gap: an empty month is a gap in the picture. Newest first when `desc`. */
export function fillMonths(months: BandMonth[], desc = false): BandMonth[] {
  if (!months.length) return [];
  const by = new Map(months.map(m => [m.ym, m]));
  const yms = months.map(m => m.ym).sort();
  const out: BandMonth[] = [];
  for (let ym = yms[0]; ym <= yms[yms.length - 1]; ym = add(ym, 1)) out.push(by.get(ym) ?? { ym, n: 0, colors: [] });
  return desc ? out.reverse() : out;
}

/** vertical: the phone's thin band, newest at the top. horizontal: the desktop panorama, oldest at the left. */
export function dabs(filled: BandMonth[], vertical: boolean): Dab[] {
  const N = filled.length, out: Dab[] = [];
  filled.forEach((mo, t) => {
    if (!mo.n || !mo.colors.length) return;
    const [y, m] = mo.ym.split("-").map(Number), i = y * 12 + m;
    // a month drawn wide (a young library, few months) gets as many dabs as its width holds, so the band always
    // reads as painted; a long library keeps 3 to 4 per month as in the design
    const base = vertical ? 3 : 3 + Math.floor(rnd(i + 3) * 2), fill = Math.round((vertical ? 120 : 260) / N);
    const sparse = mo.n < 8, count = sparse ? Math.max(1, Math.round(fill / 3)) : Math.max(base, fill);
    for (let k = 0; k < count; k++) {
      const a = rnd(i * 7 + k), b = rnd(i * 13 + k), c = rnd(i * 17 + k);
      // spread the dabs over the month's own stretch, with a little overlap into the neighbours
      const along = (t + (k + a) / count * 1.2 - 0.1) / N * 100;
      const col = mo.colors[k % mo.colors.length], op = sparse ? 0.45 : vertical ? 0.95 : 0.92;
      const style = vertical
        ? `top:${along.toFixed(2)}%;left:${(b * 5).toFixed(1)}px;width:${(7 + c * 4).toFixed(1)}px;height:${(2 + a * 1.4).toFixed(1)}px;background:${col};opacity:${op};transform:rotate(${((c - 0.5) * 12).toFixed(1)}deg)`
        : `left:${along.toFixed(2)}%;top:${(4 + b * 76).toFixed(1)}%;width:${(11 + c * 12).toFixed(1)}px;height:${(5 + a * 4).toFixed(1)}px;background:${col};opacity:${op};transform:rotate(${((c - 0.5) * 10).toFixed(1)}deg)`;
      out.push({ style, key: t * 1000 + k });
    }
  });
  return out;
}

/** Year labels along the horizontal band: how many months each year spans. */
export function years(filled: BandMonth[]): { y: string; n: number }[] {
  const out: { y: string; n: number }[] = [];
  for (const m of filled) { const y = m.ym.slice(0, 4); if (out.at(-1)?.y === y) out.at(-1)!.n++; else out.push({ y, n: 1 }); }
  return out;
}

/* ---------- the band in the other styles ---------- */
const ratio = (filled: BandMonth[]) => { const max = Math.max(1, ...filled.map(m => m.n)); return (n: number) => Math.log(n + 1) / Math.log(max + 1); };

export interface Trunk { d: string; fill: string; scratch: string; key: number }
/** Ernst: every month a trunk of his forest wall, as tall as the month is full; an empty month is a clearing.
 *  Drawn in a viewBox of 10 units per month along the band and 40 across it (the base at 40): horizontal
 *  `0 0 N*10 40`, vertical `0 0 40 N*10` with the base at the right edge. Trunk colour: the month's colour pressed
 *  into the dark of the wood (`--wood`), so the photos still tint the forest. */
export function forest(filled: BandMonth[], vertical: boolean): Trunk[] {
  const N = filled.length, of = ratio(filled), out: Trunk[] = [];
  const P = (a: number, c: number) => vertical ? `${c.toFixed(1)},${a.toFixed(1)}` : `${a.toFixed(1)},${c.toFixed(1)}`;
  filled.forEach((mo, t) => {
    if (!mo.n || !mo.colors.length) return;
    const [y, m] = mo.ym.split("-").map(Number), i = y * 12 + m;
    const h = 9 + 29 * of(mo.n), a0 = t * 10 - 1.4 + rnd(i + 1) * 0.8, w = 12 + rnd(i + 2) * 1.6, top = 40 - h;
    // the crown torn, not cut: teeth along the top
    const teeth = 4, pts = [P(a0, 41)];
    for (let k = 0; k <= teeth; k++) pts.push(P(a0 + (w * k) / teeth, top + (k % 2 ? -1.2 - rnd(i * 5 + k) * 2.2 : 0.6 + rnd(i * 7 + k) * 1.6)));
    pts.push(P(a0 + w, 41));
    // grattage: two light lines scraped down the trunk
    let scratch = "";
    for (let k = 0; k < 2; k++) { const a = a0 + 2.5 + rnd(i * 11 + k) * (w - 5), c0 = top + 2 + rnd(i * 13 + k) * 6; scratch += `M${P(a, c0)}L${P(a + (rnd(i * 17 + k) - 0.5) * 1.2, 40)}`; }
    out.push({ d: "M" + pts.join("L") + "Z", fill: `color-mix(in oklab, ${mo.colors[0]} 38%, var(--wood))`, scratch, key: t });
  });
  return out;
}

export interface Cloud { style: string; key: number }
/** Magritte: every month a still cumulus in a day sky, as big as the month is full, its shaded underside tinted
 *  with the month's colour. Positioned like the dabs, in percent along the band. */
export function clouds(filled: BandMonth[], vertical: boolean): Cloud[] {
  const N = filled.length, of = ratio(filled), out: Cloud[] = [];
  filled.forEach((mo, t) => {
    if (!mo.n || !mo.colors.length) return;
    const [y, m] = mo.ym.split("-").map(Number), i = y * 12 + m, r = of(mo.n);
    const along = ((t + 0.5) / N) * 100, tint = `color-mix(in oklab, ${mo.colors[0]} 45%, var(--cloud-shade))`;
    const style = vertical
      ? `top:${along.toFixed(2)}%;left:${(1 + rnd(i) * 2).toFixed(1)}px;width:${(5 + r * 5).toFixed(1)}px;height:${(3 + r * 2).toFixed(1)}px;--tint:${tint}`
      : `left:${along.toFixed(2)}%;top:${(18 + rnd(i) * 44).toFixed(1)}%;width:${(9 + r * 20).toFixed(1)}px;height:${(5 + r * 7).toFixed(1)}px;--tint:${tint}`;
    out.push({ style, key: t });
  });
  return out;
}
