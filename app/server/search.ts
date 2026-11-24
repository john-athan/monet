// Search: parse a typed line into chips, then filter by the chips and rank by image/text cosine blended with FTS5 bm25.
// Also owns the in-memory matrix of image vectors and the label scoring, since both read the same vectors.
// The vectors come from SigLIP 2 B/32 (docs/ml.md); the table and fields keep their older name "clip".
import { db } from "./db";
import { COLS_DOC_SUMMARY, DOC_TOP, ftsMatch, summary as docSummary } from "./docs";
import { semanticDocs } from "./docvec";
import { reindexFts } from "./fts";
import { parseQuery, SEASON_START, SEASON_KEYS, type ParseCtx } from "./parse";
import { bandOf, daysOf, SHOWN, SUM_COLS, summary } from "./library";
import { blobVec, decodeVec, dot, HttpError, localDay, vecBlob } from "./util";
import type { Chip, DocSummary, IndexIn, ItemSummary, ParseOut, SearchIn, SearchOut } from "../shared/types";

export const CLIP_MODEL = "siglip2-b32-256";
export const DIM = 768;

/* Labels are chosen relatively, not by an absolute score: SigLIP's own sigmoid gives single words almost nothing
 * (median best label 0.01, it is calibrated for whole captions), but its ranking is right. So the cosines go through a
 * softmax over the whole vocabulary at SigLIP's own temperature (exp(logit_scale) = exp(4.717) = 111.8, read from
 * google/siglip2-base-patch32-256), and a label stays when it takes at least LABEL_SHARE of the probability.
 * Calibrated on 134 test photos on 2026-11-21: 15 % keeps "Zeitung" (90 %), "Kerzen" (98 %), "Laptop" (30 %) next to
 * "Schreibtisch" (45 %), "Höhle" (34 %), and drops "Mann" (12 %) on a driver, "U-Bahn" (12 %) on a cinema poster and
 * "Rechnung" (11 %) on a banking app. 1.5 labels per photo, 4 of 134 photos get none (at 12 %: 1.75 and 2).
 */
export const LABEL_SHARE = 0.15;
export const LABEL_TOP = 3;
const LABEL_TEMP = 111.8;
/* Search keeps an image when its cosine stands out from the whole library for this query: at least SEARCH_Z
 * standard deviations above the library mean, and never below SEARCH_FLOOR. SigLIP cosines are low: right hits
 * have a median of 0.117, and queries with nothing to find ("Hund", "Pferd", "Hochzeit" among 134 holiday and
 * screenshot photos) top out between 0.05 and 0.09. Calibrated on 2026-11-21 with 45 judged German queries and 10
 * such negatives: 0.085 and z 1.5 keep 91 % of the right photos, a hit for 43 of 45 queries, and of the negatives
 * only "Schnee" (a frosted field) and "Wüste" (bare rock) still find something. 0.08 would keep 93 % but let "Hund"
 * and "Fußballspiel" find a drawing and a banking app. docs/ml.md has the grid. */
export const SEARCH_FLOOR = 0.085;
export const SEARCH_Z = 1.5;
const FTS_WEIGHT = 0.25;

/* ---------- the matrix ---------- */
type Mat = { ids: number[]; row: Map<number, number>; m: Float32Array };
const mats = new Map<number, Mat>();
function matFor(owner: number): Mat {
  let x = mats.get(owner);
  if (x) return x;
  const rows = db.query(`SELECT c.item_id, c.vec FROM clip c JOIN item i ON i.id = c.item_id WHERE i.owner_id = ? AND c.model = ?`).all(owner, CLIP_MODEL) as { item_id: number; vec: Uint8Array }[];
  x = { ids: [], row: new Map(), m: new Float32Array(Math.max(1024, rows.length * 2) * DIM) };
  mats.set(owner, x);
  for (const r of rows) put(x, r.item_id, blobVec(r.vec));
  return x;
}
function put(x: Mat, id: number, v: Float32Array) {
  let i = x.row.get(id);
  if (i == null) {
    i = x.ids.length; x.ids.push(id); x.row.set(id, i);
    if ((i + 1) * DIM > x.m.length) { const n = new Float32Array(x.m.length * 2); n.set(x.m); x.m = n; }
  }
  x.m.set(v, i * DIM);
}
export const loadMatrices = () => { mats.clear(); for (const o of db.query("SELECT id FROM owner").all() as { id: number }[]) matFor(o.id); };

