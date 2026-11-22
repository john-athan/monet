// Files: documents, sheets and slides (docs/files.md). The row of an upload, the render queue, pages on demand, sheets,
// covers, text, list and detail, rename, soft delete, purge. Scoped by owner_id; nothing here knows HTTP routes.
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { db } from "./db";
import { decodeText, detectDelimiter, parseCsv, sheetSvg, SHEET_MAX_ROWS, splitName, TEXT_FORMATS, toGrid, type DocType } from "./docsniff";
import { DATA, enqueue, ORIGINALS } from "./ingest";
import { HttpError, json, localDay, now, run, runText } from "./util";
import type { DocDetail, DocKind, DocList, DocSummary, SheetRows } from "../shared/types";

const VIPS_ENV = { VIPS_CONCURRENCY: "1" };
const FAILED = "Diese Datei konnte nicht aufbereitet werden.";
const TEXT_CAP = 512 * 1024; // what doc.text keeps for search
const CSV_READ_MAX = 64 << 20;
const SOFFICE_MS = 180_000;
const SHEET_CSV_FILTER = "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1";

/* ---------- paths ---------- */
const derivedDir = (sha: string) => join(DATA, "d", sha.slice(0, 2));
/** suffix: ".pdf", "-c.webp", "-p3.webp", "-t3.webp", "-s0.json" */
export const derived = (sha: string, suffix: string) => join(derivedDir(sha), `${sha}${suffix}`);
type Row = { id: number; owner_id: number; sha256: string; kind: DocKind; format: string; mime: string; bytes: number; title: string; orig_name: string | null; folder_id: number | null;
  pages: number | null; width: number; height: number; modified_at: number; uploaded_at: number; orig_path: string; state: "pending" | "ok" | "failed"; error: string | null; sheets: string | null; deleted_at: number | null };
export const pdfOf = (d: Pick<Row, "sha256" | "format" | "orig_path">) => d.format === "pdf" ? join(ORIGINALS, d.orig_path) : derived(d.sha256, ".pdf");
function place(from: string, to: string) {
  mkdirSync(dirname(to), { recursive: true });
  try { renameSync(from, to); } catch (e: any) { if (e.code !== "EXDEV") throw e; copyFileSync(from, to); rmSync(from); }
}

