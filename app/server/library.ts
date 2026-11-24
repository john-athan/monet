// Read models and small writes for the library: timeline, band, item detail, favourites, trash, series, places, albums.
// Everything is scoped by owner_id. Nothing here knows about HTTP.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db";
import { dayTitle, daySign, monthPalette } from "./calc";
import { COLS_DOC_SUMMARY, DOC_TOP, ftsMatch, purgeDocs, summary as docSummary, transcriptRow } from "./docs";
import { ORIGINALS, rankBurst, thumbPath } from "./ingest";
import { countryName } from "./places";
import { HttpError, json, now, todayBerlin } from "./util";
import type { DocSummary, MapOut, AlbumDetail, AlbumOut, Band, ItemDetail, ItemSummary, PlaceOut, SeriesOut, ThingOut, Timeline, TimelineDay } from "../shared/types";
import { chroma, hexToRgb } from "./calc";
import { DATA } from "./ingest";
import { seasonOf } from "./parse";

/** Columns every summary needs. burst_n is the number of live members, only meaningful for the shown (rank 1) item. */
export const SUM_COLS = `i.id, i.kind, i.width, i.height, i.color, i.taken_at, i.duration_ms, i.favorite, i.burst_id, i.burst_rank, i.day, i.colors, i.place_id,
  (SELECT count(*) FROM item b WHERE b.burst_id = i.burst_id AND b.deleted_at IS NULL) AS burst_n`;
/** What the timeline, search and albums show: finished, not deleted, one item per burst. */
export const SHOWN = `i.thumbs_ok = 1 AND i.deleted_at IS NULL AND (i.burst_rank IS NULL OR i.burst_rank = 1)`;

export function summary(r: any): ItemSummary {
  const s: ItemSummary = { id: r.id, kind: r.kind, w: r.width ?? 0, h: r.height ?? 0, color: r.color ?? "#808080", takenAt: r.taken_at, favorite: !!r.favorite };
  if (r.kind === "video" && r.duration_ms != null) s.durationMs = r.duration_ms;
  if (r.burst_id != null && r.burst_rank === 1 && r.burst_n > 1) s.burst = { count: r.burst_n };
  return s;
}
export function summaryById(owner: number, id: number): ItemSummary | null {
  const r = db.query(`SELECT ${SUM_COLS} FROM item i WHERE i.id = ? AND i.owner_id = ?`).get(id, owner);
  return r ? summary(r) : null;
}
export function summariesByIds(owner: number, ids: number[]): ItemSummary[] {
  if (!ids.length) return [];
  const rows = db.query(`SELECT ${SUM_COLS} FROM item i WHERE i.owner_id = ? AND i.id IN (${ids.map(() => "?").join(",")})`).all(owner, ...ids) as any[];
  const by = new Map(rows.map(r => [r.id, summary(r)]));
  return ids.flatMap(id => by.get(id) ?? []);
}

/* ---------- timeline ---------- */
export type TimelineQuery = { cursor?: string | null; from?: string | null; limit?: number; favorite?: boolean; album?: number | null; /** false: photos and videos only */ files?: boolean;
  /** the files of one kind and no photos: the timeline of Dokumente, Audio, Bücher (docs/together.md) */ kind?: string | null; /** with kind: only files whose title or text match */ q?: string | null };