/* ---------- labels ---------- */
type Vocab = { labels: string[]; m: Float32Array };
let vocab: Vocab | null | undefined;
function vocabFor(model: string): Vocab | null {
  if (model !== CLIP_MODEL) return null;
  if (vocab !== undefined) return vocab;
  const rows = db.query("SELECT label, vec FROM label_vocab WHERE model = ? ORDER BY rowid").all(model) as { label: string; vec: Uint8Array }[];
  if (!rows.length) return (vocab = null);
  const m = new Float32Array(rows.length * DIM);
  rows.forEach((r, i) => m.set(blobVec(r.vec), i * DIM));
  return (vocab = { labels: rows.map(r => r.label), m });
}
export const hasVocab = (model: string) => !!db.query("SELECT 1 FROM label_vocab WHERE model = ? LIMIT 1").get(model);

export function storeVocab(model: string, labels: { label: string; lang: string; vec: string }[]) {
  if (model !== CLIP_MODEL) throw new HttpError(400, "Unbekanntes Modell.");
  let n = 0;
  db.transaction(() => {
    for (const l of labels.slice(0, 2000)) {
      const v = decodeVec(l.vec, DIM);
      if (!v || typeof l.label !== "string" || !l.label) continue;
      db.query("INSERT INTO label_vocab (model, label, lang, vec) VALUES (?, ?, ?, ?) ON CONFLICT(model, label, lang) DO UPDATE SET vec = excluded.vec").run(model, l.label.slice(0, 60), String(l.lang ?? "de").slice(0, 8), vecBlob(v));
      n++;
    }
  })();
  vocab = undefined; vmean = undefined;
  return n;
}
/** The softmax share of every label for a vector (see LABEL_SHARE); null without a vocabulary. */
export function labelShares(v: Float32Array): Map<string, number> | null {
  const voc = vocabFor(CLIP_MODEL);
  if (!voc) return null;
  const raw = voc.labels.map((label, i) => ({ label, cos: dot(v, voc.m, i * DIM) }));
  const max = Math.max(...raw.map(x => x.cos));
  const e = raw.map(x => Math.exp(LABEL_TEMP * (x.cos - max))), z = e.reduce((a, b) => a + b, 0);
  // a label may exist twice (German and English twin): its shares add up
  const share = new Map<string, number>();
  raw.forEach((x, i) => share.set(x.label, (share.get(x.label) ?? 0) + e[i] / z));
  return share;
}
/** The mean of the label prompts' vectors: what a text query looks like on average (docvec.ts centres queries on it). */
let vmean: Float32Array | null | undefined;
export function vocabMean(): Float32Array | null {
  if (vmean !== undefined) return vmean;
  const voc = vocabFor(CLIP_MODEL);
  if (!voc) return null;
  const n = voc.labels.length, m = new Float32Array(DIM);
  for (let i = 0; i < n; i++) for (let k = 0; k < DIM; k++) m[k] += voc.m[i * DIM + k] / n;
  return (vmean = m);
}
/* A query that is close to a label stands for it: "house" is "Haus", "wohnung" is mostly "Wohnung" and a little "Haus".
 * Text against the label prompts is sharp (measured 2026-11-22: haus 96 % Haus, rechnung 85 % Rechnung, reise 97 % Reise,
 * universität 99 %), and flat where no label fits (miete: 20 % at best, vertrag 29 %). So a query is expanded only when
 * its best label takes EXPAND_TOP, and then by every label taking EXPAND_SHARE, at most three. */
