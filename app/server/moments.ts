// Moments (docs/together.md, "Moments"): the stretches of a library that belong together, with everything in them.
// A moment is either days away from home (a run of days whose photos were taken more than AWAY_KM from home, at most
// GAP_DAYS apart, with at least MIN_AWAY photos) or a big day at home that the labels can name (a birthday, Christmas).
// Its files are the ones made during it, and the ones made shortly before or after that name one of its places (the
// booking two months ahead, the invoice a week later). Computed on request: one pass over the library.
import { db } from "./db";
import { MONTHS } from "./calc";
import { cityName } from "./places";
import { COLS_DOC_SUMMARY, DOC_TOP, summary as docSummary } from "./docs";
import { SHOWN, SUM_COLS, summary } from "./library";
import type { MomentOut, MomentSummary } from "../shared/types";

export const AWAY_KM = 50;
export const GAP_DAYS = 2;
export const MIN_AWAY = 12;
export const MIN_HOME = 30;
/** share of a day's photos a label needs to name the day */
export const HOME_LABEL = 0.2;
const EVENTS = ["Geburtstag", "Hochzeit", "Taufe", "Weihnachten", "Silvester", "Ostern", "Karneval", "Halloween", "Party", "Konzert", "Festival", "Abschlussfeier", "Grillen"];
const BEFORE_DAYS = 60, AFTER_DAYS = 14;

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const dayMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const addDays = (d: string, n: number) => new Date(dayMs(d) + n * 86400_000).toISOString().slice(0, 10);
const dm = (d: string) => `${+d.slice(8, 10)}. ${MONTHS[+d.slice(5, 7) - 1]}`;
/** "3. Mai 2025", "3. bis 9. Mai 2025", "28. April bis 3. Mai 2025", "30. Dezember 2024 bis 2. Januar 2025" */
export function span(a: string, b: string): string {
  const y = a.slice(0, 4);
  if (a === b) return `${dm(a)} ${y}`;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${+a.slice(8, 10)}. bis ${dm(b)} ${y}`;
  if (y === b.slice(0, 4)) return `${dm(a)} bis ${dm(b)} ${y}`;
  return `${dm(a)} ${y} bis ${dm(b)} ${b.slice(0, 4)}`;
}

type Row = { id: number; day: string; place_id: number | null; name: string | null; lat: number | null; lon: number | null };
type Found = { start: string; end: string; title: string; places: number[]; ids: number[] };

/** The moments of a library, oldest first. Pure apart from the label lookup it is given. */
export function findMoments(rows: Row[], labelsOf: (ids: number[]) => Map<string, number>, nameOf: (id: number, name: string) => string = (_, n) => n): Found[] {
  // home: the place photographed on the most days
  const daysAt = new Map<number, Set<string>>(), where = new Map<number, Row>();
  for (const r of rows) if (r.place_id != null && r.lat != null) { (daysAt.get(r.place_id) ?? daysAt.set(r.place_id, new Set()).get(r.place_id)!).add(r.day); where.set(r.place_id, r); }
  const home = [...daysAt].sort((a, b) => b[1].size - a[1].size)[0]?.[0];
  const homeAt = home != null ? where.get(home)! : null;
  const byDay = new Map<string, Row[]>();
  for (const r of rows) (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(r);
  const days = [...byDay.keys()].sort();
  const away = (d: string) => {
    if (!homeAt) return false;
    const at = new Map<number, number>();
    for (const r of byDay.get(d)!) if (r.place_id != null && r.lat != null) at.set(r.place_id, (at.get(r.place_id) ?? 0) + 1);
    const main = [...at].sort((a, b) => b[1] - a[1])[0]?.[0];
    return main != null && km(where.get(main)! as any, homeAt as any) > AWAY_KM;
  };
  const out: Found[] = [];
  const close = (run: string[]) => {
    const rs = run.flatMap(d => byDay.get(d)!);
    if (rs.length < MIN_AWAY) return;
    const count = new Map<number, number>(), byName = new Map<string, number>();
    for (const r of rs) if (r.place_id != null && r.lat != null && km(r as any, homeAt as any) > AWAY_KM) {
      count.set(r.place_id, (count.get(r.place_id) ?? 0) + 1);
      const n = nameOf(r.place_id, r.name!);
      byName.set(n, (byName.get(n) ?? 0) + 1);
    }
    const top = [...count].sort((a, b) => b[1] - a[1]), names = [...byName].sort((a, b) => b[1] - a[1]);
    out.push({ start: run[0], end: run[run.length - 1], title: names.filter(([, n]) => n >= names[0][1] * 0.3).slice(0, 2).map(([x]) => x).join(" und "), places: top.map(([p]) => p), ids: rs.map(r => r.id) });
  };
  let run: string[] = [];
  const inRun = new Set<string>();
  for (const d of days) {
    if (!away(d)) continue;
    if (run.length && (dayMs(d) - dayMs(run[run.length - 1])) / 86400_000 > GAP_DAYS) { close(run); run = []; }
    run.push(d);
  }
  if (run.length) close(run);
  for (const m of out) for (const d of days) if (d >= m.start && d <= m.end) inRun.add(d);
  // big days at home, when a label names them
  for (const d of days) {
    const rs = byDay.get(d)!;
    if (inRun.has(d) || rs.length < MIN_HOME) continue;
    const labels = labelsOf(rs.map(r => r.id));
    const ev = EVENTS.map(l => [l, labels.get(l) ?? 0] as const).filter(([, n]) => n >= rs.length * HOME_LABEL).sort((a, b) => b[1] - a[1])[0];
    if (!ev) continue;
    out.push({ start: d, end: d, title: ev[0] === "Weihnachten" || ev[0] === "Silvester" ? `${ev[0]} ${d.slice(0, 4)}` : ev[0], places: [...new Set(rs.map(r => r.place_id).filter((p): p is number => p != null))], ids: rs.map(r => r.id) });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

function compute(owner: number): Found[] {
  const rows = db.query(`SELECT i.id, i.day, i.place_id, p.name, p.lat, p.lon FROM item i LEFT JOIN place p ON p.id = i.place_id WHERE i.owner_id = ? AND ${SHOWN} ORDER BY i.taken_at`).all(owner) as Row[];
  return findMoments(rows, ids => {
    const m = new Map<string, number>();
    for (let k = 0; k < ids.length; k += 500) {
      const part = ids.slice(k, k + 500);
      for (const r of db.query(`SELECT label, count(*) AS n FROM item_label WHERE item_id IN (${part.map(() => "?").join(",")}) GROUP BY label`).all(...part) as { label: string; n: number }[]) m.set(r.label, (m.get(r.label) ?? 0) + r.n);
    }
    return m;
  }, cityName);
}

function filesOf(owner: number, m: Found): number[] {
  const near = m.places.length ? db.query(`SELECT d.id FROM doc d WHERE d.owner_id = ? AND d.deleted_at IS NULL AND d.day BETWEEN ? AND ?
    AND EXISTS (SELECT 1 FROM doc_link l WHERE l.doc_id = d.id AND l.kind = 'place' AND l.ref_id IN (${m.places.map(() => "?").join(",")}))`).all(owner, addDays(m.start, -BEFORE_DAYS), addDays(m.end, AFTER_DAYS), ...m.places) as { id: number }[] : [];
  const during = db.query(`SELECT d.id FROM doc d WHERE d.owner_id = ? AND d.deleted_at IS NULL AND d.state != 'failed' AND d.day BETWEEN ? AND ? AND ${DOC_TOP}`).all(owner, m.start, m.end) as { id: number }[];
  return [...new Set([...during, ...near].map(r => r.id))];
}
const cover = (ids: number[]) => ids.length <= 4 ? ids : [0, 1, 2, 3].map(k => ids[Math.floor(((k + 0.5) * ids.length) / 4)]);
const sum = (owner: number, m: Found): MomentSummary => ({
  key: m.start, title: m.title, subtitle: span(m.start, m.end), start: m.start, end: m.end, count: m.ids.length, docs: filesOf(owner, m).length, cover: cover(m.ids),
});

/** Newest first. */
export const moments = (owner: number): MomentSummary[] => compute(owner).reverse().map(m => sum(owner, m));

export function moment(owner: number, key: string): MomentOut | null {
  const m = compute(owner).find(x => x.start === key);
  if (!m) return null;
  const files = filesOf(owner, m);
  const items = (db.query(`SELECT ${SUM_COLS} FROM item i WHERE i.owner_id = ? AND ${SHOWN} AND i.day BETWEEN ? AND ? ORDER BY i.taken_at`).all(owner, m.start, m.end) as any[]).map(summary);
  const docs = files.length ? (db.query(`SELECT ${COLS_DOC_SUMMARY} FROM doc d WHERE d.id IN (${files.join(",")}) ORDER BY coalesce(d.taken_at, d.modified_at)`).all() as any[]).map(r => docSummary(r)) : [];
  return { ...sum(owner, m), count: items.length, docs: docs.length, items, files: docs };
}