const FILE_KINDS = ["doc", "sheet", "slides", "book", "audio", "other"];
/** The doc filter of a timeline or band of one kind, searched or not. */
function kindWhere(q: TimelineQuery, where: string[], args: any[]) {
  if (!q.kind) return;
  if (!FILE_KINDS.includes(q.kind)) throw new HttpError(400, "Diese Art von Datei gibt es nicht.");
  where.push("d.kind = ?"); args.push(q.kind);
  const m = ftsMatch(String(q.q ?? "").slice(0, 200));
  // a search finds a version inside a stack too, so the stack filter only holds without one
  if (m) { where[where.indexOf(DOC_TOP)] = "1"; where.push("d.id IN (SELECT rowid FROM doc_fts WHERE doc_fts MATCH ?)"); args.push(m); }
}
/** Days newest first. `limit` counts days. `next` is the last day returned when more follow, to pass back as `cursor`. */
export function timeline(owner: number, q: TimelineQuery = {}): Timeline {
  const limit = Math.max(1, Math.min(60, Math.floor(q.limit ?? 24)));
  const where = [`i.owner_id = ?`, SHOWN], args: any[] = [owner];
  if (q.favorite) where.push("i.favorite = 1");
  if (q.album) { where.push("i.id IN (SELECT item_id FROM album_item WHERE album_id = ?)"); args.push(q.album); }
  // from=YYYY-MM starts at the newest day on or before the end of that month (day strings compare as text, and no month has a day 32)
  if (q.from && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.from)) { where.push("i.day <= ?"); args.push(q.from + "-31"); }
  if (q.cursor && /^\d{4}-\d{2}-\d{2}$/.test(q.cursor)) { where.push("i.day < ?"); args.push(q.cursor); }
  const w = where.join(" AND ");
  // files stand on the days they were made (docs/together.md); favourites and albums hold photos only
  const files = q.files !== false && !q.favorite && !q.album;
  const dw = [`d.owner_id = ?`, "d.deleted_at IS NULL", "d.state != 'failed'", "d.day IS NOT NULL", DOC_TOP], dargs: any[] = [owner];
  kindWhere(q, dw, dargs);
  if (q.from && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.from)) { dw.push("d.day <= ?"); dargs.push(q.from + "-31"); }
  if (q.cursor && /^\d{4}-\d{2}-\d{2}$/.test(q.cursor)) { dw.push("d.day < ?"); dargs.push(q.cursor); }
  const dws = dw.join(" AND ");
  const days = (q.kind
    ? db.query(`SELECT DISTINCT d.day FROM doc d WHERE ${dws} ORDER BY d.day DESC LIMIT ?`).all(...dargs, limit + 1)
    : files
    ? db.query(`SELECT day FROM (SELECT DISTINCT i.day AS day FROM item i WHERE ${w} UNION SELECT DISTINCT d.day FROM doc d WHERE ${dws}) ORDER BY day DESC LIMIT ?`).all(...args, ...dargs, limit + 1)
    : db.query(`SELECT DISTINCT i.day FROM item i WHERE ${w} ORDER BY i.day DESC LIMIT ?`).all(...args, limit + 1) as { day: string }[]).map((r: any) => r.day as string);
  const more = days.length > limit;
  const shown = days.slice(0, limit);
  if (!shown.length) return { days: [], next: null };
  const rows = q.kind ? [] : db.query(`SELECT ${SUM_COLS}, p.name AS place_name FROM item i LEFT JOIN place p ON p.id = i.place_id
    WHERE ${w} AND i.day BETWEEN ? AND ? ORDER BY i.taken_at DESC, i.id DESC`).all(...args, shown[shown.length - 1], shown[0]) as any[];
  const docsByDay = new Map<string, DocSummary[]>();
  if (files || q.kind) for (const r of db.query(`SELECT ${COLS_DOC_SUMMARY}, d.day FROM doc d WHERE ${dws} AND d.day BETWEEN ? AND ? ORDER BY d.taken_at DESC, d.id DESC`).all(...dargs, shown[shown.length - 1], shown[0]) as any[])
    (docsByDay.get(r.day) ?? docsByDay.set(r.day, []).get(r.day)!).push(docSummary(r));
  return { days: daysOf(shown, rows, docsByDay), next: more ? shown[shown.length - 1] : null };
}
/** The given dates, newest first, as timeline days: item rows (SUM_COLS, day, place_name) and files grouped onto them.
 *  `item` makes the summary (search marks photos of another library). */