export const EXPAND_TOP = 0.5;
export const EXPAND_SHARE = 0.1;
export function expandQuery(vec: Float32Array): string[] {
  const sh = labelShares(vec);
  if (!sh) return [];
  const top = [...sh].sort((a, b) => b[1] - a[1]);
  if (!top.length || top[0][1] < EXPAND_TOP) return [];
  return top.filter(([, s]) => s >= EXPAND_SHARE).slice(0, 3).map(([l]) => l);
}
/** At most LABEL_TOP labels whose softmax share reaches LABEL_SHARE, stored in item_label. */
export function scoreLabels(itemId: number, v: Float32Array) {
  const share = labelShares(v);
  if (!share) return false;
  const top = [...share].map(([label, score]) => ({ label, score })).filter(x => x.score >= LABEL_SHARE).sort((a, b) => b.score - a.score).slice(0, LABEL_TOP);
  db.transaction(() => {
    db.query("DELETE FROM item_label WHERE item_id = ?").run(itemId);
    for (const t of top) db.query("INSERT INTO item_label (item_id, label, score) VALUES (?, ?, ?)").run(itemId, t.label, t.score);
    db.query("UPDATE item SET labels_ok = 1 WHERE id = ?").run(itemId);
  })();
  return true;
}
/** After a vocabulary arrives: label every item that already has a vector. A few at a time so requests keep flowing. */
export async function relabelAll() {
  const rows = db.query("SELECT item_id, vec FROM clip WHERE model = ?").all(CLIP_MODEL) as { item_id: number; vec: Uint8Array }[];
  for (let i = 0; i < rows.length; i++) {
    scoreLabels(rows[i].item_id, blobVec(rows[i].vec)); reindexFts(rows[i].item_id);
    if (i % 50 === 49) await new Promise(r => setTimeout(r, 0));
  }
}

/** Once at startup: an item whose vector came from an older model is analysed again. Its old vector stays until the
 *  new one replaces it, but search, labels and stacks only read vectors of CLIP_MODEL. Returns how many. */
export function requeueOtherModels(): number {
  return db.query(`UPDATE item SET clip_ok = 0 WHERE clip_ok = 1 AND id IN (SELECT item_id FROM clip WHERE model != ?)`).run(CLIP_MODEL).changes;
}

/** Stores a clip vector (and OCR text) for an item and refreshes everything derived from them. */
export function storeClip(owner: number, itemId: number, v: Float32Array) {
  db.query(`INSERT INTO clip (item_id, model, vec) VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET model = excluded.model, vec = excluded.vec`).run(itemId, CLIP_MODEL, vecBlob(v));
  db.query("UPDATE item SET clip_ok = 1 WHERE id = ?").run(itemId);
  put(matFor(owner), itemId, v);
  scoreLabels(itemId, v);
}
export function storeOcr(itemId: number, text: string) {
  db.query("UPDATE item SET ocr_text = ?, ocr_ok = 1 WHERE id = ?").run(text.slice(0, 20000), itemId);
}
export type { IndexIn };

/* ---------- parse (the pure part is in parse.ts) ---------- */
const inOwners = (owners: number[]) => `(${owners.map(() => "?").join(",") || "NULL"})`;
const libraryCtx = (owners: number[]): ParseCtx => ({
  people: db.query(`SELECT id, name FROM person WHERE owner_id IN ${inOwners(owners)} AND name IS NOT NULL AND hidden = 0`).all(...owners) as any[],
  places: db.query(`SELECT DISTINCT p.id, p.name FROM place p JOIN item i ON i.place_id = p.id WHERE i.owner_id IN ${inOwners(owners)} AND i.deleted_at IS NULL`).all(...owners) as any[],
});
export { parseQuery, SEASON_START, seasonOf, fold } from "./parse";
/** `owners`: the libraries searched (one, or the whole household). */
export const parse = (owners: number | number[], q: string) => parseQuery(String(q ?? "").slice(0, 300), libraryCtx(([] as number[]).concat(owners)));

