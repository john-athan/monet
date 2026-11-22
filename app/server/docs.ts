// Files: documents, sheets, slides, books, audio and the rest (docs/files.md). The row of an upload, the render queue, pages on
// demand, sheets, covers, text, list and detail, rename, soft delete, purge. Scoped by owner_id; nothing here knows HTTP routes.
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { db } from "./db";
import { CsvReader, decodeText, detectDelimiter, sheetSvg, SHEET_MAX_COLS, SHEET_MAX_ROWS, splitName, TEXT_FORMATS, zipRead, type DocType, type ZipEntry } from "./docsniff";
import { bookText, entryMap, parseBook, withSource } from "./epub";
import { DATA, enqueue, ORIGINALS } from "./ingest";
import { HttpError, json, localDay, now, run, runText } from "./util";
import type { BookOut, DocDetail, DocKind, DocList, DocSummary, SheetRows } from "../shared/types";

const VIPS_ENV = { VIPS_CONCURRENCY: "1" };
const FAILED = "Diese Datei konnte nicht aufbereitet werden.";
const TEXT_CAP = 512 * 1024; // what doc.text keeps for search
const CSV_READ_MAX = 512 << 20; // bytes of a CSV that are read; the rest is cut (truncated)
const SOFFICE = process.env.MONET_SOFFICE ?? "soffice";
const SOFFICE_MS = 180_000;
const SHEET_CSV_FILTER = "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1";

/* ---------- paths ---------- */
const derivedDir = (sha: string) => join(DATA, "d", sha.slice(0, 2));
/** suffix: ".pdf", "-c.webp", "-p3.webp", "-t3.webp", "-s0.ndjson", "-s0.idx" */
export const derived = (sha: string, suffix: string) => join(derivedDir(sha), `${sha}${suffix}`);
type Row = { id: number; owner_id: number; sha256: string; kind: DocKind; format: string; mime: string; bytes: number; title: string; orig_name: string | null; folder_id: number | null;
  pages: number | null; width: number; height: number; modified_at: number; uploaded_at: number; orig_path: string; state: "pending" | "ok" | "failed"; error: string | null; sheets: string | null; deleted_at: number | null;
  by_name: string | null; album: string | null; track: number | null; duration_ms: number | null; is_text: number; book: string | null };
export const pdfOf = (d: Pick<Row, "sha256" | "format" | "orig_path">) => d.format === "pdf" ? join(ORIGINALS, d.orig_path) : derived(d.sha256, ".pdf");
function readHeadSync(path: string, max: number): Uint8Array {
  const fd = openSync(path, "r"), b = new Uint8Array(max);
  try { return b.subarray(0, readSync(fd, b, 0, max, 0)); } finally { closeSync(fd); }
}
function place(from: string, to: string) {
  mkdirSync(dirname(to), { recursive: true });
  try { renameSync(from, to); } catch (e: any) { if (e.code !== "EXDEV") throw e; copyFileSync(from, to); rmSync(from); }
}

/* ---------- rows ---------- */
export const COLS_DOC_SUMMARY = "d.id, d.owner_id, d.kind, d.format, d.title, d.bytes, d.pages, d.width, d.height, d.modified_at, d.state, d.folder_id, d.by_name, d.album, d.track, d.duration_ms, d.is_text";
export function summary(r: any, viewer?: number): DocSummary {
  const s: DocSummary = { id: r.id, kind: r.kind, title: r.title, format: r.format, bytes: r.bytes, pages: r.pages, w: r.width, h: r.height, modifiedAt: r.modified_at, state: r.state, folderId: r.folder_id };
  if (r.by_name) s.by = r.by_name;
  if (r.album) s.album = r.album;
  if (r.track != null) s.track = r.track;
  if (r.duration_ms != null) s.durationMs = r.duration_ms;
  if (r.kind === "other" && r.is_text) s.text = true;
  if (viewer != null && r.owner_id !== viewer) s.owner = r.owner_id;
  return s;
}
export function summaryById(owner: number, id: number): DocSummary | null {
  const r = db.query(`SELECT ${COLS_DOC_SUMMARY} FROM doc d WHERE d.id = ? AND d.owner_id = ?`).get(id, owner);
  return r ? summary(r) : null;
}
/** The row of a file anywhere in the household (reads); null when there is none. */
export const rowById = (id: number) => db.query("SELECT * FROM doc WHERE id = ?").get(id) as Row | null;

