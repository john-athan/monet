// App-wide state with Svelte 5 runes: route, session, light, toast, and whose library is on screen.
import { SvelteSet } from "svelte/reactivity";
import type { HouseholdOut, Member, Theme } from "../../shared/types";
import { api, hooks } from "./api";
import { lightFor, nextMode, parseMode, type Light, type LightMode } from "./light";
import { transition, tileImg, stageMedia, waitTile, type Move } from "./motion";

const WIDE_Q = "(min-width: 900px)";
const readMode = () => { try { return parseMode(localStorage.getItem("monet-licht")); } catch { return "auto" as LightMode; } };

export const app = $state({
  ready: false, loggedIn: false, setupOpen: false,
  // the Mac agent's hidden WebView: a device session that only runs the darkroom, no library UI
  indexer: false,
  path: location.pathname, query: location.search,
  wide: matchMedia(WIDE_Q).matches,
  lightMode: readMode(), clock: new Date().getHours(), dark: matchMedia("(prefers-color-scheme: dark)").matches,
  toast: null as null | { msg: string; ms: number; action?: { label: string; run: () => void } },
});

/** Opened by a setup or invite link (/setup#token): the page stays, even for a browser where someone is signed in. */
export const setupLink = location.pathname === "/setup" && location.hash.length > 1;

// ---- the household: whose library is on screen. Another person's library lives under /bei/<id>/..., so every page,
// link and the back button work there unchanged; the API learns it from the X-Monet-Of header (lib/api.ts).
export const house = $state({ me: 0, members: [] as Member[], loaded: false });
export async function loadHousehold() {
  try { const h = await api<HouseholdOut>("/api/household"); house.me = h.me; house.members = h.members; house.loaded = true; } catch {}
}
const PREFIX = /^\/bei\/(\d+)(?=\/|$)/;
/** The library id in a path (null: your own) and the path inside it. */
export function split(path: string): { of: number | null; rest: string } {
  const m = PREFIX.exec(path);
  return m ? { of: Number(m[1]), rest: path.slice(m[0].length) || "/" } : { of: null, rest: path };
}
/** Whose library is on screen: another person's id, or null for your own (also when the prefix names you). */
export const viewing = (): number | null => { const o = split(app.path).of; return o === house.me && house.me ? null : o; };
/** The current path inside the library, without the /bei/<id> prefix: what the pages route on. */
export const local = () => split(app.path).rest;
export const member = (id: number | null): Member | undefined => house.members.find(m => m.id === (id ?? house.me));
/** Pages that belong to you whoever's library you were in: your settings, your devices, the household. */
const OWN = /^\/(geraete|haushalt|login|setup)(\/|$)/;
/** A library path in the library `of` (default: the one on screen). Paths that already name a library stay. */
export function within(path: string, of: number | null = viewing()): string {
  if (!path.startsWith("/") || PREFIX.test(path) || OWN.test(path) || of == null || of === house.me) return path;
  return `/bei/${of}${path === "/" ? "" : path}`;
}
hooks.of = () => viewing();
/** The style on screen: the one of the person whose library it is. Remembered for the next start, so it does not flash. */
export function theme(): Theme {
  const m = member(viewing());
  if (m) return m.theme;
  try { return (localStorage.getItem("monet-stil") as Theme) || "monet"; } catch { return "monet"; }
}
export function rememberTheme(t: Theme) { try { t === "monet" ? localStorage.removeItem("monet-stil") : localStorage.setItem("monet-stil", t); } catch {} }
/** "Linas", "Max'": the German possessive of a first name. */
export const genitive = (name: string) => /[sßxz]$/i.test(name) ? `${name}’` : `${name}s`;

// ---- light
export const light = (): Light => app.lightMode === "auto" ? lightFor(app.clock, app.dark) : app.lightMode;
export function cycleLight() {
  app.lightMode = nextMode(app.lightMode);
  try { app.lightMode === "auto" ? localStorage.removeItem("monet-licht") : localStorage.setItem("monet-licht", app.lightMode); } catch {}
}
export function installLight() {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => { app.dark = e.matches; });
  setInterval(() => { app.clock = new Date().getHours(); }, 60_000);
  matchMedia(WIDE_Q).addEventListener("change", e => { app.wide = e.matches; });
}

// ---- toast
let timer: ReturnType<typeof setTimeout>;
export function toast(msg: string, opts: { ms?: number; action?: { label: string; run: () => void } } = {}) {
  clearTimeout(timer);
  const ms = opts.ms ?? 3200;
  app.toast = { msg, ms, action: opts.action };
  timer = setTimeout(() => { app.toast = null; }, ms);
}
export const closeToast = () => { clearTimeout(timer); app.toast = null; };

