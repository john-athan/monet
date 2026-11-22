// The painted ground behind a photo in the viewer: the photo seen as an impression, out of focus. Not a copy of any
// painting; a few thousand short strokes in the photo's own colours, shifted the way the impressionists shifted them
// (no black, shadows lean violet and blue, light leans warm, colour a little louder), then blurred by CSS.
// Painted on demand from the photo's medium copy (usually cached from the grid), the same photo always the same way.

const W = 320, H = 200, GW = 24, GH = 16;
const cache = new Map<number, Promise<HTMLCanvasElement | null>>();

/** Deterministic randomness per photo (mulberry32). */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, c = max - min;
  if (!c) return [0, 0, l];
  const s = c / (1 - Math.abs(2 * l - 1));
  const h = (max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4) * 60;
  return [h, s, l];
}
/** Move hue a toward b by k (the short way round). */
const pull = (a: number, b: number, k: number) => { const d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; };

/** The impressionist shift of one colour. Exported for the tests. */
export function impress(r: number, g: number, b: number, jitter = 0): [number, number, number] {
  let [h, s, l] = hsl(r, g, b);
  if (s < .08) h = l < .5 ? 240 : 45;            // greys become coloured: cool in the shade, warm in the light
  if (l < .38) h = pull(h, 255, .35 * (1 - l / .38) + .1); // shadows lean violet blue
  if (l > .62) h = pull(h, 45, .3 * ((l - .62) / .38) + .05); // light leans warm
  s = Math.min(.85, s * 1.3 + .14);
  l = .2 + l * .62;                              // no black, no paper white
  return [(h + jitter + 360) % 360, s, l];
}

async function sample(id: number): Promise<Uint8ClampedArray | null> {
  const img = new Image();
  img.src = `/media/${id}/m`;
  try { await img.decode(); } catch { return null; }
  const c = document.createElement("canvas"); c.width = GW; c.height = GH;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return null;
  x.drawImage(img, 0, 0, GW, GH);
  return x.getImageData(0, 0, GW, GH).data;
}

function paint(id: number, px: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d")!, rnd = rand(id * 2654435761);
  const at = (gx: number, gy: number) => { const i = (Math.max(0, Math.min(GH - 1, gy)) * GW + Math.max(0, Math.min(GW - 1, gx))) * 4; return [px[i], px[i + 1], px[i + 2]] as const; };
  // the underpainting: the mean colour
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < px.length; i += 4) { mr += px[i]; mg += px[i + 1]; mb += px[i + 2]; }
  const n = px.length / 4, [h0, s0, l0] = impress(mr / n, mg / n, mb / n);
  x.fillStyle = `hsl(${h0} ${s0 * 100}% ${l0 * 100}%)`; x.fillRect(0, 0, W, H);
  // strokes: mostly level like water and fields, in the colour of the photo underneath, broken by complementary flecks
  for (let k = 0; k < 1500; k++) {
    const u = rnd(), v = rnd();
    const [r, g, b] = at(Math.floor(u * GW + (rnd() - .5) * 2), Math.floor(v * GH + (rnd() - .5) * 2));
    let [h, s, l] = impress(r, g, b, (rnd() - .5) * 18);
    let a = .5 + rnd() * .3;
    if (rnd() < .06) { h = (h + 150 + rnd() * 60) % 360; a = .35; } // broken colour
    l = Math.max(.12, Math.min(.9, l + (rnd() - .5) * .12));
    x.fillStyle = `hsl(${h} ${s * 100}% ${l * 100}% / ${a})`;
    const len = 5 + rnd() * 13, wid = 2 + rnd() * 4, ang = (rnd() - .5) * .9;
    x.beginPath(); x.ellipse(u * W, v * H, len, wid, ang, 0, Math.PI * 2); x.fill();
  }
  return c;
}

/** The painted ground for a photo, or null when the photo cannot be read. */
export function ground(id: number): Promise<HTMLCanvasElement | null> {
  let p = cache.get(id);
  if (!p) {
    p = sample(id).then(px => (px ? paint(id, px) : null)).catch(() => null);
    cache.set(id, p);
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
  }
  return p;
}
/** Attachment for a <canvas>: draws the ground of `id` into it. When it was painted before, that happens before the
 *  next frame (a microtask), so a view transition already sees it; otherwise it fades in when ready. */
export function groundOf(id: number) {
  return (cv: HTMLCanvasElement) => {
    let live = true;
    cv.width = W; cv.height = H;
    ground(id).then(src => {
      if (!live || !src) return;
      cv.getContext("2d")?.drawImage(src, 0, 0);
      cv.dataset.painted = "";
    });
    return () => { live = false; };
  };
}
