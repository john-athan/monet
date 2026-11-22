// Everything together (docs/together.md): what makes photos, files, audio and video one library rather than four.
// Here: the date of a file, stacks of near-identical files, the people and places a file names, and transcripts.
// Vectors and their search live in server/docvec.ts, moments in server/moments.ts.
import { join } from "node:path";
import { db, metaGet, metaSet } from "./db";
import { chooseDocDate, metaDate } from "./docdate";
import { reindexDoc, rendered, rowById, summary, COLS_DOC_SUMMARY } from "./docs";
import { reindexFts } from "./fts";
import { buildWords } from "./doctext";
import { kickOcr } from "./ocr-queue";
import { enqueue, ORIGINALS } from "./ingest";
import { fold } from "./parse";
import { HttpError, localDay, runText } from "./util";
import type { DocSummary } from "../shared/types";

/* ---------- dates ---------- */
/** Gives a file its date and day. Audio reads its tags again (ffprobe), so this needs only the row and the original. */
export async function dateDoc(id: number) {
  const d = rowById(id);
  if (!d) return;
  const path = join(ORIGINALS, d.orig_path);
  let tags: Record<string, string> | undefined;
  if (d.kind === "audio") {
    try {
      const p = JSON.parse(await runText(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", path], 30_000));
      tags = Object.fromEntries(Object.entries(p.format?.tags ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
      // a music file's "date" is the year the record came out, not a moment of this library
      if (d.album) delete tags.date;
    } catch { tags = {}; }
  }
  const meta = d.kind === "book" ? null : await metaDate(d.format, path, tags);
  const r = db.query("SELECT text, words_ok FROM doc WHERE id = ?").get(id) as { text: string | null; words_ok: number };
  const t = chooseDocDate({ meta, name: d.orig_name, text: r.text, modifiedAt: d.modified_at, uploadedAt: d.uploaded_at, kind: d.kind, scan: r.words_ok === 2 });
  db.query("UPDATE doc SET taken_at = ?, taken_src = ?, day = ? WHERE id = ?").run(t.takenAt, t.src, localDay(t.takenAt, null), id);
}

/* ---------- stacks ---------- */
/* Files that are versions or siblings of one another and were made in the same few days stand as one stack: the scans of
 * one afternoon, "Vertrag v2" and "Vertrag final", the five statements a bank sent on one day. Two files stack when they
 * are of the same kind, at most STACK_GAP_DAYS apart, the stack spans at most STACK_SPAN_DAYS, and either their names
 * are the same once every word with a digit in it and every version word is taken out, or their texts share most words. */
export const STACK_GAP_DAYS = 3;
export const STACK_SPAN_DAYS = 14;
export const STACK_WORDS = 0.6;
const VERSION = new Set(["v", "version", "final", "endgültig", "endgueltig", "neu", "new", "kopie", "copy", "entwurf", "draft", "backup", "alt", "old", "korrigiert", "überarbeitet", "ueberarbeitet"]);
/** "Vertrag_v2 (1)" and "Vertrag final" -> "vertrag"; "Kontoauszug_20240630" -> "kontoauszug #". Empty when nothing is left. */
export function stem(title: string): string {
  // "v2" and a copy's "(1)" or "2" are versions too; longer numbers (dates, account numbers) stay as "#"
  const words = fold(title).split(/[\s_\-.+,;:()[\]{}]+/).filter(w => w && !VERSION.has(w) && !/^v\d+$/.test(w) && !/^\d{1,2}$/.test(w)).map(w => (/\d/.test(w) ? "#" : w));
  const out: string[] = [];
  for (const w of words) if (!(w === "#" && out[out.length - 1] === "#")) out.push(w);
  return /\p{L}/u.test(out.join("")) ? out.join(" ") : "";
}
/** The set of words of a text's start, for the overlap test; null when there are too few to judge. */
export function wordSet(text: string | null): Set<string> | null {
  const w = fold((text ?? "").slice(0, 4000)).match(/\p{L}{3,}/gu) ?? [];
  return w.length >= 30 ? new Set(w) : null;
}
export function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
}
type StackRow = { id: number; kind: string; title: string; text: string | null; taken_at: number };
/** The stacks of rows sorted by taken_at: arrays of ids, newest first, only those with two or more. Pure. */
export function planStacks(rows: StackRow[]): number[][] {
  const DAY = 86400_000, out: number[][] = [];
  const open: { ids: number[]; first: number; last: number; kind: string; stems: Set<string>; words: (Set<string> | null)[] }[] = [];
  const sets = new Map<number, Set<string> | null>();
  for (const r of rows) {
    const st = stem(r.title), ws = wordSet(r.text);
    sets.set(r.id, ws);
    // stacks whose last member is too long ago are closed
    for (let i = open.length - 1; i >= 0; i--) if (r.taken_at - open[i].last > STACK_GAP_DAYS * DAY) { if (open[i].ids.length > 1) out.push(open[i].ids.slice().reverse()); open.splice(i, 1); }
    const fit = open.find(s => s.kind === r.kind && r.taken_at - s.first <= STACK_SPAN_DAYS * DAY &&
      ((st && s.stems.has(st)) || (ws && s.words.some(w => w && overlap(w, ws) >= STACK_WORDS))));
    if (fit) { fit.ids.push(r.id); fit.last = r.taken_at; if (st) fit.stems.add(st); fit.words.push(ws); }
    else open.push({ ids: [r.id], first: r.taken_at, last: r.taken_at, kind: r.kind, stems: new Set(st ? [st] : []), words: [ws] });
  }
  for (const s of open) if (s.ids.length > 1) out.push(s.ids.slice().reverse());
  return out;
}
/** Stacks one library again from scratch (cheap: one pass in date order). A file taken out by hand stays out. */
export function restackDocs(owner: number): number {
  const rows = db.query(`SELECT id, kind, title, text, taken_at FROM doc WHERE owner_id = ? AND deleted_at IS NULL AND state = 'ok' AND unstacked = 0 AND taken_at IS NOT NULL
    AND kind IN ('doc','sheet','slides','other') ORDER BY taken_at, id`).all(owner) as StackRow[];
  const stacks = planStacks(rows);
  db.transaction(() => {
    db.query("UPDATE doc SET stack_id = NULL, stack_rank = NULL WHERE owner_id = ? AND stack_id IS NOT NULL").run(owner);
    for (const ids of stacks) {
      const sid = Math.min(...ids);
      ids.forEach((id, k) => db.query("UPDATE doc SET stack_id = ?, stack_rank = ? WHERE id = ?").run(sid, k + 1, id));
    }
  })();
  return stacks.length;
}
/** The files of the stack `id` belongs to, top first (just `id` when it is in none). */
export function stackOf(id: number, viewer: number): DocSummary[] {
  const r = db.query("SELECT stack_id FROM doc WHERE id = ?").get(id) as { stack_id: number | null } | null;
  if (!r) throw new HttpError(404, "Das gibt es nicht (mehr).");
  const rows = r.stack_id == null ? db.query(`SELECT ${COLS_DOC_SUMMARY} FROM doc d WHERE d.id = ?`).all(id)
    : db.query(`SELECT ${COLS_DOC_SUMMARY} FROM doc d WHERE d.stack_id = ? AND d.deleted_at IS NULL ORDER BY d.stack_rank`).all(r.stack_id);
  return (rows as any[]).map(x => { const s = summary(x, viewer); delete s.stack; return s; });
}
/** Takes one file out of its stack for good. */
export function unstackDoc(owner: number, id: number) {
  if (!db.query("UPDATE doc SET unstacked = 1 WHERE id = ? AND owner_id = ?").run(id, owner).changes) throw new HttpError(404, "Das gibt es nicht (mehr).");
  restackDocs(owner);
}

/* ---------- people and places a file names ---------- */
/* German nouns that are also towns: "das Essen", "die Halle". A file that says them names no place. */
const COMMON = new Set(["essen", "halle", "hof", "zug", "weil", "lauf", "wald", "bad", "rain", "mark", "plan", "berg", "au", "ort", "stadt", "post", "buch", "kirchen", "werne", "lage", "senden", "selm", "kaarst", "brake", "leer", "olpe", "bergen", "baden", "worms"]);
/* A place that a large part of a library names is a letterhead or an address ("ING-DiBa AG, Frankfurt am Main", the home
 * town in every letter): it says nothing about the file. Measured on 2026-11-22: of 951 files, 422 named Frankfurt am
 * Main and 639 München, the next most named place 29. A place named by more than COMMON_SHARE of an owner's files, and at
 * least COMMON_MIN of them, is dropped from that owner's links (meta common_places_<owner>, renewed by relinkAll). */
export const COMMON_SHARE = 0.1, COMMON_MIN = 20;
const commonPlaces = (owner: number) => new Set<number>(JSON.parse(metaGet(`common_places_${owner}`) ?? "[]"));
const wordRe = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${fold(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
/** Which named people (of the file's owner) and which places (where the owner has photos) a file names in its title,
 *  text or transcript. People need a name of three letters or more, places four. */
export function linkDoc(id: number, raw = false) {
  const d = db.query("SELECT owner_id, title, text FROM doc WHERE id = ?").get(id) as { owner_id: number; title: string; text: string | null } | null;
  if (!d) return;
  const spoken = (db.query("SELECT text FROM transcript WHERE ref = 'doc' AND ref_id = ?").get(id) as { text: string } | null)?.text ?? "";
  const hay = fold(`${d.title.replace(/[_\-.+]+/g, " ")} ${(d.text ?? "").slice(0, 200_000)} ${spoken.slice(0, 100_000)}`);
  const people = db.query("SELECT id, name FROM person WHERE owner_id = ? AND name IS NOT NULL AND hidden = 0").all(d.owner_id) as { id: number; name: string }[];
  const places = db.query("SELECT DISTINCT p.id, p.name FROM place p JOIN item i ON i.place_id = p.id WHERE i.owner_id = ? AND i.deleted_at IS NULL").all(d.owner_id) as { id: number; name: string }[];
  // one set of the text's words, so a library with hundreds of places costs one lookup per name, not one scan
  const words = new Set(hay.match(/[\p{L}\p{N}]+/gu) ?? []);
  const names = (n: string) => {
    const parts = fold(n).match(/[\p{L}\p{N}]+/gu) ?? [];
    return parts.length > 0 && parts.every(w => words.has(w)) && (parts.length === 1 || wordRe(n).test(hay));
  };
  const links: ["person" | "place", number][] = [];
  for (const p of people) if (p.name.trim().length >= 3 && names(p.name)) links.push(["person", p.id]);
  const common = raw ? new Set<number>() : commonPlaces(d.owner_id);
  for (const p of places) if (p.name.length >= 4 && !COMMON.has(fold(p.name)) && !common.has(p.id) && names(p.name)) links.push(["place", p.id]);
  db.transaction(() => {
    db.query("DELETE FROM doc_link WHERE doc_id = ?").run(id);
    for (const [k, r] of links) db.query("INSERT OR IGNORE INTO doc_link (doc_id, kind, ref_id) VALUES (?, ?, ?)").run(id, k, r);
  })();
  reindexDoc(id);
}
/** The files of the household that name a person or a place, newest first. */
export function linkedDocs(kind: "person" | "place", ref: number, owners: number[], viewer: number): DocSummary[] {
  const q = owners.map(() => "?").join(",") || "NULL";
  return (db.query(`SELECT ${COLS_DOC_SUMMARY} FROM doc d JOIN doc_link l ON l.doc_id = d.id WHERE l.kind = ? AND l.ref_id = ? AND d.owner_id IN (${q}) AND d.deleted_at IS NULL
    ORDER BY coalesce(d.taken_at, d.modified_at) DESC LIMIT 200`).all(kind, ref, ...owners) as any[]).map(r => summary(r, viewer));
}

/* ---------- transcripts ---------- */
/* Speech in videos and in recordings becomes text: the Mac transcribes on the device (Apple's SpeechAnalyzer) and posts
 * the segments. Music (an audio file with an album tag) and anything longer than three hours is left out. */
export const SPEECH_MAX_MS = 3 * 3600_000;
export type SpeechPending = { ref: "item" | "doc"; id: number; durationMs: number | null; ext: string };
export function speechPending(owner: number | null, limit: number): SpeechPending[] {
  const own = owner == null ? "1" : "owner_id = ?", a = owner == null ? [] : [owner];
  const items = db.query(`SELECT id, duration_ms, ext FROM item WHERE ${own} AND kind = 'video' AND speech_ok = 0 AND thumbs_ok = 1 AND deleted_at IS NULL
    AND coalesce(duration_ms, 0) <= ? ORDER BY taken_at DESC LIMIT ?`).all(...a, SPEECH_MAX_MS, limit) as any[];
  const docs = db.query(`SELECT id, duration_ms, format FROM doc WHERE ${own} AND kind = 'audio' AND speech_ok = 0 AND state = 'ok' AND deleted_at IS NULL AND album IS NULL
    AND coalesce(duration_ms, 0) <= ? ORDER BY uploaded_at DESC LIMIT ?`).all(...a, SPEECH_MAX_MS, limit) as any[];
  return [...docs.map(d => ({ ref: "doc" as const, id: d.id, durationMs: d.duration_ms, ext: d.format })), ...items.map(i => ({ ref: "item" as const, id: i.id, durationMs: i.duration_ms, ext: i.ext }))].slice(0, limit);
}
/** Segments as posted: start and end in ms, the words. Anything malformed is dropped, the rest capped. */
export function cleanSegments(raw: unknown): { s: number; e: number; t: string }[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "Die Abschnitte fehlen.");
  const out: { s: number; e: number; t: string }[] = [];
  for (const x of raw.slice(0, 20_000)) {
    const s = Number(x?.s), e = Number(x?.e), t = typeof x?.t === "string" ? x.t.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 2000) : "";
    if (!t || !Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < s) continue;
    out.push({ s: Math.round(s), e: Math.round(e), t });
  }
  return out.sort((a, b) => a.s - b.s);
}
/** Stores a transcript (or, `failed`, that none can be made) and refreshes what reads it: the search rows, and for a file its vectors. */
export function storeSpeech(ref: "item" | "doc", id: number, b: { model?: unknown; lang?: unknown; segments?: unknown; failed?: unknown }) {
  const table = ref === "item" ? "item" : "doc";
  if (b.failed === true) { db.query(`UPDATE ${table} SET speech_ok = 2 WHERE id = ?`).run(id); return; }
  const segs = cleanSegments(b.segments);
  const text = segs.map(s => s.t).join(" ").slice(0, 512 * 1024);
  db.transaction(() => {
    db.query(`INSERT INTO transcript (ref, ref_id, model, lang, segments, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ref, ref_id) DO UPDATE SET model = excluded.model, lang = excluded.lang, segments = excluded.segments, text = excluded.text, created_at = excluded.created_at`)
      .run(ref, id, String(b.model ?? "").slice(0, 40), typeof b.lang === "string" ? b.lang.slice(0, 16) : null, JSON.stringify(segs), text, Date.now());
    // the text pieces of a file change with its transcript: its vectors are made again
    db.query(`UPDATE ${table} SET speech_ok = 1${ref === "doc" ? ", vec_ok = 0" : ""} WHERE id = ?`).run(id);
  })();
  if (ref === "item") reindexFts(id); else linkDoc(id);
}
/** A file's text came late (OCR of a scan): date, links, stack and vectors follow it. */
export async function textChanged(id: number) {
  await dateDoc(id);
  linkDoc(id);
  db.query("UPDATE doc SET vec_ok = 0 WHERE id = ?").run(id);
  const o = db.query("SELECT owner_id FROM doc WHERE id = ?").get(id) as { owner_id: number } | null;
  if (o) scheduleRestack(o.owner_id);
}

/* ---------- after a render, and once at start ---------- */
const restackSoon = new Map<number, Timer>();
function scheduleRestack(owner: number) {
  clearTimeout(restackSoon.get(owner));
  restackSoon.set(owner, setTimeout(() => { restackSoon.delete(owner); restackDocs(owner); }, 2000));
}
/** Hangs this module's steps after every render. Called once at start (main.ts): at import time the modules that import
 *  each other (docs, ingest, the OCR queue) are not all initialised yet. */
export function installTogether() {
  rendered.push(async id => { await buildWords(id); await textChanged(id); if ((db.query("SELECT words_ok FROM doc WHERE id = ?").get(id) as any)?.words_ok === 4) kickOcr(); });
}

/** At start: files from before this module get their date and links, the search rows are built again where the table is
 *  new, and every library is stacked. Yields now and then so requests keep flowing. */
export async function sweepTogether(): Promise<{ dated: number; reindexed: number; stacks: number }> {
  let dated = 0, reindexed = 0, stacks = 0;
  const undated = db.query("SELECT id FROM doc WHERE taken_src IS NULL AND state != 'pending' ORDER BY id").all() as { id: number }[];
  for (const r of undated) { await dateDoc(r.id); linkDoc(r.id); dated++; if (dated % 20 === 0) await new Promise(res => setTimeout(res, 0)); }
  if (metaGet("doc_fts") !== "2") {
    for (const r of db.query("SELECT id FROM doc").all() as { id: number }[]) { reindexDoc(r.id); if (++reindexed % 100 === 0) await new Promise(res => setTimeout(res, 0)); }
    metaSet("doc_fts", "2");
  }
  for (const o of db.query("SELECT id FROM owner").all() as { id: number }[]) stacks += restackDocs(o.id);
  if (metaGet("link_rule") !== "1") { await relinkAll(); metaSet("link_rule", "1"); }
  // files rendered before the text layer existed get their positions; scans among them go to OCR
  let worded = 0;
  for (const r of db.query("SELECT id FROM doc WHERE words_ok = 0 AND state = 'ok' AND kind IN ('doc','slides') AND deleted_at IS NULL ORDER BY id").all() as { id: number }[]) {
    await enqueue(() => buildWords(r.id)); worded++;
  }
  if (worded) kickOcr();
  return { dated, reindexed, stacks };
}
/** Links again for every file: names and places change (a person gets named, photos arrive from a new town). All places
 *  first, then the ones too many files name are dropped and remembered (COMMON_SHARE). */
export async function relinkAll() {
  let k = 0;
  for (const r of db.query("SELECT id FROM doc WHERE deleted_at IS NULL").all() as { id: number }[]) { linkDoc(r.id, true); if (++k % 50 === 0) await new Promise(res => setTimeout(res, 0)); }
  for (const o of db.query("SELECT id FROM owner").all() as { id: number }[]) {
    const total = (db.query("SELECT count(*) AS n FROM doc WHERE owner_id = ? AND deleted_at IS NULL").get(o.id) as { n: number }).n;
    const common = (db.query(`SELECT l.ref_id FROM doc_link l JOIN doc d ON d.id = l.doc_id WHERE d.owner_id = ? AND l.kind = 'place' GROUP BY l.ref_id HAVING count(*) > ? AND count(*) >= ?`)
      .all(o.id, total * COMMON_SHARE, COMMON_MIN) as { ref_id: number }[]).map(r => r.ref_id);
    metaSet(`common_places_${o.id}`, JSON.stringify(common));
    if (!common.length) continue;
    const hit = db.query(`SELECT DISTINCT l.doc_id FROM doc_link l JOIN doc d ON d.id = l.doc_id WHERE d.owner_id = ? AND l.kind = 'place' AND l.ref_id IN (${common.join(",")})`).all(o.id) as { doc_id: number }[];
    db.query(`DELETE FROM doc_link WHERE kind = 'place' AND ref_id IN (${common.join(",")}) AND doc_id IN (SELECT id FROM doc WHERE owner_id = ?)`).run(o.id);
    for (const h of hit) reindexDoc(h.doc_id);
  }
}