/** The folders from the top down to `folderId` (all of them the owner's). */
export function folderPath(owner: number, folderId: number | null): { id: number; name: string }[] {
  const out: { id: number; name: string }[] = [];
  for (let id = folderId, k = 0; id != null && k < 64; k++) {
    const f = db.query("SELECT id, name, parent_id FROM folder WHERE id = ? AND owner_id = ?").get(id, owner) as { id: number; name: string; parent_id: number | null } | null;
    if (!f) break;
    out.unshift({ id: f.id, name: f.name }); id = f.parent_id;
  }
  return out;
}
export function detail(id: number): DocDetail | null {
  const r = rowById(id);
  if (!r) return null;
  return { ...summary(r) as Omit<DocSummary, "owner">, owner: r.owner_id, sha256: r.sha256, mime: r.mime, origName: r.orig_name, uploadedAt: r.uploaded_at, error: r.error,
    path: folderPath(r.owner_id, r.folder_id), sheets: json<{ name: string; rows: number; cols: number; truncated: boolean }[]>(r.sheets, []), deletedAt: r.deleted_at };
}

/* ---------- list and search ---------- */
/** A safe FTS5 query from free words: every token quoted, the last one a prefix. null when there is no word. */
export function ftsMatch(words: string): string | null {
  const t = (words.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  return t.length ? t.map((w, i) => `"${w}"${i === t.length - 1 ? "*" : ""}`).join(" ") : null;
}
const ids = (n: number[]) => `(${n.map(() => "?").join(",") || "NULL"})`;

export type ListQuery = { kind?: string | null; q?: string | null; cursor?: string | null; limit?: number };
/** Newest modifiedAt first. Cursor: "<modified_at>:<id>"; with q (ordered by rank) "o<offset>". */
export function list(owner: number, q: ListQuery): DocList {
  const limit = Number.isFinite(q.limit) ? Math.max(1, Math.min(200, Math.floor(q.limit!))) : 60;
  if (q.kind && !["doc", "sheet", "slides", "book", "audio"].includes(q.kind)) throw new HttpError(400, "Diese Art von Datei gibt es nicht.");
  const m = ftsMatch(String(q.q ?? "").slice(0, 200));
  const where = ["d.owner_id = ?", "d.deleted_at IS NULL"], args: any[] = [owner];
  if (q.kind) { where.push("d.kind = ?"); args.push(q.kind); }
  let rows: any[];
  if (m) {
    const off = /^o(\d+)$/.exec(q.cursor ?? "");
    if (q.cursor && !off) throw new HttpError(400, "Ungültiger Cursor.");
    const o = off ? Number(off[1]) : 0;
    rows = db.query(`SELECT ${COLS_DOC_SUMMARY} FROM doc_fts JOIN doc d ON d.id = doc_fts.rowid WHERE doc_fts MATCH ? AND ${where.join(" AND ")} ORDER BY rank, d.modified_at DESC, d.id DESC LIMIT ? OFFSET ?`)
      .all(m, ...args, limit + 1, o) as any[];
    const more = rows.length > limit;
    return { docs: rows.slice(0, limit).map(r => summary(r)), next: more ? `o${o + limit}` : null };
  }
  const c = /^(\d+):(\d+)$/.exec(q.cursor ?? "");
  if (q.cursor && !c) throw new HttpError(400, "Ungültiger Cursor.");
  if (c) { where.push("(d.modified_at, d.id) < (?, ?)"); args.push(Number(c[1]), Number(c[2])); }
  rows = db.query(`SELECT ${COLS_DOC_SUMMARY} FROM doc d WHERE ${where.join(" AND ")} ORDER BY d.modified_at DESC, d.id DESC LIMIT ?`).all(...args, limit + 1) as any[];
  const more = rows.length > limit, page = rows.slice(0, limit);
  return { docs: page.map(r => summary(r)), next: more ? `${page[page.length - 1].modified_at}:${page[page.length - 1].id}` : null };
}
/** Up to 12 files of the given libraries whose title or text match the words. Files of another library than `viewer`'s carry their owner. */
export function searchDocs(owners: number[], words: string, viewer: number): DocSummary[] {
  const m = ftsMatch(words);
  if (!m) return [];
  return (db.query(`SELECT ${COLS_DOC_SUMMARY} FROM doc_fts JOIN doc d ON d.id = doc_fts.rowid WHERE doc_fts MATCH ? AND d.owner_id IN ${ids(owners)} AND d.deleted_at IS NULL ORDER BY rank, d.modified_at DESC LIMIT 12`)
    .all(m, ...owners) as any[]).map(r => summary(r, viewer));
}

/* ---------- small writes ---------- */
function indexRow(id: number, title: string, text: string | null) {
  db.query("DELETE FROM doc_fts WHERE rowid = ?").run(id);
  db.query("INSERT INTO doc_fts (rowid, title, text) VALUES (?, ?, ?)").run(id, title, text ?? "");
}
export function rename(owner: number, id: number, title: unknown): DocSummary {
  const t = String(title ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (!t) throw new HttpError(400, "Der Titel fehlt.");
  if (t.length > 200) throw new HttpError(400, "Der Titel ist zu lang (höchstens 200 Zeichen).");
  const r = db.query("UPDATE doc SET title = ? WHERE id = ? AND owner_id = ? RETURNING text").get(t, id, owner) as { text: string | null } | null;
  if (!r) throw new HttpError(404, "Das gibt es nicht (mehr).");
  indexRow(id, t, r.text);
  return summaryById(owner, id)!;
}
export function softDelete(owner: number, id: number, restore = false) {
  if (!db.query("UPDATE doc SET deleted_at = ? WHERE id = ? AND owner_id = ?").run(restore ? null : now(), id, owner).changes) throw new HttpError(404, "Das gibt es nicht (mehr).");
}
/** Files deleted more than `olderThanMs` ago go for good: original, derived files, rows. Files another row still uses stay. */
export function purgeDocs(olderThanMs = 30 * 86400_000): number {
  const rows = db.query("SELECT id, sha256, orig_path FROM doc WHERE deleted_at IS NOT NULL AND deleted_at < ?").all(now() - olderThanMs) as { id: number; sha256: string; orig_path: string }[];
  for (const r of rows) {
    if (!db.query("SELECT 1 FROM doc WHERE orig_path = ? AND id != ?").get(r.orig_path, r.id)) rmSync(join(ORIGINALS, r.orig_path), { force: true });
    if (!db.query("SELECT 1 FROM doc WHERE sha256 = ? AND id != ?").get(r.sha256, r.id)) {
      let names: string[] = [];
      try { names = readdirSync(derivedDir(r.sha256)); } catch { /* never rendered */ }
      for (const f of names) if (f.startsWith(r.sha256 + ".") || f.startsWith(r.sha256 + "-")) rmSync(join(derivedDir(r.sha256), f), { force: true });
    }
    db.query("DELETE FROM doc_fts WHERE rowid = ?").run(r.id);
    db.query("DELETE FROM doc WHERE id = ?").run(r.id);
  }
  return rows.length;
}

/* ---------- ingest: the row and the original ---------- */
export type DocIn = { owner: number; sha: string; tmp: string; bytes: number; name: string | null; mtime: number | null; source: string; deviceId: number | null; type: DocType;
  /** undefined: the client named no folder; null: the top of the Ablage */
  folderId: number | null | undefined };
/** The upload is verified and sniffed: store the original, insert the row (pending) and queue the render. A known file keeps its
 *  row and goes into the folder only if it had none. */
export function ingestDoc(i: DocIn): { id: number; duplicate: boolean } {
  const have = db.query("SELECT id, folder_id FROM doc WHERE owner_id = ? AND sha256 = ?").get(i.owner, i.sha) as { id: number; folder_id: number | null } | null;
  if (have) {
    rmSync(i.tmp, { force: true });
    if (i.folderId != null && have.folder_id == null) db.query("UPDATE doc SET folder_id = ? WHERE id = ?").run(i.folderId, have.id);
    return { id: have.id, duplicate: true };
  }
  const uploadedAt = now(), day = localDay(uploadedAt, null);
  const rel = `docs/${day.slice(0, 4)}/${day.slice(5, 7)}/${i.sha}.${i.type.format}`, dest = join(ORIGINALS, rel);
  if (existsSync(dest)) rmSync(i.tmp, { force: true }); else { mkdirSync(dirname(dest), { recursive: true }); place(i.tmp, dest); } // never overwrite an original
  // a mtime in the future or before 1990 is a broken clock, not a date (as chooseDate treats it)
  const modified = i.mtime && i.mtime > 631152000_000 && i.mtime < uploadedAt + 86400_000 ? i.mtime : uploadedAt;
  const name = i.name ? basename(i.name).slice(0, 200) : null, title = splitName(i.name).title.slice(0, 200);
  // 'other' files need no rendering: ok at once, a text file brings its text for search
  const other = i.type.kind === "other", isText = other && !!i.type.isText;
  const text = isText ? decodeText(readHeadSync(dest, TEXT_CAP)).slice(0, TEXT_CAP) : null;
  const row = db.query(`INSERT INTO doc (owner_id, sha256, kind, format, mime, bytes, title, orig_name, folder_id, modified_at, uploaded_at, source, device_id, orig_path, state, is_text, text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(i.owner, i.sha, i.type.kind, i.type.format, i.type.mime, i.bytes, title, name, i.folderId ?? null, modified, uploadedAt, i.source, i.deviceId, rel, other ? "ok" : "pending", isText ? 1 : 0, text) as { id: number };
  indexRow(row.id, title, text);
  if (!other) queueRender(row.id);
  return { id: row.id, duplicate: false };
}

/* ---------- rendering ---------- */
const queueRender = (id: number) => { void enqueue(() => renderDoc(id)).catch(() => {}); };

/** Startup: render what is still pending, one at a time, so a photo ingest can slip in between. Leftover work dirs go. */
export async function sweepDocs(): Promise<number> {
  try { for (const f of readdirSync(join(DATA, "up"))) if (f.startsWith("doc-")) rmSync(join(DATA, "up", f), { recursive: true, force: true }); } catch { /* no up dir yet */ }
  // sheets from before the NDJSON storage have no -s0.ndjson: they are rendered again (renderSheet drops the old .json files)
  for (const r of db.query("SELECT id, sha256 FROM doc WHERE kind = 'sheet' AND state = 'ok'").all() as { id: number; sha256: string }[])
    if (!existsSync(derived(r.sha256, "-s0.ndjson"))) db.query("UPDATE doc SET state = 'pending' WHERE id = ?").run(r.id);
  const list = (db.query("SELECT id FROM doc WHERE state = 'pending' ORDER BY id").all() as { id: number }[]).map(r => r.id);
  for (const id of list) { try { await enqueue(() => renderDoc(id)); } catch (e) { console.error(`sweep doc ${id}:`, (e as Error).message); } }
  return list.length;
}

const loDir = () => resolve(DATA, "lo");
/** One soffice run. A timeout kills the whole program, not only the wrapper script, or the next job would wait for it. */
async function soffice(args: string[]): Promise<string> {
  try {
    return await runText([SOFFICE, `-env:UserInstallation=${Bun.pathToFileURL(loDir()).href}`, "--headless", "--norestore", ...args], SOFFICE_MS, { HOME: process.env.HOME ?? resolve(DATA) });
  } catch (e) {
    if (/timeout/.test((e as Error).message)) {
      const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await run(["pkill", "-9", "-f", `UserInstallation=.*${esc(loDir())}`], 10_000).catch(() => {});
      // the program itself, wherever MONET_SOFFICE points (soffice.bin lives beside the wrapper)
      if (isAbsolute(SOFFICE)) { let bin = SOFFICE; try { bin = realpathSync(SOFFICE); } catch { /* as given */ } await run(["pkill", "-9", "-f", esc(dirname(bin)) + "/"], 10_000).catch(() => {}); }
    }
    throw e;
  }
}
const vipsInt = async (field: string, file: string) => Number((await runText(["vipsheader", "-f", field, file], 30_000, VIPS_ENV)).trim());
async function vipsWebp(input: string, out: string, size: string, q = 80) {
  mkdirSync(dirname(out), { recursive: true });
  const tmp = out.replace(/\.webp$/, ".part.webp");
  await run(["vipsthumbnail", input, "-s", size, "-o", `${tmp}[Q=${q},strip]`], 120_000, VIPS_ENV);
  renameSync(tmp, out);
}
async function readHead(path: string, max: number): Promise<Uint8Array> { return new Uint8Array(await Bun.file(path).slice(0, max).arrayBuffer()); }

type Rendered = { kind: DocKind; pages: number | null; w: number; h: number; text: string | null; sheets: string | null;
  by?: string | null; album?: string | null; track?: number | null; durationMs?: number | null; book?: string | null;
  /** a title from the file's own tags; it replaces the title only when the file still carries the title its name gave it */
  title?: string | null };

/** Everything for one pending file (docs/files.md, "Rendering"). A failure marks the row failed; the original stays. */
export async function renderDoc(id: number) {
  const d = rowById(id);
  if (!d || d.state !== "pending") return;
  const work = join(DATA, "up", `doc-${d.sha256}-${id}`);
  try {
    mkdirSync(work, { recursive: true });
    const r = d.kind === "sheet" ? await renderSheet(d, work) : d.kind === "book" ? await renderBook(d, work) : d.kind === "audio" ? await renderAudio(d, work)
      : d.kind === "other" ? { kind: "other", pages: null, w: 0, h: 0, text: null, sheets: null } satisfies Rendered : await renderPages(d, work);
    const named = splitName(d.orig_name).title, tag = r.title?.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200) || null;
    db.query(`UPDATE doc SET state = 'ok', error = NULL, kind = ?, pages = ?, width = ?, height = ?, text = ?, sheets = ?, by_name = ?, album = ?, track = ?, duration_ms = ?, book = ?,
      title = CASE WHEN ? IS NOT NULL AND title = ? THEN ? ELSE title END WHERE id = ?`)
      .run(r.kind, r.pages, r.w, r.h, r.text, r.sheets, r.by ?? null, r.album ?? null, r.track ?? null, r.durationMs ?? null, r.book ?? null, tag, named, tag, id);
    // the title is read again: a rename while the file was being rendered must not be undone in the search index
    indexRow(id, (db.query("SELECT title FROM doc WHERE id = ?").get(id) as { title: string }).title, r.text);
  } catch (e) {
    console.error(`render doc ${id} (${d.title}.${d.format}):`, (e as Error).message);
    db.query("UPDATE doc SET state = 'failed', error = ? WHERE id = ?").run(FAILED, id);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

async function renderPages(d: Row, work: string): Promise<Rendered> {
  mkdirSync(derivedDir(d.sha256), { recursive: true });
  const orig = join(ORIGINALS, d.orig_path);
  let text: string | null = null, pdf = orig;
  if (d.format !== "pdf") {
    let src = join(work, `${d.sha256}.${d.format}`);
    if (TEXT_FORMATS.has(d.format)) {
      // plain text is decoded here (UTF-8 or windows-1252) and handed over as UTF-8 with a BOM, which soffice reads for sure
      text = decodeText(await readHead(orig, 4 << 20));
      src = join(work, `${d.sha256}.txt`);
      await Bun.write(src, "﻿" + text);
    } else symlinkSync(resolve(orig), src); // soffice needs the real extension
    await soffice(["--convert-to", "pdf", "--outdir", work, src]);
    const out = join(work, `${d.sha256}.pdf`);
    if (!existsSync(out)) throw new Error("soffice wrote no pdf");
    pdf = derived(d.sha256, ".pdf");
    place(out, pdf);
  }
  const pages = await vipsInt("n-pages", pdf), w = await vipsInt("width", pdf), h = await vipsInt("height", pdf);
  if (!(pages >= 1) || !(w > 0) || !(h > 0)) throw new Error(`pdf has ${pages} pages, ${w}x${h}`);
  await vipsWebp(`${pdf}[page=0]`, derived(d.sha256, "-c.webp"), "480x");
  if (text == null) {
    // search text is a help: a missing pdftotext or a pdf without text does not fail the file
    try { text = new TextDecoder().decode(await run(["pdftotext", "-l", "200", "-enc", "UTF-8", pdf, "-"], 60_000)); } catch (e) { console.error(`pdftotext ${d.id}:`, (e as Error).message); }
  }
  // the kind of a PDF is fixed after the first page is known: wider than tall is a presentation
  return { kind: d.format === "pdf" ? (w > h ? "slides" : "doc") : d.kind, pages, w, h, text: text == null ? null : text.slice(0, TEXT_CAP), sheets: null };
}

/** The webp cover of a picture file (480 px wide) and its size; null when the picture cannot be read (the file is complete without a cover). */
async function coverFrom(d: Row, picture: string): Promise<{ w: number; h: number } | null> {
  try {
    const out = derived(d.sha256, "-c.webp");
    await vipsWebp(picture, out, "480x>"); // never enlarged
    return { w: await vipsInt("width", out), h: await vipsInt("height", out) };
  } catch (e) { console.error(`cover of doc ${d.id}:`, (e as Error).message); return null; }
}

async function renderBook(d: Row, work: string): Promise<Rendered> {
  mkdirSync(derivedDir(d.sha256), { recursive: true });
  const r = withSource(join(ORIGINALS, d.orig_path), src => {
    const map = entryMap(src), book = map && parseBook(src, map);
    if (!map || !book) return null;
    const ce = book.cover ? map.get(book.cover) : undefined;
    return { book, text: bookText(src, map, book.spine.map(s => s.href), TEXT_CAP), cover: ce ? zipRead(src, ce) : null };
  });
  if (!r) throw new Error("not a readable epub");
  let size: { w: number; h: number } | null = null;
  if (r.cover) {
    const pic = join(work, "cover" + (/\.[A-Za-z0-9]{1,5}$/.exec(r.book.cover!)?.[0] ?? ""));
    await Bun.write(pic, r.cover);
    size = await coverFrom(d, pic);
  }
  // no cover: 0 x 0, so the client draws one instead of asking for a picture that is not there
  return { kind: "book", pages: r.book.spine.length, w: size?.w ?? 0, h: size?.h ?? 0, text: r.text, sheets: null, by: r.book.by, title: r.book.name,
    book: JSON.stringify({ spine: r.book.spine, toc: r.book.toc }) };
}

const COVER_EXT: Record<string, string> = { mjpeg: "jpg", png: "png", bmp: "bmp", gif: "gif", webp: "webp", tiff: "tif" };
async function renderAudio(d: Row, work: string): Promise<Rendered> {
  mkdirSync(derivedDir(d.sha256), { recursive: true });
  const orig = join(ORIGINALS, d.orig_path);
  const probe = JSON.parse(await runText(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", orig], 60_000));
  const streams: any[] = probe.streams ?? [], audio = streams.filter(s => s.codec_type === "audio");
  if (!audio.length) throw new Error("no audio stream");
  // tag keys come in any case (ID3 "TITLE", Vorbis "title", MP4 "Title"); the container's tags first, then the audio streams'
  const tags: Record<string, string> = {};
  for (const t of [probe.format?.tags, ...audio.map(s => s.tags)]) for (const [k, v] of Object.entries(t ?? {})) {
    const key = k.toLowerCase();
    if (typeof v === "string" && v.trim() && !(key in tags)) tags[key] = v.trim();
  }
  const secs = Number(probe.format?.duration ?? audio[0].duration);
  const track = parseInt(tags.track ?? tags.tracknumber ?? "", 10); // "3/12" is track 3
  let size: { w: number; h: number } | null = null;
  const pic = streams.find(s => s.codec_type === "video" && COVER_EXT[s.codec_name]);
  if (pic) {
    const img = join(work, `cover.${COVER_EXT[pic.codec_name]}`);
    try {
      await run(["ffmpeg", "-v", "error", "-y", "-i", orig, "-an", "-c:v", "copy", "-frames:v", "1", "-update", "1", img], 60_000);
      size = await coverFrom(d, img);
    } catch (e) { console.error(`cover art of doc ${d.id}:`, (e as Error).message); }
  }
  const artist = tags.artist ?? tags.album_artist ?? tags.albumartist ?? null;
  return { kind: "audio", pages: null, w: size?.w ?? 0, h: size?.h ?? 0, sheets: null, title: tags.title ?? null, by: artist, album: tags.album ?? null,
    track: Number.isInteger(track) && track > 0 ? track : null, durationMs: secs > 0 && Number.isFinite(secs) ? Math.round(secs * 1000) : null,
    text: [tags.title, artist, tags.album].filter(Boolean).join(" ").slice(0, TEXT_CAP) || null };
}

/* ---------- sheets: NDJSON on disk ---------- */
const IDX_STEP = 256; // the .idx file holds the byte offset of every 256th row
/** Writes one sheet as `<sha>-s<i>.ndjson` (a JSON array per row, trailing empty cells cut) and `.idx` (float64 LE offsets), row by row:
 *  the grid is never in memory. Padding to `cols` happens when a window is read. */
class SheetOut {
  rows = 0; cols = 0; truncated = false; head: string[][] = []; parts: string[] = [];
  private fd: number; private buf = ""; private off = 0; private empty = 0; private idx: number[] = []; private textSize = 0;
  constructor(private path: string) { this.fd = openSync(path + ".part", "w"); }
  private line(s: string) {
    if (this.rows % IDX_STEP === 0) this.idx.push(this.off + Buffer.byteLength(this.buf));
    this.buf += s + "\n"; this.rows++;
    if (this.buf.length > 1 << 20) this.flush();
  }
  private flush() { writeSync(this.fd, this.buf); this.off += Buffer.byteLength(this.buf); this.buf = ""; }
  /** one parsed row; false: nothing more is wanted */
  add(raw: string[]): boolean {
    let w = raw.length;
    while (w > 0 && raw[w - 1] === "") w--;
    if (this.rows + this.empty >= SHEET_MAX_ROWS) { if (w > 0) { this.truncated = true; return false; } return true; }
    if (w === 0) { this.empty++; return true; } // trailing empty rows are dropped: they are written only when a full one follows
    if (w > SHEET_MAX_COLS) { this.truncated = true; w = SHEET_MAX_COLS; }
    const row = w < raw.length ? raw.slice(0, w) : raw;
    for (; this.empty > 0; this.empty--) { if (this.rows < 10) this.head.push([]); this.line("[]"); }
    if (w > this.cols) this.cols = w;
    if (this.rows < 10) this.head.push(row);
    for (const c of row) if (c && this.textSize < TEXT_CAP) { this.parts.push(c); this.textSize += c.length + 1; }
    this.line(JSON.stringify(row));
    return true;
  }
  /** closes the files; the sheet is only there under its real names from now on */
  done() {
    this.flush(); closeSync(this.fd);
    writeFileSync(this.path.replace(/\.ndjson$/, ".idx.part"), new Uint8Array(new Float64Array(this.idx).buffer));
    renameSync(this.path.replace(/\.ndjson$/, ".idx.part"), this.path.replace(/\.ndjson$/, ".idx"));
    renameSync(this.path + ".part", this.path);
  }
  abort() { try { closeSync(this.fd); } catch { /* closed */ } rmSync(this.path + ".part", { force: true }); }
}

/** One CSV file into `out`, in 1 MiB pieces: valid UTF-8 as a whole is read as UTF-8, else as windows-1252. */
async function csvToSheet(path: string, out: SheetOut, delim: string | null, format: string) {
  const f = Bun.file(path), size = Math.min(f.size, CSV_READ_MAX), CH = 1 << 20;
  if (f.size > CSV_READ_MAX) out.truncated = true;
  const piece = async (o: number) => new Uint8Array(await f.slice(o, Math.min(o + CH, size)).arrayBuffer());
  let utf8 = true;
  try { const v = new TextDecoder("utf-8", { fatal: true }); for (let o = 0; o < size; o += CH) v.decode(await piece(o), { stream: true }); } catch { utf8 = false; }
  const dec = new TextDecoder(utf8 ? "utf-8" : "windows-1252");
  let reader: CsvReader | null = null;
  for (let o = 0; o < size && !reader?.stopped; o += CH) {
    const text = dec.decode(await piece(o), { stream: true });
    reader ??= new CsvReader(delim ?? detectDelimiter(text, format), r => out.add(r));
    reader.feed(text);
    Bun.gc(true); // the rows of the piece are garbage by now: a collector left alone let them pile up to 100 MB per 4 MiB
  }
  reader?.end();
}

async function renderSheet(d: Row, work: string): Promise<Rendered> {
  mkdirSync(derivedDir(d.sha256), { recursive: true });
  const orig = join(ORIGINALS, d.orig_path);
  const sources: { name: string; path: string; delim: string | null }[] = [];
  if (d.format === "csv" || d.format === "tsv") sources.push({ name: "Tabelle 1", path: orig, delim: null });
  else {
    const src = join(work, `${d.sha256}.${d.format}`), out = join(work, "csv");
    mkdirSync(out);
    symlinkSync(resolve(orig), src);
    const log = await soffice(["--convert-to", SHEET_CSV_FILTER, "--outdir", out, src]);
    // "Writing sheet <name> -> <path>" per sheet, in the order of the workbook
    let files = log.split(/\r?\n/).flatMap(l => {
      const k = l.startsWith("Writing sheet ") ? l.lastIndexOf(" -> ") : -1;
      return k >= 0 ? [{ name: l.slice("Writing sheet ".length, k), path: l.slice(k + 4).trim() }] : [];
    });
    if (!files.length) files = readdirSync(out).filter(f => f.endsWith(".csv")).sort().map(f => ({ name: f.replace(/\.csv$/, ""), path: join(out, f) }));
    if (!files.length) throw new Error("soffice wrote no csv");
    for (const f of files.slice(0, 100)) {
      if (!existsSync(f.path)) throw new Error(`missing sheet file ${f.path}`);
      sources.push({ name: f.name || "Tabelle", path: f.path, delim: "," });
    }
  }
  const outs: SheetOut[] = [], parts: string[] = [];
  let size = 0;
  try {
    for (let i = 0; i < sources.length; i++) {
      const o = new SheetOut(derived(d.sha256, `-s${i}.ndjson`));
      outs.push(o);
      await csvToSheet(sources[i].path, o, sources[i].delim, d.format);
      o.done();
      for (const c of o.parts) if (size < TEXT_CAP) { parts.push(c); size += c.length + 1; }
      o.parts = [];
    }
  } catch (e) { for (const o of outs) o.abort(); throw e; }
  // sheets made before the NDJSON storage left -s<i>.json files
  for (const f of readdirSync(derivedDir(d.sha256))) if (f.startsWith(d.sha256 + "-s") && f.endsWith(".json")) rmSync(join(derivedDir(d.sha256), f), { force: true });
  // the cover is a nicety: without svg support in libvips the sheet is still complete
  try {
    const svg = join(work, "cover.svg");
    await Bun.write(svg, sheetSvg(outs[0].head));
    await vipsWebp(svg, derived(d.sha256, "-c.webp"), "480x");
  } catch (e) { console.error(`cover of sheet ${d.id}:`, (e as Error).message); }
  return { kind: "sheet", pages: null, w: 4, h: 3, text: parts.join(" ").slice(0, TEXT_CAP),
    sheets: JSON.stringify(outs.map((o, i) => ({ name: sources[i].name, rows: o.rows, cols: o.cols, truncated: o.truncated }))) };
}

/* ---------- pages on demand ---------- */
const inflight = new Map<string, Promise<string | null>>();
/** The webp of page `n` (1-based): `p` 1600 px wide, `t` 320. Made when first asked for, one at a time, and two requests for the
 *  same page render it once. null: no such page (or none can be made). */
export async function pageFile(d: Row, k: "p" | "t", n: number): Promise<string | null> {
  if (d.state !== "ok" || d.kind === "sheet" || !d.pages || !Number.isInteger(n) || n < 1 || n > d.pages) return null;
  const out = derived(d.sha256, `-${k}${n}.webp`);
  if (existsSync(out)) return out;
  const pdf = pdfOf(d);
  if (!existsSync(pdf)) return null;
  let p = inflight.get(out);
  if (!p) {
    p = enqueue(async () => { if (!existsSync(out)) await vipsWebp(`${pdf}[page=${n - 1}]`, out, k === "p" ? "1600x" : "320x"); return out; })
      .catch((e): null => { console.error(`page ${n} of doc ${d.id}:`, (e as Error).message); return null; })
      .finally(() => inflight.delete(out));
    inflight.set(out, p);
  }
  return p;
}

/* ---------- sheets ---------- */
/** rows [from, from + n) of sheet i, n at most 1000: read from the NDJSON by seeking to the nearest indexed row before `from` */
export async function sheetRows(d: Row, i: number, from: number, n: number): Promise<SheetRows> {
  const meta = json<{ rows: number; cols: number }[]>(d.sheets, []);
  if (d.state !== "ok" || d.kind !== "sheet" || !Number.isInteger(i) || i < 0 || i >= meta.length) throw new HttpError(404, "Das gibt es nicht (mehr).");
  const a = Math.max(0, Math.floor(from) || 0), len = Math.max(1, Math.min(1000, Math.floor(n) || 200));
  const end = Math.min(meta[i].rows, a + len), base = derived(d.sha256, `-s${i}`);
  const idxFile = Bun.file(base + ".idx"), data = Bun.file(base + ".ndjson");
  if (a >= end || !(await idxFile.exists())) return { from: a, rows: [] };
  const idx = new Float64Array(await idxFile.arrayBuffer()), block = Math.floor(a / IDX_STEP), skip = a - block * IDX_STEP, need = end - block * IDX_STEP;
  if (!(block < idx.length)) return { from: a, rows: [] };
  // read pieces from the block's first row until `need` lines are in
  const pieces: Buffer[] = [];
  let at = idx[block], lines = 0;
  while (lines < need && at < data.size) {
    const b = Buffer.from(await data.slice(at, at + (256 << 10)).arrayBuffer());
    if (!b.length) break;
    pieces.push(b); at += b.length;
    for (let k = b.indexOf(10); k >= 0 && lines < need; k = b.indexOf(10, k + 1)) lines++;
  }
  const all = Buffer.concat(pieces), rows: string[][] = [];
  for (let start = 0, k = 0; k < need && start < all.length; k++) {
    let e = all.indexOf(10, start);
    if (e < 0) e = all.length;
    if (k >= skip) {
      const r = JSON.parse(all.toString("utf8", start, e)) as string[];
      while (r.length < meta[i].cols) r.push("");
      rows.push(r);
    }
    start = e + 1;
  }
  return { from: a, rows };
}

/* ---------- books ---------- */
export const bookOf = (d: Row): BookOut | null => json<BookOut | null>(d.book, null);
const zipCache = new Map<string, Map<string, ZipEntry>>(); // the directories of the last few books
/** One entry of a book's zip by the path of the URL (percent-escapes decoded, `..` and absolute paths refused): its name and a reader that inflates it. */
export function bookEntry(d: Row, raw: string): { name: string; read: () => Uint8Array | null } | null {
  let path: string;
  try { path = decodeURIComponent(raw); } catch { return null; }
  if (path.startsWith("/") || path.includes("\0")) return null;
  const parts = path.split("/").filter(p => p !== "" && p !== ".");
  if (!parts.length || parts.includes("..")) return null;
  const name = parts.join("/"), file = join(ORIGINALS, d.orig_path);
  let map = zipCache.get(d.sha256);
  if (!map) {
    if (!existsSync(file)) return null;
    map = withSource(file, src => entryMap(src)) ?? undefined;
    if (!map) return null;
    zipCache.set(d.sha256, map);
    while (zipCache.size > 8) zipCache.delete(zipCache.keys().next().value!);
  }
  const z = map.get(name);
  return z ? { name, read: () => withSource(file, src => zipRead(src, z)) } : null;
}

/* ---------- text ---------- */
/** The decoded text of txt, md, tex, csv and tsv files and of 'other' files that read as text (at most 8 MiB). null for every other file. */
export async function textOf(d: Row): Promise<string | null> {
  if (d.kind === "other" ? !d.is_text : !TEXT_FORMATS.has(d.format)) return null;
  const p = join(ORIGINALS, d.orig_path);
  return existsSync(p) ? decodeText(await readHead(p, 8 << 20)) : null;
}

export const counts = (owner: number) => db.query("SELECT count(*) AS n, coalesce(sum(state = 'pending'), 0) AS pending FROM doc WHERE owner_id = ? AND deleted_at IS NULL").get(owner) as { n: number; pending: number };