/* ---------- search ---------- */
/** SQL for one chip. Date chips are ANDed, so "Sommer 2019" is summer of 2019. */
function chipSql(c: Chip, args: any[]): string | null {
  if (c.kind === "person") { args.push(+c.value); return "EXISTS (SELECT 1 FROM face f WHERE f.item_id = i.id AND f.person_id = ?)"; }
  if (c.kind === "place") { args.push(+c.value); return "i.place_id = ?"; }
  if (c.kind !== "date") return null;
  const [k, v] = [c.value.slice(0, c.value.indexOf(":")), c.value.slice(c.value.indexOf(":") + 1)];
  if (k === "y" && /^\d{4}$/.test(v)) { args.push(v); return "substr(i.day, 1, 4) = ?"; }
  if (k === "m" && /^\d{1,2}$/.test(v)) { args.push(String(+v).padStart(2, "0")); return "substr(i.day, 6, 2) = ?"; }
  if (k === "s" && SEASON_START[v]) {
    // from this season's start up to the next one's; winter wraps around New Year
    const next = SEASON_START[SEASON_KEYS[(SEASON_KEYS.indexOf(v as any) + 1) % 4]];
    args.push(SEASON_START[v], next);
    return `(substr(i.day, 6, 5) >= ? ${v === "winter" ? "OR" : "AND"} substr(i.day, 6, 5) < ?)`;
  }
  const r = /^(\d{2}-\d{2})\.\.(\d{2}-\d{2})$/.exec(v);
  if (k === "r" && r) { args.push(r[1], r[2]); return "substr(i.day, 6, 5) BETWEEN ? AND ?"; }
  return null;
}
/** The same chips for files: dates on the file's own day, people and places by what the file names (doc_link). */
function docChipSql(c: Chip, args: any[]): string | null {
  if (c.kind === "person" || c.kind === "place") { args.push(c.kind, +c.value); return "EXISTS (SELECT 1 FROM doc_link l WHERE l.doc_id = d.id AND l.kind = ? AND l.ref_id = ?)"; }
  const s = chipSql(c, args);
  return s && s.replaceAll("i.day", "d.day");
}
export const DOC_HITS = 60;
const RRF = 60;
/** Files for a search: whatever matches the words (FTS over title, text, labels, transcript and names), the labels the
 *  query stands for, and the vectors of pages and text pieces, fused by rank (reciprocal rank fusion: the three scores
 *  live on different scales). Person, place and date chips filter. No words and no vector: the filter alone, newest first;
 *  no chips at all: nothing. */
export function findDocs(owners: number[], chips: Chip[], vec: Float32Array | null, viewer: number): DocSummary[] {
  const args: any[] = [...owners], where = [`d.owner_id IN ${inOwners(owners)}`, "d.deleted_at IS NULL"];
  let filtered = false;
  for (const c of chips) { const s = docChipSql(c, args); if (s) { where.push(s); filtered = true; } }
  const words = chips.filter(c => c.kind === "content" || c.kind === "text").map(c => c.value).join(" ");
  const w = where.join(" AND ");
  const rows = (sql: string, a: any[]) => db.query(sql).all(...a) as any[];
  if (!words && !vec) {
    if (!filtered) return [];
    return rows(`SELECT ${COLS_DOC_SUMMARY} FROM doc d WHERE ${w} AND ${DOC_TOP} ORDER BY coalesce(d.taken_at, d.modified_at) DESC LIMIT ${DOC_HITS}`, args).map(r => docSummary(r, viewer));
  }
  const lists: number[][] = [];
  const fts = (m: string | null) => m ? rows(`SELECT d.id FROM doc_fts JOIN doc d ON d.id = doc_fts.rowid WHERE doc_fts MATCH ? AND ${w} ORDER BY rank LIMIT 200`, [m, ...args]).map(r => r.id) : [];
  lists.push(fts(ftsMatch(words)));
  const extra = vec ? expandQuery(vec).filter(l => !new RegExp(`^${l}$`, "i").test(words.trim())) : [];
  if (extra.length) lists.push(fts(extra.map(l => (l.match(/[\p{L}\p{N}]+/gu) ?? []).map(t => `"${t}"`).join(" ")).map(x => `(${x})`).join(" OR ")));
  if (vec) {
    const sem = semanticDocs(owners, vec);
    if (sem.size) {
      // only those the chips let through
      const ok = new Set(rows(`SELECT d.id FROM doc d WHERE ${w} AND d.id IN (${[...sem.keys()].join(",")})`, args).map(r => r.id));
      lists.push([...sem].filter(([id]) => ok.has(id)).sort((a, b) => b[1] - a[1]).map(([id]) => id));
    }
  }
  const score = new Map<number, number>();
  for (const l of lists) l.forEach((id, k) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF + k)));
  const ids = [...score].sort((a, b) => b[1] - a[1]).slice(0, DOC_HITS).map(([id]) => id);
  if (!ids.length) return [];
  const by = new Map(rows(`SELECT ${COLS_DOC_SUMMARY} FROM doc d WHERE d.id IN (${ids.join(",")})`, []).map(r => [r.id, docSummary(r, viewer)]));
  return ids.flatMap(id => by.get(id) ?? []);
}

