// Motion in Monet's manner. Nothing slides in from the side; things change the way his paintings do:
//   Impression   a picture arrives as its colours and comes into focus (open, upload, a thumbnail loading)
//   Lichtwechsel the light passes over a motif (next and previous photo, the four lights of the day)
//   Teich        what is deleted sinks into the pond with a ripple, the rest drifts together like lilies
//   Tupfer       choosing is a dab of paint; a brush lays the bars and the section marks
//   Mohn         a favourite scatters poppies
// View transitions carry page changes (styles in app.css), the Web Animations API the rest.
// With reduced motion, or without view transitions, every change still happens, only without the motion.
import { flushSync } from "svelte";
import { ground } from "./ground";

export type Move = "open" | "close" | "next" | "prev" | "sink" | "haze" | "light" | "none";
const KINDS = ["open", "close", "next", "prev", "sink", "haze", "light"];

/** Every duration and delay below runs at this pace (1.5 times the first draft). */
const PACE = 1 / 1.5;
const ms = (n: number) => n * PACE;
export const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = document.documentElement;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const inView = (r: DOMRect, m = 0) => r.width > 0 && r.bottom > -m && r.top < innerHeight + m && r.right > -m && r.left < innerWidth + m;

/** Aspect ratio and colour of the photos seen in grids, so the viewer can size the picture and lay its ground
 *  before the details arrive. */
export const seen = new Map<number, { r: number; color: string }>();

// ---- view transitions
let running: ViewTransition | null = null;
let named: HTMLElement[] = [];
function unname() { for (const el of named) el.style.viewTransitionName = ""; named = []; }
function name(el: HTMLElement, n: string) { el.style.viewTransitionName = n; named.push(el); }

type Opts = {
  /** the element in the old state that becomes the new one (open and close) */
  from?: () => HTMLElement | null;
  to?: () => HTMLElement | null | Promise<HTMLElement | null>;
  /** where a light change starts, in px from the top left */
  origin?: { x: number; y: number };
};

/** Run a DOM change as a view transition of the given kind. `update` changes the state; the DOM is flushed after it. */
export function transition(kind: Move, update: () => void, opts: Opts = {}) {
  if (kind === "none" || still() || typeof document.startViewTransition !== "function" || document.hidden) { update(); return; }
  running?.skipTransition();
  unname();
  root.classList.remove(...KINDS.map(k => "vt-" + k));
  const from = opts.from?.() ?? null;
  if (from) name(from, "hero");
  if (opts.origin) { root.style.setProperty("--vt-x", opts.origin.x + "px"); root.style.setProperty("--vt-y", opts.origin.y + "px"); }
  root.classList.add("vt-" + kind);
  const t = document.startViewTransition(async () => {
    unname();
    update(); flushSync();
    if (!from || !opts.to) return;
    const to = await opts.to();
    if (to) name(to, "hero");
  });
  running = t;
  t.ready.catch(() => {});
  t.finished.catch(() => {}).finally(() => {
    if (running !== t) return;
    running = null; unname();
    root.classList.remove("vt-" + kind);
    root.style.removeProperty("--vt-x"); root.style.removeProperty("--vt-y");
  });
}

/** Resolves once no view transition is running (heavy work like decoding an HDR original waits for it). */
export async function afterMotion(): Promise<void> {
  while (running) { const t = running; await t.finished.catch(() => {}); if (running === t) break; }
}