export function daysOf(dates: string[], rows: any[], docsByDay: Map<string, DocSummary[]>, item: (r: any) => ItemSummary = summary): TimelineDay[] {
  const today = todayBerlin();
  const byDay = new Map<string, any[]>();
  for (const r of rows) (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(r);
  return dates.map(date => {
    const rs = byDay.get(date) ?? [];
    const places = new Map<string, number>();
    for (const r of rs) if (r.place_name) places.set(r.place_name, (places.get(r.place_name) ?? 0) + 1);
    const place = [...places.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const sign = daySign(rs.flatMap(r => json<string[]>(r.colors, [])));
    return { date, title: dayTitle(date, today), place, ...sign, items: rs.map(item), docs: docsByDay.get(date) ?? [] };
  });
}

/** One tile per month: the mean colours of the first, middle and last third of the month, for the scrubber strip. */
export function band(owner: number, q: Pick<TimelineQuery, "kind" | "q"> = {}): Band {
  const rows = q.kind ? [] : db.query(`SELECT substr(i.day, 1, 7) AS ym, i.color, i.colors FROM item i WHERE i.owner_id = ? AND ${SHOWN}`).all(owner) as { ym: string; color: string | null; colors: string | null }[];
  const dw = ["d.owner_id = ?", "d.deleted_at IS NULL", "d.state != 'failed'", "d.day IS NOT NULL", DOC_TOP], dargs: any[] = [owner];
  kindWhere(q, dw, dargs);
  return bandOf(rows, db.query(`SELECT substr(d.day, 1, 7) AS ym, count(*) AS n FROM doc d WHERE ${dw.join(" AND ")} GROUP BY ym`).all(...dargs) as { ym: string; n: number }[]);
}
/** The band from photo rows (their month and colours) and file counts per month. */
export function bandOf(rows: { ym: string; color: string | null; colors: string | null }[], docMonths: { ym: string; n: number }[]): Band {
  const by = new Map<string, { n: number; pool: string[] }>();
  for (const r of rows) {
    const m = by.get(r.ym) ?? by.set(r.ym, { n: 0, pool: [] }).get(r.ym)!;
    m.n++;
    let cs: unknown = null; try { cs = r.colors ? JSON.parse(r.colors) : null; } catch {}
    if (Array.isArray(cs)) for (const c of cs) { if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) m.pool.push(c); }
    else if (r.color) m.pool.push(r.color);
  }
  for (const r of docMonths)
    (by.get(r.ym) ?? by.set(r.ym, { n: 0, pool: [] }).get(r.ym)!).n += r.n;
  const months = [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ym, m]) => ({ ym, n: m.n, colors: m.pool.length ? monthPalette(m.pool) : [] }));
  return { months };
}

/* ---------- detail and small writes ---------- */
export function detail(owner: number, id: number): ItemDetail | null {
  const r = db.query(`SELECT i.*, p.name AS p_name, p.admin1 AS p_admin1, p.country AS p_country FROM item i LEFT JOIN place p ON p.id = i.place_id WHERE i.id = ? AND i.owner_id = ?`).get(id, owner) as any;
  if (!r) return null;
  const s = summary({ ...r, burst_n: 0 }); delete s.burst;
  const faces = (db.query(`SELECT f.id, f.x, f.y, f.w, f.h, f.person_id, p.name FROM face f LEFT JOIN person p ON p.id = f.person_id WHERE f.item_id = ? ORDER BY f.x`).all(id) as any[])
    .map(f => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h, personId: f.person_id, name: f.name }));
  const burst = r.burst_id == null ? [] : (db.query(`SELECT id FROM item WHERE burst_id = ? AND deleted_at IS NULL ORDER BY burst_rank, id`).all(r.burst_id) as { id: number }[]);
  return {
    ...s, owner: r.owner_id, sha256: r.sha256, mime: r.mime, bytes: r.bytes, origName: r.orig_name, source: r.source, takenSrc: r.taken_src, tzMin: r.tz_min, uploadedAt: r.uploaded_at,
    exif: { camera: r.camera, exposure: r.exposure, fnumber: r.fnumber, iso: r.iso, focal: r.focal, lat: r.lat, lon: r.lon },
    place: r.p_name ? { name: r.p_name, admin1: r.p_admin1, country: countryName(r.p_country) } : null,
    faces, burst: burst.length > 1 ? burst : [],
    labels: db.query("SELECT label, score FROM item_label WHERE item_id = ? ORDER BY score DESC").all(id) as { label: string; score: number }[],
    ocr: r.ocr_text, transcript: transcriptRow("item", id), backup: { original: true, secondCopyAt: r.second_copy_at }, deletedAt: r.deleted_at,
  };
}