const ftsQuery = (words: string) => (words.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12).map(w => `"${w}"*`).join(" OR ");

type Hit = { id: number; taken_at: number; owner_id: number };
function candidates(owners: number[], chips: Chip[]): Hit[] {
  const args: any[] = [...owners], where = [`i.owner_id IN ${inOwners(owners)}`, SHOWN];
  for (const c of chips) { const s = chipSql(c, args); if (s) where.push(s); }
  return db.query(`SELECT i.id, i.taken_at, i.owner_id FROM item i WHERE ${where.join(" AND ")}`).all(...args) as Hit[];
}

function rank(owners: number[], chips: Chip[], vec: Float32Array | null, sort: "best" | "date"): Hit[] {
  const cands = candidates(owners, chips);
  const words = chips.filter(c => c.kind === "content" || c.kind === "text").map(c => c.value).join(" ");
  if (!words && !vec) return cands.sort((a, b) => b.taken_at - a.taken_at || b.id - a.id);

  // FTS5 hits over OCR text, labels, place, people and file name; bm25 is lower-is-better, so flip to 0..1
  const fts = new Map<number, number>();
  const fq = ftsQuery(words);
  if (fq) {
    const hits = db.query("SELECT rowid, bm25(item_fts, 1, 3, 2, 3, 1) AS r FROM item_fts WHERE item_fts MATCH ? ORDER BY r LIMIT 3000").all(fq) as { rowid: number; r: number }[];
    const worst = Math.max(...hits.map(h => -h.r), 1e-9);
    for (const h of hits) fts.set(h.rowid, Math.max(0.05, -h.r / worst));
  }
  const mats = vec ? new Map(owners.map(o => [o, matFor(o)])) : null;
  const scored: (Hit & { cos: number; f: number })[] = [];
  for (const c of cands) {
    const mat = mats?.get(c.owner_id), row = mat?.row.get(c.id);
    scored.push({ ...c, cos: vec && mat && row != null ? dot(vec, mat.m, row * DIM) : -1, f: fts.get(c.id) ?? 0 });
  }
  // the statistics come from the whole library (all searched libraries), not the filtered candidates: "Oma, 2019" may leave only a handful
  let mu = 0, sd = 1;
  if (vec && mats && [...mats.values()].reduce((n, m) => n + m.row.size, 0) > 1) {
    const all: number[] = []; for (const mat of mats.values()) for (const r of mat.row.values()) all.push(dot(vec, mat.m, r * DIM));
    mu = all.reduce((a, b) => a + b, 0) / all.length;
    sd = Math.sqrt(all.reduce((a, b) => a + (b - mu) ** 2, 0) / all.length) || 1;
  }
  const kept = scored.filter(s => s.f > 0 || (vec != null && s.cos >= SEARCH_FLOOR && (s.cos - mu) / sd >= SEARCH_Z));
  const score = (s: typeof kept[number]) => Math.max(s.cos, 0) + FTS_WEIGHT * s.f;
  return kept.sort(sort === "date" ? (a, b) => b.taken_at - a.taken_at || b.id - a.id : (a, b) => score(b) - score(a) || b.taken_at - a.taken_at);
}

/** One page of date-sorted hits as timeline days (docs/together.md, "Search"): its photos, and the files whose day lies
 *  between this page's oldest day and the previous page's, so a day is never split out of order. The first page also
 *  carries the band over all hits and files. */
