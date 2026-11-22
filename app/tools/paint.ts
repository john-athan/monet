// The brush the painted marks share (tools/mark-ernst.ts, tools/mark-magritte.ts): a seeded random, and touches that
// collect as SVG elements in `out`, in the order they are laid on.
export function brush(seed: number) {
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out: string[] = [];
  const fill = (d: string, c: string, o = 1) => out.push(`<path d="${d}" fill="${c}"${o < 1 ? ` fill-opacity="${r2(o)}"` : ""}/>`);
  const line = (d: string, c: string, w: number, o = 1) => out.push(`<path d="${d}" stroke="${c}" stroke-width="${r2(w)}"${o < 1 ? ` stroke-opacity="${r2(o)}"` : ""}/>`);
  return { rnd, pick, r2, out, fill, line };
}