export function setFavorite(owner: number, id: number, fav: boolean) {
  const r = db.query("UPDATE item SET favorite = ? WHERE id = ? AND owner_id = ?").run(fav ? 1 : 0, id, owner);
  if (!r.changes) throw new HttpError(404, "Das gibt es nicht (mehr).");
}
export function softDelete(owner: number, id: number, restore = false) {
  const it = db.query("SELECT burst_id FROM item WHERE id = ? AND owner_id = ?").get(id, owner) as { burst_id: number | null } | null;
  if (!it) throw new HttpError(404, "Das gibt es nicht (mehr).");
  db.query("UPDATE item SET deleted_at = ? WHERE id = ?").run(restore ? null : now(), id);
  rankBurst(it.burst_id); // the next best take of a burst steps up
}
export function trash(owner: number): ItemSummary[] {
  return (db.query(`SELECT ${SUM_COLS} FROM item i WHERE i.owner_id = ? AND i.deleted_at IS NOT NULL ORDER BY i.deleted_at DESC`).all(owner) as any[]).map(summary);
}
/** Items deleted more than 30 days ago go for good: original, thumbnails, row. */
export function purge(olderThanMs = 30 * 86400_000) {
  const rows = db.query("SELECT id, sha256, orig_path, burst_id FROM item WHERE deleted_at IS NOT NULL AND deleted_at < ?").all(now() - olderThanMs) as any[];
  for (const r of rows) {
    rmSync(join(ORIGINALS, r.orig_path), { force: true });
    for (const s of ["s", "m", "l"] as const) rmSync(thumbPath(r.sha256, s), { force: true });
    for (const f of db.query("SELECT id FROM face WHERE item_id = ?").all(r.id) as { id: number }[]) rmSync(join(DATA, "faces", `${f.id}.webp`), { force: true });
    db.query("DELETE FROM item_fts WHERE rowid = ?").run(r.id);
    db.query("DELETE FROM transcript WHERE ref = 'item' AND ref_id = ?").run(r.id);
    db.query("DELETE FROM item WHERE id = ?").run(r.id);
  }
  purgeDocs(olderThanMs); // files too, with what was made from them
  return rows.length;
}

/* ---------- series: the same place in the same season, in at least 3 different years ---------- */
const SEASONS = [["winter", "Winter"], ["fruehling", "Frühling"], ["sommer", "Sommer"], ["herbst", "Herbst"]] as const;
export function series(owner: number): SeriesOut[] {
  const rows = db.query(`SELECT i.id, i.day, i.colors, i.color, i.place_id, p.name FROM item i JOIN place p ON p.id = i.place_id
    WHERE i.owner_id = ? AND ${SHOWN} ORDER BY i.day, i.id`).all(owner) as any[];
  const groups = new Map<string, { name: string; place: number; season: number; byYear: Map<number, any[]> }>();
  for (const r of rows) {
    const y = +r.day.slice(0, 4), m = +r.day.slice(5, 7), s = seasonOf(r.day);
    const year = s === 0 && m === 12 ? y + 1 : y; // late December belongs to the winter that ends in the next year
    const k = `${r.place_id}-${SEASONS[s][0]}`;
    const g = groups.get(k) ?? groups.set(k, { name: r.name, place: r.place_id, season: s, byYear: new Map() }).get(k)!;
    (g.byYear.get(year) ?? g.byYear.set(year, []).get(year)!).push(r);
  }
  const out: SeriesOut[] = [];
  for (const [key, g] of groups) {
    if (g.byYear.size < 3) continue;
    const years = [...g.byYear.keys()].sort((a, b) => a - b);
    // the picture of each year: the most colourful one (chroma of its strongest colour), ties to the lowest id
    const pick = (list: any[]) => list.map(r => ({ id: r.id, c: Math.max(0, ...json<string[]>(r.colors, [r.color ?? "#808080"]).map(h => chroma(hexToRgb(h)))) }))
      .sort((a, b) => b.c - a.c || a.id - b.id)[0].id;
    out.push({ key, title: `${g.name} im ${SEASONS[g.season][1]}`, subtitle: `${years[0]} bis ${years[years.length - 1]}`, items: years.map(year => ({ id: pick(g.byYear.get(year)!), year })) });
  }
  return out.sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title, "de"));
}