// ---- routing: a path, an optional query, scroll kept per history entry
history.scrollRestoration = "manual";
const fotoId = (p: string) => { const m = /^\/foto\/(\d+)$/.exec(split(p).rest); return m ? Number(m[1]) : null; };
/** The page change as a view transition: a photo opens out of its tile and closes back into it, photos follow each other
 *  in a change of light, sections pass through haze. `y` is where the new page is scrolled to. */
function navigate(to: string, how: Move | undefined, update: () => void, y: number) {
  const a = fotoId(app.path), b = fotoId(to);
  const typing = !!document.activeElement?.closest("input, textarea");
  let kind: Move = how ?? (to === app.path ? "none" : a === null && b !== null ? "open" : a !== null && b === null ? "close" : a !== null && b !== null ? (b > a ? "next" : "prev") : typing ? "none" : "haze");
  // into another person's library (or back): their style washes over the page instead of the haze
  if (kind === "haze" && split(to).of !== split(app.path).of) kind = "light";
  const settle = () => { update(); requestAnimationFrame(() => requestAnimationFrame(() => { if (Math.abs(scrollY - y) > 2) scrollTo(0, y); })); };
  if (kind === "open") transition(kind, settle, { from: () => tileImg(b!), to: stageMedia });
  else if (kind === "close") transition(kind, settle, { from: () => document.querySelector<HTMLElement>("[data-stage]"), to: () => waitTile(a!, y) });
  else transition(kind, settle);
}
/** Goes to a page. A path is read inside the library on screen (see `within`) unless `raw` says it is complete. */
export function go(path: string, replace = false, how?: Move, raw = false) {
  if (!raw) path = within(path);
  const bare = path.split("?")[0], q = path.includes("?") ? "?" + path.split("?")[1] : "";
  if (bare === app.path && q === app.query) return;
  history.replaceState({ ...(history.state ?? {}), scroll: scrollY }, "");
  // inApp: this entry was reached from a page of the app, so a back button may step back to it (see backOr)
  replace ? history.replaceState({ inApp: !!history.state?.inApp }, "", path) : history.pushState({ inApp: true }, "", path);
  // a redirect (replace without a named motion) just happens
  navigate(bare, how ?? (replace ? "none" : undefined), () => { app.path = bare; app.query = q; scrollTo(0, 0); }, 0);
}
/** The back button of a full-screen page: the page before it when that was a page of the app, else `fallback`.
 *  history.length says nothing about where the entries came from (another site, a frame's own navigation). */
export const backOr = (fallback: string) => history.state?.inApp ? history.back() : go(fallback);
/** The query string of the current page without navigating (the search page keeps its text in the URL). */
export function setQuery(q: string) {
  const s = q ? "?" + q : "";
  if (s === location.search) return;
  history.replaceState(history.state, "", location.pathname + s); app.query = s;
}
addEventListener("popstate", e => {
  const y = (e.state as { scroll?: number } | null)?.scroll ?? 0, path = location.pathname, q = location.search;
  // the page may still be filling in: set the scroll now and once more a frame later (navigate does the second)
  navigate(path, undefined, () => { app.path = path; app.query = q; scrollTo(0, y); }, y);
});
hooks.unauthorized = () => { if (app.loggedIn) { app.loggedIn = false; go("/login", true); } };

// ---- selection (photos picked on a page)
export const sel = $state({ on: false, ids: new SvelteSet<number>(), anchor: null as number | null });
export const view = $state({ ids: [] as number[] });
export function selectToggle(id: number) {
  if (sel.ids.has(id)) {
    sel.ids.delete(id);
    // the last one unpicked: the selection is over (the circles and the bar go away)
    if (!sel.ids.size) { selectEnd(); return; }
  } else sel.ids.add(id);
  sel.on = true;
  sel.anchor = id;
}
export function selectRange(id: number) {
  const from = sel.anchor === null ? -1 : view.ids.indexOf(sel.anchor), to = view.ids.indexOf(id);
  if (from < 0 || to < 0) { selectToggle(id); return; }
  const [a, b] = from < to ? [from, to] : [to, from];
  sel.on = true;
  for (let i = a; i <= b; i++) sel.ids.add(view.ids[i]);
}
export function selectEnd() { sel.on = false; sel.ids.clear(); sel.anchor = null; }