/* ---------- rows ---------- */
export const COLS_DOC_SUMMARY = "d.id, d.owner_id, d.kind, d.format, d.title, d.bytes, d.pages, d.width, d.height, d.modified_at, d.state, d.folder_id";
export function summary(r: any, viewer?: number): DocSummary {
  const s: DocSummary = { id: r.id, kind: r.kind, title: r.title, format: r.format, bytes: r.bytes, pages: r.pages, w: r.width, h: r.height, modifiedAt: r.modified_at, state: r.state, folderId: r.folder_id };
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
  if (q.kind && !["doc", "sheet", "slides"].includes(q.kind)) throw new HttpError(400, "Diese Art von Datei gibt es nicht.");
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
  const row = db.query(`INSERT INTO doc (owner_id, sha256, kind, format, mime, bytes, title, orig_name, folder_id, modified_at, uploaded_at, source, device_id, orig_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(i.owner, i.sha, i.type.kind, i.type.format, i.type.mime, i.bytes, title, name, i.folderId ?? null, modified, uploadedAt, i.source, i.deviceId, rel) as { id: number };
  indexRow(row.id, title, null);
  queueRender(row.id);
  return { id: row.id, duplicate: false };
}

/* ---------- rendering ---------- */
const queueRender = (id: number) => { void enqueue(() => renderDoc(id)).catch(() => {}); };

/** Startup: render what is still pending, one at a time, so a photo ingest can slip in between. Leftover work dirs go. */
export async function sweepDocs(): Promise<number> {
  try { for (const f of readdirSync(join(DATA, "up"))) if (f.startsWith("doc-")) rmSync(join(DATA, "up", f), { recursive: true, force: true }); } catch { /* no up dir yet */ }
  const list = (db.query("SELECT id FROM doc WHERE state = 'pending' ORDER BY id").all() as { id: number }[]).map(r => r.id);
  for (const id of list) { try { await enqueue(() => renderDoc(id)); } catch (e) { console.error(`sweep doc ${id}:`, (e as Error).message); } }
  return list.length;
}

const loDir = () => resolve(DATA, "lo");
/** One soffice run. A timeout kills the whole program, not only the wrapper script, or the next job would wait for it. */
async function soffice(args: string[]): Promise<string> {
  try {
    return await runText(["soffice", `-env:UserInstallation=${Bun.pathToFileURL(loDir()).href}`, "--headless", "--norestore", ...args], SOFFICE_MS, { HOME: process.env.HOME ?? resolve(DATA) });
  } catch (e) {
    if (/timeout/.test((e as Error).message)) await run(["pkill", "-9", "-f", `UserInstallation=.*${loDir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`], 10_000).catch(() => {});
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

type Rendered = { kind: DocKind; pages: number | null; w: number; h: number; text: string | null; sheets: string | null };

/** Everything for one pending file (docs/files.md, "Rendering"). A failure marks the row failed; the original stays. */
export async function renderDoc(id: number) {
  const d = rowById(id);
  if (!d || d.state !== "pending") return;
  const work = join(DATA, "up", `doc-${d.sha256}-${id}`);
  try {
    mkdirSync(work, { recursive: true });
    const r = d.kind === "sheet" ? await renderSheet(d, work) : await renderPages(d, work);
    db.query("UPDATE doc SET state = 'ok', error = NULL, kind = ?, pages = ?, width = ?, height = ?, text = ?, sheets = ? WHERE id = ?").run(r.kind, r.pages, r.w, r.h, r.text, r.sheets, id);
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

async function renderSheet(d: Row, work: string): Promise<Rendered> {
  mkdirSync(derivedDir(d.sha256), { recursive: true });
  const orig = join(ORIGINALS, d.orig_path);
  const grids: { name: string; g: ReturnType<typeof toGrid> }[] = [];
  if (d.format === "csv" || d.format === "tsv") {
    const text = decodeText(await readHead(orig, CSV_READ_MAX));
    const g = toGrid(parseCsv(text, detectDelimiter(text, d.format), SHEET_MAX_ROWS + 1));
    if (d.bytes > CSV_READ_MAX) g.truncated = true;
    grids.push({ name: "Tabelle 1", g });
  } else {
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
      grids.push({ name: f.name || "Tabelle", g: toGrid(parseCsv(decodeText(await readHead(f.path, CSV_READ_MAX)), ",", SHEET_MAX_ROWS + 1)) });
    }
  }
  const parts: string[] = [];
  let size = 0;
  for (let i = 0; i < grids.length; i++) {
    const { rows } = grids[i].g;
    const p = derived(d.sha256, `-s${i}.json`), tmp = p + ".part";
    await Bun.write(tmp, JSON.stringify(rows)); renameSync(tmp, p);
    for (const r of rows) for (const c of r) if (c && size < TEXT_CAP) { parts.push(c); size += c.length + 1; }
  }
  // the cover is a nicety: without svg support in libvips the sheet is still complete
  try {
    const svg = join(work, "cover.svg");
    await Bun.write(svg, sheetSvg(grids[0].g.rows));
    await vipsWebp(svg, derived(d.sha256, "-c.webp"), "480x");
  } catch (e) { console.error(`cover of sheet ${d.id}:`, (e as Error).message); }
  return { kind: "sheet", pages: null, w: 4, h: 3, text: parts.join(" ").slice(0, TEXT_CAP),
    sheets: JSON.stringify(grids.map(x => ({ name: x.name, rows: x.g.rows.length, cols: x.g.cols, truncated: x.g.truncated }))) };
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
const sheetCache = new Map<string, string[][]>(); // the last two parsed sheet files
async function loadSheet(sha: string, i: number): Promise<string[][] | null> {
  const p = derived(sha, `-s${i}.json`);
  const hit = sheetCache.get(p);
  if (hit) { sheetCache.delete(p); sheetCache.set(p, hit); return hit; }
  if (!existsSync(p)) return null;
  const rows = JSON.parse(await Bun.file(p).text()) as string[][];
  sheetCache.set(p, rows);
  while (sheetCache.size > 2) sheetCache.delete(sheetCache.keys().next().value!);
  return rows;
}
/** rows [from, from + n) of sheet i, n at most 1000 */
export async function sheetRows(d: Row, i: number, from: number, n: number): Promise<SheetRows> {
  const meta = json<unknown[]>(d.sheets, []);
  if (d.state !== "ok" || d.kind !== "sheet" || !Number.isInteger(i) || i < 0 || i >= meta.length) throw new HttpError(404, "Das gibt es nicht (mehr).");
  const rows = (await loadSheet(d.sha256, i)) ?? [];
  const a = Math.max(0, Math.floor(from) || 0), len = Math.max(1, Math.min(1000, Math.floor(n) || 200));
  return { from: a, rows: rows.slice(a, a + len) };
}

/* ---------- text ---------- */
/** The decoded text of txt, md, tex, csv and tsv (at most 8 MiB). null for every other format. */
export async function textOf(d: Row): Promise<string | null> {
  if (!TEXT_FORMATS.has(d.format)) return null;
  const p = join(ORIGINALS, d.orig_path);
  return existsSync(p) ? decodeText(await readHead(p, 8 << 20)) : null;
}

export const counts = (owner: number) => db.query("SELECT count(*) AS n, coalesce(sum(state = 'pending'), 0) AS pending FROM doc WHERE owner_id = ? AND deleted_at IS NULL").get(owner) as { n: number; pending: number };