/** The picture of a tile on screen, if there is one. */
export function tileImg(id: number): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-item][data-id="${id}"] img`);
  return el && inView(el.getBoundingClientRect()) ? el : null;
}
/** The picture in the viewer, once it can be painted (it waits a moment for the decode and its painted ground). */
export async function stageMedia(): Promise<HTMLElement | null> {
  const el = document.querySelector<HTMLElement>("[data-stage]"), g = document.querySelector<HTMLElement>("[data-ground]");
  const img = el instanceof HTMLImageElement ? el : el?.querySelector("img");
  const waits: Promise<unknown>[] = [];
  if (img) waits.push(img.decode().catch(() => {}));
  if (g) waits.push(ground(Number(g.dataset.ground)).then(() => sleep(0)));
  await Promise.race([Promise.all(waits), sleep(160)]);
  return el;
}
/** Back to a grid: the tile may need a moment (data, scroll restore, the timeline measuring itself). */
export async function waitTile(id: number, y: number): Promise<HTMLElement | null> {
  for (let i = 0; i < 8; i++) {
    if (Math.abs(scrollY - y) > 2) scrollTo(0, y);
    dispatchEvent(new Event("monet-measure")); flushSync();
    const el = tileImg(id);
    if (el) return el;
    await sleep(45);
  }
  return null;
}

/** Where the sun stands for a light: the header's sun if it is on screen, else east in the morning, west in the evening. */
export function sunOrigin(l: string) {
  const s = document.querySelector("[data-sun]")?.getBoundingClientRect();
  if (s && inView(s)) return { x: s.left + s.width / 2, y: s.top + s.height / 2 };
  const at: Record<string, [number, number]> = { morgen: [0, .3], mittag: [.5, -.1], abend: [1, .3], nacht: [.85, -.1] };
  const [fx, fy] = at[l] ?? [.5, 0];
  return { x: innerWidth * fx, y: innerHeight * fy };
}

// ---- Teich: sinking, ripples, drifting
function ring(r: DOMRect, delay: number) {
  const w = r.width * .95, h = Math.max(10, w * .32);
  const el = document.createElement("span");
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, { position: "fixed", zIndex: "35", pointerEvents: "none", left: `${r.left + r.width / 2 - w / 2}px`, top: `${r.top + r.height * .62 - h / 2}px`, width: `${w}px`, height: `${h}px`, borderRadius: "50%", border: "1.5px solid var(--water)", opacity: "0" });
  document.body.append(el);
  el.animate([{ transform: "scale(.15)", opacity: .9 }, { transform: "scale(1.15)", opacity: 0 }], { duration: ms(900), delay: ms(delay), easing: "cubic-bezier(.2,.6,.3,1)" }).finished.finally(() => el.remove());
}
/** The tiles of these photos sink into the pond. `cancel` puts them back (undo inside the animation); `at` is where. */
export function sink(ids: number[]): { done: Promise<void>; cancel: () => void; at?: { x: number; y: number } } {
  if (still()) return { done: Promise.resolve(), cancel() {} };
  const els = ids.map(id => document.querySelector<HTMLElement>(`[data-item][data-id="${id}"]`)).filter((e): e is HTMLElement => !!e && inView(e.getBoundingClientRect())).slice(0, 48);
  const r0 = els[0]?.getBoundingClientRect(), at = r0 && { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
  const anims = els.map((el, i) => {
    const r = el.getBoundingClientRect(), delay = Math.min(i * 28, 300);
    ring(r, delay + 120); ring(r, delay + 320);
    return el.animate([
      { transform: "none", filter: "none", opacity: 1 },
      { transform: "translateY(2%) scale(.97, .95)", filter: "saturate(.7)", opacity: 1, offset: .3 },
      { transform: "translateY(16%) scale(.72, .5)", filter: "blur(9px) saturate(.15) brightness(.85)", opacity: 0 },
    ], { duration: ms(560), delay: ms(delay), easing: "cubic-bezier(.5,0,.75,.4)", fill: "forwards" });
  });
  return { done: Promise.all(anims.map(a => a.finished)).then(() => {}, () => {}), cancel: () => anims.forEach(a => a.cancel()), at };
}

type Box = { x: number; y: number };
function measure() {
  const tiles = new Map<number, DOMRect>(), boxes = new Map<string, Box>();
  for (const el of document.querySelectorAll<HTMLElement>("[data-item][data-id]")) {
    const r = el.getBoundingClientRect();
    if (inView(r, 300)) tiles.set(Number(el.dataset.id), r);
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-flip]")) { const r = el.getBoundingClientRect(); boxes.set(el.dataset.flip!, { x: r.left, y: r.top }); }
  return { tiles, boxes };
}
/**
 * Change which photos are shown and let the others drift to their new places like lilies on the water, in a wave from
 * where the change happened. Photos in `rise` come up out of the pond (undo).
 */
export function reflow(change: () => void, rise: number[] = [], at?: { x: number; y: number }) {
  if (still()) { change(); return; }
  const before = measure();
  let cx = at?.x ?? innerWidth / 2, cy = at?.y ?? innerHeight / 2;
  change(); flushSync();
  const lifted = new Set(rise);
  const after: [HTMLElement, DOMRect][] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-item][data-id]")) { const r = el.getBoundingClientRect(); if (inView(r, 100)) after.push([el, r]); }
  const first = after.find(([el]) => lifted.has(Number(el.dataset.id)));
  if (first) { cx = first[1].left + first[1].width / 2; cy = first[1].top + first[1].height / 2; }
  const shift = new Map<string, Box>();
  for (const el of document.querySelectorAll<HTMLElement>("[data-flip]")) {
    const was = before.boxes.get(el.dataset.flip!); if (!was) continue;
    const r = el.getBoundingClientRect(), d = { x: was.x - r.left, y: was.y - r.top };
    shift.set(el.dataset.flip!, d);
    if (Math.abs(d.y) > .5 || Math.abs(d.x) > .5) el.animate([{ transform: `translate(${d.x}px, ${d.y}px)` }, { transform: "none" }], { duration: ms(640), easing: "cubic-bezier(.25,.8,.25,1)" });
  }
  let n = 0;
  for (const [el, r] of after) {
    const id = Number(el.dataset.id), was = before.tiles.get(id);
    const dist = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy), delay = Math.min(dist / 5, 220);
    if (lifted.has(id)) {
      ring(r, 60);
      el.animate([
        { transform: "translateY(14%) scale(.75, .55)", filter: "blur(9px) saturate(.2)", opacity: 0 },
        { transform: "translateY(-1%) scale(1.01)", filter: "blur(1px) saturate(1.2)", opacity: 1, offset: .65 },
        { transform: "none", filter: "none", opacity: 1 },
      ], { duration: ms(680), delay: ms(Math.min(n++ * 30, 300)), easing: "cubic-bezier(.2,.7,.3,1)", fill: "backwards" });
      continue;
    }
    if (!was) continue;
    const box = (el.closest("[data-flip]") as HTMLElement | null)?.dataset.flip, b = (box && shift.get(box)) || { x: 0, y: 0 };
    const dx = was.left - r.left - b.x, dy = was.top - r.top - b.y, sx = was.width / r.width, sy = was.height / r.height;
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5 && Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01) continue;
    el.style.transformOrigin = "0 0";
    el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: "none" }], { duration: ms(620), delay: ms(delay), easing: "cubic-bezier(.25,.8,.25,1)", fill: "backwards" })
      .finished.finally(() => { el.style.transformOrigin = ""; }).catch(() => {});
  }
}

// ---- Impression: a picture arrives as its colours and comes into focus
const IMPRESSION: Keyframe[] = [
  { opacity: 0, filter: "blur(14px) saturate(1.8) contrast(.85)", transform: "scale(1.04)" },
  { opacity: 1, filter: "blur(4px) saturate(1.3)", offset: .45 },
  { opacity: 1, filter: "none", transform: "none" },
];
/** Tiles on screen whose photo is new (after an upload) paint themselves in. */
export function arrive(isNew: (id: number) => boolean) {
  if (still()) return;
  let n = 0;
  for (const el of document.querySelectorAll<HTMLElement>("[data-item][data-id]")) {
    if (n >= 36 || !isNew(Number(el.dataset.id)) || !inView(el.getBoundingClientRect())) continue;
    el.querySelector("img")?.animate(IMPRESSION, { duration: ms(900), delay: ms(n++ * 60), easing: "cubic-bezier(.3,.6,.25,1)", fill: "backwards" });
  }
}
export const visibleIds = () => [...document.querySelectorAll<HTMLElement>("[data-item][data-id]")].filter(el => inView(el.getBoundingClientRect())).map(el => Number(el.dataset.id));
/** Attachment for an <img>: a picture that was not there yet comes out of its colour field once it loads. */
export function settle(img: HTMLImageElement) {
  if (img.complete || still()) return;
  const on = () => { img.animate([{ opacity: 0, filter: "blur(10px) saturate(1.6)" }, { opacity: 1, filter: "none" }], { duration: ms(480), easing: "cubic-bezier(.3,.6,.3,1)" }); };
  img.addEventListener("load", on, { once: true });
  return () => img.removeEventListener("load", on);
}

// ---- Tupfer and Mohn: dabs of paint
function dab(x: number, y: number, size: number, color: string, z = 60) {
  const el = document.createElement("span");
  el.setAttribute("aria-hidden", "true");
  const r = () => 38 + Math.round(Math.random() * 24);
  Object.assign(el.style, { position: "fixed", zIndex: String(z), pointerEvents: "none", left: `${x - size / 2}px`, top: `${y - size * .35}px`, width: `${size}px`, height: `${size * .7}px`, background: color, borderRadius: `${r()}% ${r()}% ${r()}% ${r()}% / ${r()}% ${r()}% ${r()}% ${r()}%` });
  document.body.append(el);
  return el;
}
/** A favourite: the heart beats once and poppies scatter around it, with one green stroke of the field. */
export function bloom(btn: Element) {
  if (still()) return;
  const r = btn.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  btn.querySelector("svg")?.animate([{ transform: "scale(1)" }, { transform: "scale(1.32)", offset: .3 }, { transform: "scale(.92)", offset: .65 }, { transform: "scale(1)" }], { duration: ms(560), easing: "ease-out" });
  const colours = ["var(--sun)", "var(--atelier)", "var(--sun)", "var(--sun-ink)", "var(--atelier)", "var(--sun)", "var(--garten)"];
  colours.forEach((c, i) => {
    const a = (i / colours.length) * Math.PI * 2 + Math.random() * .6, d = 24 + Math.random() * 16, s = c === "var(--garten)" ? 5 : 7 + Math.random() * 6;
    const dx = Math.cos(a) * d, dy = Math.sin(a) * d, rot = Math.round(Math.random() * 180);
    const el = dab(cx, cy, s, c);
    el.animate([
      { transform: `translate(0, 0) rotate(${rot}deg) scale(.2)`, opacity: 1 },
      { transform: `translate(${dx * .85}px, ${dy * .85}px) rotate(${rot + 40}deg) scale(1.15)`, opacity: .95, offset: .5 },
      { transform: `translate(${dx}px, ${dy + 7}px) rotate(${rot + 70}deg) scale(.5)`, opacity: 0 },
    ], { duration: ms(720 + Math.random() * 220), easing: "cubic-bezier(.2,.7,.3,1)" }).finished.finally(() => el.remove());
  });
}
/** A soft splash of colour behind an element (where something arrived). */
function splash(target: Element) {
  const r = target.getBoundingClientRect();
  const el = dab(r.left + r.width / 2, r.top + r.height / 2, Math.max(r.height, 28) * 1.4, "var(--atelier)", 34);
  el.animate([{ transform: "scale(.3) rotate(-20deg)", opacity: .55 }, { transform: "scale(1.5) rotate(10deg)", opacity: 0 }], { duration: ms(620), easing: "cubic-bezier(.2,.7,.3,1)" }).finished.finally(() => el.remove());
  (target as HTMLElement).animate([{ transform: "none" }, { transform: "translateY(-2px) scale(1.06)", offset: .4 }, { transform: "none" }], { duration: ms(420), easing: "ease-out" });
}

// ---- moving into an album: the pictures fly in an arc to the album, like a brush carrying paint
export type Flight = { src: string; rect: DOMRect }[];
export function takeoff(ids: number[]): Flight {
  const out: Flight = [];
  for (const id of ids) {
    const img = tileImg(id) as HTMLImageElement | null;
    if (img?.currentSrc) out.push({ src: img.currentSrc, rect: img.getBoundingClientRect() });
    if (out.length >= 8) break;
  }
  return out;
}
export function fly(f: Flight, albumId: number) {
  if (still() || !f.length) return;
  const visible = (sel: string) => [...document.querySelectorAll(sel)].find(e => inView(e.getBoundingClientRect()));
  const target = visible(`a[href="/alben/${albumId}"]`) ?? visible(`a[href="/alben"]`);
  if (!target) return;
  const t = target.getBoundingClientRect(), tx = t.left + Math.min(t.width / 2, 24), ty = t.top + t.height / 2;
  f.forEach(({ src, rect }, i) => {
    const el = document.createElement("img");
    el.src = src; el.alt = ""; el.setAttribute("aria-hidden", "true");
    const s = Math.min(rect.width, rect.height, 120);
    Object.assign(el.style, { position: "fixed", zIndex: "60", pointerEvents: "none", left: `${rect.left + rect.width / 2 - s / 2}px`, top: `${rect.top + rect.height / 2 - s / 2}px`, width: `${s}px`, height: `${s}px`, objectFit: "cover", borderRadius: "6px", boxShadow: "var(--shadow)" });
    document.body.append(el);
    const dx = tx - (rect.left + rect.width / 2), dy = ty - (rect.top + rect.height / 2), lift = Math.min(160, 60 + Math.abs(dx) * .25);
    const a = el.animate([
      { transform: "translate(0, 0) scale(1) rotate(0)", opacity: 1 },
      { transform: `translate(${dx * .45}px, ${dy * .45 - lift}px) scale(.6) rotate(${i % 2 ? 7 : -7}deg)`, opacity: 1, offset: .45 },
      { transform: `translate(${dx}px, ${dy}px) scale(.12) rotate(0)`, opacity: .3 },
    ], { duration: ms(760), delay: ms(i * 55), easing: "cubic-bezier(.45,.05,.35,1)", fill: "backwards" });
    a.finished.finally(() => { el.remove(); if (i === f.length - 1) splash(target); });
  });
}

// ---- Svelte transitions
/** A sheet settles like a lily pad on the water: up, a little past, and back. On the desktop it also sways once. */
export function lily(_: Element, { wide = false } = {}) {
  if (still()) return { duration: 0 };
  return {
    duration: ms(640),
    css: (t: number) => {
      const p = 1 - Math.exp(-8 * t) * Math.cos(7 * t), sway = Math.exp(-6 * t) * Math.sin(9 * t) * -.9;
      return wide
        ? `transform: translate(-50%, calc(-50% + ${(1 - p) * 48}px)) rotate(${sway}deg) scale(${.96 + .04 * p}); opacity: ${Math.min(1, t * 3)}`
        : `transform: translateY(${(1 - p) * 100}%)`;
    },
  };
}
/** Leaving, the sheet sinks back. */
export function lilyOut(_: Element, { wide = false } = {}) {
  if (still()) return { duration: 0 };
  return {
    duration: ms(240),
    css: (t: number, u: number) => wide
      ? `transform: translate(-50%, calc(-50% + ${u * u * 28}px)) scale(${1 - u * .03}); opacity: ${t}`
      : `transform: translateY(${u * u * 100}%)`,
  };
}
/** A bar or toast laid on with one stroke of the brush, from the left, or from the middle outwards. */
export function stroke(_: Element, { from = "left", duration = 420 }: { from?: "left" | "middle"; duration?: number } = {}) {
  if (still()) return { duration: 0 };
  return {
    duration: ms(duration),
    css: (t: number, u: number) => {
      const e = 1 - Math.pow(1 - t, 3);
      return from === "left" ? `clip-path: inset(0 ${(1 - e) * 100}% 0 0 round 28px); opacity: ${Math.min(1, t * 4)}` : `clip-path: inset(0 ${(1 - e) * 50}% 0 ${(1 - e) * 50}% round 24px); opacity: ${Math.min(1, t * 4)}`;
    },
  };
}
/** The scrim: the air thickens. */
export function veil(_: Element, { duration = 260 } = {}) {
  if (still()) return { duration: 0 };
  return { duration: ms(duration), css: (t: number) => `opacity: ${t}` };
}
