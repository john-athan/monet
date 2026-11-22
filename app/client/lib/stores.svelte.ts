// Data that outlives a page: the timeline (so going back lands where you were), the band, the status.
import type { Band, Status, Timeline, TimelineDay } from "../../shared/types";
import { api } from "./api";

/** Counts library switches. A load that started for the library before carries the old count and drops its answer. */
let gen = 0;

export const tl = $state({ days: [] as TimelineDay[], next: null as string | null, loading: false, loaded: false, error: "" });
export async function loadMore(limit = 24): Promise<boolean> {
  if (tl.loading || (tl.loaded && tl.next === null)) return false;
  tl.loading = true; tl.error = "";
  const g = gen;
  try {
    const t = await api<Timeline>(`/api/timeline?limit=${limit}${tl.next ? `&cursor=${encodeURIComponent(tl.next)}` : ""}`);
    if (g !== gen) return false;
    const days = [...tl.days];
    for (const d of t.days) {
      const last = days.at(-1);
      if (last && last.date === d.date) days[days.length - 1] = { ...last, items: [...last.items, ...d.items] }; else days.push(d);
    }
    tl.days = days; tl.next = t.next; tl.loaded = true;
    return true;
  } catch (e: any) { if (g === gen) tl.error = e.message; return false; }
  finally { if (g === gen) tl.loading = false; }
}
/** Fetches the newest days again and puts them in place without emptying the page first: photos arriving during an
 * upload show up where they belong while the rest stays where it is. Days further down than one page are kept. */
export async function refreshTimeline(): Promise<boolean> {
  if (tl.loading) return false;
  const g = gen, n = Math.min(60, Math.max(16, tl.days.length));
  try {
    const t = await api<Timeline>(`/api/timeline?limit=${n}`);
    if (g !== gen || tl.loading) return false;
    const last = t.days.at(-1)?.date, older = t.next && last ? tl.days.filter(d => d.date < last) : [];
    tl.days = [...t.days, ...older];
    if (!older.length) tl.next = t.next; // otherwise the cursor that loaded the older days still points past them
    tl.loaded = true;
    return true;
  } catch { return false; }
}
export function resetTimeline() { tl.days = []; tl.next = null; tl.loaded = false; tl.loading = false; tl.error = ""; }

export const band = $state({ months: [] as Band["months"], loaded: false, current: "", jump: null as null | ((ym: string) => void) });
export async function loadBand() {
  const g = gen;
  try { const m = (await api<Band>("/api/band")).months; if (g === gen) { band.months = m; band.loaded = true; } } catch {}
}

export const status = $state({ s: null as Status | null });
export async function loadStatus() { try { status.s = await api<Status>("/api/status"); } catch {} }

import type { AlbumOut, SeriesOut } from "../../shared/types";
export const lists = $state({ series: [] as SeriesOut[], albums: [] as AlbumOut[], loaded: false });
export async function loadLists() {
  const g = gen;
  const [s, a] = await Promise.all([api<SeriesOut[]>("/api/series").catch(() => []), api<AlbumOut[]>("/api/albums").catch(() => [])]);
  if (g !== gen) return;
  lists.series = s; lists.albums = a; lists.loaded = true;
}

import type { PeopleOut } from "../../shared/types";
export const people = $state({ p: null as PeopleOut | null });
export async function loadPeople(force = false) { if (people.p && !force) return; const g = gen; try { const p = await api<PeopleOut>("/api/people"); if (g === gen) people.p = p; } catch {} }

/** Another library is on screen: forget what belonged to the one before. */
export function resetLibrary() {
  gen++;
  resetTimeline();
  band.months = []; band.loaded = false; band.current = "";
  lists.series = []; lists.albums = []; lists.loaded = false;
  people.p = null;
}