/* ---------- places ---------- */
/** Every label on the owner's shown photos, most common first. The cover is the photo with the label's highest share. */
export function things(owner: number): ThingOut[] {
  const rows = db.query(`SELECT l.label, count(*) AS n, (SELECT j.id FROM item_label k JOIN item j ON j.id = k.item_id WHERE k.label = l.label AND j.owner_id = ? AND ${SHOWN.replaceAll("i.", "j.")} ORDER BY k.score DESC, j.taken_at DESC LIMIT 1) AS item
    FROM item_label l JOIN item i ON i.id = l.item_id WHERE i.owner_id = ? AND ${SHOWN} GROUP BY l.label ORDER BY n DESC, l.label`).all(owner, owner) as { label: string; n: number; item: number }[];
  // files carry labels too (what their pages show, docs/together.md): a label only files have still gets its card
  const files = db.query(`SELECT l.label, count(*) AS n, (SELECT k.doc_id FROM doc_label k JOIN doc e ON e.id = k.doc_id WHERE k.label = l.label AND e.owner_id = ? AND e.deleted_at IS NULL ORDER BY k.score DESC LIMIT 1) AS doc
    FROM doc_label l JOIN doc d ON d.id = l.doc_id WHERE d.owner_id = ? AND d.deleted_at IS NULL GROUP BY l.label`).all(owner, owner) as { label: string; n: number; doc: number }[];
  const byLabel = new Map(files.map(f => [f.label, f]));
  const out: ThingOut[] = rows.map(r => ({ label: r.label, count: r.n, item: r.item, docs: byLabel.get(r.label)?.n ?? 0 }));
  for (const f of files) if (!rows.some(r => r.label === f.label)) out.push({ label: f.label, count: 0, item: null, docs: f.n, doc: f.doc });
  return out.sort((a, b) => b.count + b.docs - (a.count + a.docs) || a.label.localeCompare(b.label));
}

export function places(owner: number): PlaceOut[] {
  const rows = db.query(`SELECT p.id, p.name, p.country, p.lat, p.lon, count(*) AS n, (SELECT j.id FROM item j WHERE j.place_id = p.id AND j.owner_id = ? AND ${SHOWN.replaceAll("i.", "j.")} ORDER BY j.taken_at DESC LIMIT 1) AS item
    FROM item i JOIN place p ON p.id = i.place_id WHERE i.owner_id = ? AND ${SHOWN} GROUP BY p.id ORDER BY n DESC, p.name`).all(owner, owner) as any[];
  // the colours of a place: the palette of everything shot there (one pass over the items, not one query per place)
  const pool = new Map<number, string[]>();
  for (const r of db.query(`SELECT i.place_id, i.color, i.colors FROM item i WHERE i.owner_id = ? AND i.place_id IS NOT NULL AND ${SHOWN}`).all(owner) as any[]) {
    const l = pool.get(r.place_id) ?? pool.set(r.place_id, []).get(r.place_id)!;
    const cs = json<unknown>(r.colors, null);
    if (Array.isArray(cs)) { for (const c of cs) if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) l.push(c); }
    else if (r.color && /^#[0-9a-f]{6}$/i.test(r.color)) l.push(r.color);
  }
  return rows.map(r => ({ id: r.id, name: r.name, country: countryName(r.country), count: r.n, item: r.item, lat: r.lat, lon: r.lon, colors: pool.get(r.id)?.length ? monthPalette(pool.get(r.id)!, 4) : [] }));
}

/** Every geotagged photo that is shown, as parallel arrays (compact for tens of thousands). Stacks count once. */
export function map(owner: number): MapOut {
  const rows = db.query(`SELECT i.id, i.lat, i.lon, i.color, i.colors FROM item i WHERE i.owner_id = ? AND i.lat IS NOT NULL AND i.lon IS NOT NULL AND ${SHOWN} ORDER BY i.id`).all(owner) as any[];
  const out: MapOut = { ids: [], lat: [], lon: [], color: [] };
  // a photo's dab takes its most saturated colour, not the grey mean
  const hex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
  for (const r of rows) {
    const cs = json<unknown>(r.colors, null), list = Array.isArray(cs) ? cs.filter(hex) : [];
    if (list.length) r.color = monthPalette(list, 1)[0] ?? r.color;
    out.ids.push(r.id); out.lat.push(Math.round(r.lat * 1e5) / 1e5); out.lon.push(Math.round(r.lon * 1e5) / 1e5); out.color.push(r.color ?? "#808080");
  }
  return out;
}

