// Data that outlives a page: the timeline (so going back lands where you were), the band, the status.
import type { Band, Status, Timeline, TimelineDay } from "../../shared/types";
import { tick } from "svelte";
import { api } from "./api";

/** Counts library switches. A load that started for the library before carries the old count and drops its answer. */
let gen = 0;

/** One timeline, paged by day: the photos (`params` empty) or the files of one kind, searched or not ("kind=doc&q=..."). */
export function makeTimeline(params = "") {
  const tl = $state({ days: [] as TimelineDay[], next: null as string | null, loading: false, loaded: false, error: "" });
  const url = (limit: number, cursor: string | null) => `/api/timeline?limit=${limit}${params ? "&" + params : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  async function loadMore(limit = 24): Promise<boolean> {
    if (tl.loading || (tl.loaded && tl.next === null)) return false;
    tl.loading = true; tl.error = "";
    const g = gen;
    try {
      const t = await api<Timeline>(url(limit, tl.next));
      if (g !== gen) return false;
      const days = [...tl.days];
      for (const d of t.days) {
        const last = days.at(-1);
        if (last && last.date === d.date) days[days.length - 1] = { ...last, items: [...last.items, ...d.items], docs: [...last.docs, ...d.docs] }; else days.push(d);
      }
      tl.days = days; tl.next = t.next; tl.loaded = true;
      return true;
    } catch (e: any) { if (g === gen) tl.error = e.message; return false; }
    finally { if (g === gen) tl.loading = false; }
  }
  /** Fetches the newest days again and puts them in place without emptying the page first: photos arriving during an
   * upload show up where they belong while the rest stays where it is. Days further down than one page are kept. */
  async function refresh(): Promise<boolean> {
    if (tl.loading) return false;
    const g = gen, n = Math.min(60, Math.max(16, tl.days.length));
    try {
      const t = await api<Timeline>(url(n, null));
      if (g !== gen || tl.loading) return false;
      const last = t.days.at(-1)?.date, older = t.next && last ? tl.days.filter(d => d.date < last) : [];
      tl.days = [...t.days, ...older];
      if (!older.length) tl.next = t.next; // otherwise the cursor that loaded the older days still points past them
      tl.loaded = true;
      return true;
    } catch { return false; }
  }
  const reset = () => { tl.days = []; tl.next = null; tl.loaded = false; tl.loading = false; tl.error = ""; };
  return { tl, loadMore, refresh, reset };
}
const photos = makeTimeline();
export const tl = photos.tl, loadMore = photos.loadMore, refreshTimeline = photos.refresh, resetTimeline = photos.reset;
/** The timeline of each kind of file, kept between visits like the photos' one; a search is its own and not kept. */
const kinds = new Map<string, ReturnType<typeof makeTimeline>>();
export const kindTimeline = (kind: string) => kinds.get(kind) ?? kinds.set(kind, makeTimeline(`kind=${kind}`)).get(kind)!;

/** The band of the page on screen: `key` says whose ("" the photos, else the query of a file timeline), `jump` is set
 *  while a timeline page is there to jump in (the desktop shows the band then). */
export const band = $state({ months: [] as Band["months"], loaded: false, current: "", key: "", unit: ["Foto", "Fotos"] as [string, string], paint: "var(--water)", jump: null as null | ((ym: string) => void) });
/** `paint`: the colour of months that hold only files (they have no photo colours) */
export async function loadBand(key = "", unit: [string, string] = ["Foto", "Fotos"], paint = "var(--water)") {
  band.unit = unit; band.paint = paint;
  const g = gen;
  if (band.key !== key) { band.key = key; band.months = []; band.loaded = false; band.current = ""; }
  try { const m = (await api<Band>(`/api/band${key ? "?" + key : ""}`)).months; if (g === gen && band.key === key) { band.months = m; band.loaded = true; } } catch {}
}
/** The band's jump for a timeline page: loads older days until the month is there, then scrolls to its newest day.
 *  A newer jump drops the one before. */
export function jumper(o: { days: () => { date: string }[]; more: () => Promise<boolean>; next: () => boolean; scroll: (i: number) => void }) {
  let token = 0;
  return async (ym: string) => {
    const my = ++token;
    const find = () => o.days().findIndex(d => d.date.slice(0, 7) <= ym);
    let i = find();
    while (i < 0 && o.next() && my === token) { if (!await o.more()) await new Promise(r => setTimeout(r, 120)); i = find(); }
    if (my !== token) return;
    await tick();
    o.scroll(i < 0 ? o.days().length - 1 : i);
  };
}
/** A band that is already known (a search brings its own). */
export function setBand(key: string, months: Band["months"], unit: [string, string]) { band.key = key; band.unit = unit; band.paint = "var(--water)"; band.months = months; band.loaded = true; }

export const status = $state({ s: null as Status | null });
export async function loadStatus() { try { status.s = await api<Status>("/api/status"); } catch {} }

import type { AlbumOut, SeriesOut } from "../../shared/types";
export const lists = $state({ series: [] as SeriesOut[], albums: [] as AlbumOut[], moments: [] as MomentSummary[], loaded: false });
export async function loadLists() {
  const g = gen;
  const [s, a, m] = await Promise.all([api<SeriesOut[]>("/api/series").catch(() => []), api<AlbumOut[]>("/api/albums").catch(() => []), api<MomentSummary[]>("/api/moments").catch(() => [])]);
  if (g !== gen) return;
  lists.series = s; lists.albums = a; lists.moments = m; lists.loaded = true;
}

import type { MomentSummary, PeopleOut } from "../../shared/types";
export const people = $state({ p: null as PeopleOut | null });
export async function loadPeople(force = false) { if (people.p && !force) return; const g = gen; try { const p = await api<PeopleOut>("/api/people"); if (g === gen) people.p = p; } catch {} }

/** Another library is on screen: forget what belonged to the one before. */
export function resetLibrary() {
  gen++;
  resetTimeline(); for (const t of kinds.values()) t.reset();
  band.months = []; band.loaded = false; band.current = ""; band.key = "";
  lists.series = []; lists.albums = []; lists.loaded = false;
  people.p = null;
}