function asDays(owners: number[], hits: Hit[], offset: number, limit: number, docs: DocSummary[], viewer: number): Pick<SearchOut, "days" | "band"> {
  const ids = hits.slice(offset, offset + limit).map(h => h.id);
  const rows = (ids.length ? db.query(`SELECT ${SUM_COLS}, i.owner_id, p.name AS place_name FROM item i LEFT JOIN place p ON p.id = i.place_id
    WHERE i.id IN (SELECT value FROM json_each(?)) ORDER BY i.taken_at DESC, i.id DESC`).all(JSON.stringify(ids)) : []) as any[];
  const dayOf = (id: number) => (db.query("SELECT day FROM item WHERE id = ?").get(id) as { day: string } | null)?.day ?? "";
  const upper = offset > 0 && hits[offset - 1] ? dayOf(hits[offset - 1].id) : "9999";
  const lower = offset + limit < hits.length ? rows.at(-1)?.day ?? "" : "";
  const dd = docs.length ? db.query(`SELECT id, day FROM doc WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(docs.map(d => d.id))) as { id: number; day: string | null }[] : [];
  const docDay = new Map(dd.map(r => [r.id, r.day]));
  const placed = docs.map(d => ({ d, day: docDay.get(d.id) ?? localDay(d.takenAt, null) }));
  const docsByDay = new Map<string, DocSummary[]>();
  for (const { d, day } of placed) if (day < upper && day >= lower) (docsByDay.get(day) ?? docsByDay.set(day, []).get(day)!).push(d);
  for (const ds of docsByDay.values()) ds.sort((a, b) => b.takenAt - a.takenAt || b.id - a.id);
  const dates = [...new Set([...rows.map(r => r.day as string), ...docsByDay.keys()])].sort().reverse();
  const out: Pick<SearchOut, "days" | "band"> = { days: daysOf(dates, rows, docsByDay, r => r.owner_id === viewer ? summary(r) : { ...summary(r), owner: r.owner_id }) };
  if (!offset) {
    const all = hits.length ? db.query(`SELECT substr(i.day, 1, 7) AS ym, i.color, i.colors FROM item i WHERE i.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(hits.map(h => h.id))) as any[] : [];
    const dm = new Map<string, number>();
    for (const { day } of placed) dm.set(day.slice(0, 7), (dm.get(day.slice(0, 7)) ?? 0) + 1);
    out.band = bandOf(all, [...dm].map(([ym, n]) => ({ ym, n }))).months;
  }
  return out;
}

/** Photos from another library than the one being looked at say whose they are. */
function summaries(owners: number[], ids: number[], viewer: number): ItemSummary[] {
  if (!ids.length) return [];
  const rows = db.query(`SELECT ${SUM_COLS}, i.owner_id FROM item i WHERE i.owner_id IN ${inOwners(owners)} AND i.id IN (${ids.map(() => "?").join(",")})`).all(...owners, ...ids) as any[];
  const by = new Map(rows.map(r => [r.id, r.owner_id === viewer ? summary(r) : { ...summary(r), owner: r.owner_id }]));
  return ids.flatMap(id => by.get(id) ?? []);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** `owners`: the libraries searched; `viewer`: the library the page belongs to (its photos carry no owner mark). */
export function search(owners: number | number[], b: SearchIn, viewer?: number): SearchOut {
  const os = ([] as number[]).concat(owners), view = viewer ?? os[0];
  const chips = (Array.isArray(b.chips) ? b.chips : []).filter(c => c && typeof c.value === "string" && ["person", "date", "place", "content", "text"].includes(c.kind)).slice(0, 12);
  const vec = b.vec ? decodeVec(b.vec, DIM) : null;
  if (b.vec && !vec) throw new HttpError(400, "Der Suchvektor ist ungültig.");
  // as days the hits come newest first, like the timeline they are laid out in
  const sort = b.days || b.sort === "date" ? "date" : "best";
  const hits = rank(os, chips, vec, sort);
  const limit = Math.max(1, Math.min(1000, Math.floor(b.limit ?? 400))), offset = Math.max(0, Math.floor(b.offset ?? 0));
  const docs = offset && !b.days ? [] : findDocs(os, chips, vec, view);
  const out: SearchOut = { total: hits.length, items: summaries(os, hits.slice(offset, offset + limit).map(h => h.id), view), relaxed: null, docs: offset ? [] : docs };
  if (b.days) Object.assign(out, asDays(os, hits, offset, limit, docs, view));

  // relaxed: drop the most restrictive person (the one with the fewest photos on its own) and say what that would show
  const persons = chips.filter(c => c.kind === "person");
  if (persons.length) {
    const size = (c: Chip) => candidates(os, [c]).length;
    const drop = persons.map(c => ({ c, n: size(c) })).sort((a, b) => a.n - b.n)[0].c;
    const rest = chips.filter(c => c !== drop);
    const count = rank(os, rest, vec, sort).length;
    if (count > out.total) {
      const label = cap(rest.map(c => c.label).join(" ").trim());
      out.relaxed = { label: label ? `${label}, ohne ${drop.label}` : `Ohne ${drop.label}`, count };
    }
  }
  return out;
}