/** The summaries behind a map cluster, in the order asked for: only what is shown, only the owner's, at most 2000. */
export function mapItems(owner: number, ids: unknown): ItemSummary[] {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, 2000);
  if (!list.length) return [];
  const rows = db.query(`SELECT ${SUM_COLS} FROM item i WHERE i.owner_id = ? AND ${SHOWN} AND i.id IN (${list.map(() => "?").join(",")})`).all(owner, ...list) as any[];
  const by = new Map(rows.map(r => [r.id, summary(r)]));
  return list.flatMap(id => by.get(id) ?? []);
}

/* ---------- albums ---------- */
export function albums(owner: number): AlbumOut[] {
  return (db.query(`SELECT a.id, a.name, a.cover_item_id,
      (SELECT count(*) FROM album_item ai JOIN item i ON i.id = ai.item_id WHERE ai.album_id = a.id AND i.deleted_at IS NULL AND (i.burst_rank IS NULL OR i.burst_rank = 1)) AS n
    FROM album a WHERE a.owner_id = ? ORDER BY a.created_at DESC, a.id DESC`).all(owner) as any[])
    .map(a => ({ id: a.id, name: a.name, count: a.n, cover: a.cover_item_id }));
}
export function createAlbum(owner: number, name: unknown): AlbumOut {
  const n = String(name ?? "").trim().slice(0, 120);
  if (!n) throw new HttpError(400, "Der Album-Name fehlt.");
  const r = db.query("INSERT INTO album (owner_id, name, created_at) VALUES (?, ?, ?) RETURNING id").get(owner, n, now()) as { id: number };
  return { id: r.id, name: n, count: 0, cover: null };
}
export function albumDetail(owner: number, id: number): AlbumDetail | null {
  const a = albums(owner).find(x => x.id === id);
  if (!a) return null;
  // every item, newest first (not one timeline page: an album can span more than 60 days)
  const rows = db.query(`SELECT ${SUM_COLS} FROM item i WHERE i.owner_id = ? AND ${SHOWN} AND i.id IN (SELECT item_id FROM album_item WHERE album_id = ?) ORDER BY i.taken_at DESC, i.id DESC`).all(owner, id);
  return { ...a, items: rows.map(summary) };
}
export function albumItems(owner: number, id: number, ids: unknown, add: boolean) {
  if (!db.query("SELECT 1 FROM album WHERE id = ? AND owner_id = ?").get(id, owner)) throw new HttpError(404, "Das Album gibt es nicht.");
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, 5000);
  db.transaction(() => {
    for (const i of list) {
      if (add) { if (db.query("SELECT 1 FROM item WHERE id = ? AND owner_id = ?").get(i, owner)) db.query("INSERT OR IGNORE INTO album_item (album_id, item_id, added_at) VALUES (?, ?, ?)").run(id, i, now()); }
      else db.query("DELETE FROM album_item WHERE album_id = ? AND item_id = ?").run(id, i);
    }
    // the cover is the first item still inside
    const cover = db.query(`SELECT ai.item_id FROM album_item ai JOIN item i ON i.id = ai.item_id WHERE ai.album_id = ? AND i.deleted_at IS NULL ORDER BY i.taken_at DESC LIMIT 1`).get(id) as { item_id: number } | null;
    db.query("UPDATE album SET cover_item_id = ? WHERE id = ?").run(cover?.item_id ?? null, id);
  })();
}
export function deleteAlbum(owner: number, id: number) {
  if (!db.query("DELETE FROM album WHERE id = ? AND owner_id = ?").run(id, owner).changes) throw new HttpError(404, "Das Album gibt es nicht.");
}
