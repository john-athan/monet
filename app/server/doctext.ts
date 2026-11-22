// The text of a file's pages where it stands (docs/together.md, "Text on the page"): every line and word with its box,
// so the viewer can lay selectable text over the page images (and the browser's own find works), and so a search inside
// a file can say on which page and where. From the PDF's own text (`pdftotext -bbox-layout`), or, for a scan without
// text, from OCR of the page images (server/ocr-queue.ts). Stored as `<sha>-w.ndjson`, one JSON line per page:
// {l: [[x, y, w, h, text]], w: [[x, y, w, h, text]]}, boxes as fractions of the page (0..1, 4 digits).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { db } from "./db";
import { derived, pdfOf, reindexDoc, rowById, sheetRows } from "./docs";
import { fold } from "./parse";
import { HttpError, json, run } from "./util";
import type { FindOut } from "../shared/types";

export const WORDS_PAGES = 200;
/** A page with fewer letters than this in the PDF's text is a scan (or a picture): OCR reads it */
export const SCAN_CHARS = 20;
/** pages of a scan that OCR reads; the rest of a long scan stays without text */
export const OCR_PAGES = 30;

/** words_ok: 0 not yet, 1 from the PDF, 2 from OCR, 3 nothing to read (no pages, or OCR found nothing), 4 waiting for OCR */
export type Quad = [number, number, number, number, string];
export type PageText = { l: Quad[]; w: Quad[] };

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
/** Parses `pdftotext -bbox-layout` output into pages of lines and words. Pure. */
export function parseBbox(html: string): PageText[] {
  const pages: PageText[] = [];
  for (const pm of html.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)) {
    const W = +pm[1], H = +pm[2], page: PageText = { l: [], w: [] };
    const box = (a: string): [number, number, number, number] => {
      const v = (k: string) => +(new RegExp(`${k}="([\\d.-]+)"`).exec(a)?.[1] ?? 0);
      return [r4(v("xMin") / W), r4(v("yMin") / H), r4((v("xMax") - v("xMin")) / W), r4((v("yMax") - v("yMin")) / H)];
    };
    for (const lm of pm[3].matchAll(/<line ([^>]*)>([\s\S]*?)<\/line>/g)) {
      const words = [...lm[2].matchAll(/<word ([^>]*)>([^<]*)<\/word>/g)].map(m => [...box(m[1]), unescape(m[2])] as Quad);
      if (!words.length) continue;
      page.w.push(...words);
      page.l.push([...box(lm[1]), words.map(w => w[4]).join(" ")]);
    }
    pages.push(page);
  }
  return pages;
}
/** OCR lines (fractions of the page) as lines and words: a line's words share its box in proportion to their letters. */
export function fromOcr(lines: { x: number; y: number; w: number; h: number; t: string }[]): PageText {
  const page: PageText = { l: [], w: [] };
  for (const ln of lines) {
    const t = ln.t.replace(/\s+/g, " ").trim();
    if (!t) continue;
    page.l.push([r4(ln.x), r4(ln.y), r4(ln.w), r4(ln.h), t]);
    let at = 0;
    for (const word of t.split(" ")) {
      page.w.push([r4(ln.x + (at / t.length) * ln.w), r4(ln.y), r4((word.length / t.length) * ln.w), r4(ln.h), word]);
      at += word.length + 1;
    }
  }
  return page;
}
const letters = (p: PageText) => p.w.reduce((n, w) => n + (w[4].match(/\p{L}/gu)?.length ?? 0), 0);

function write(sha: string, pages: PageText[]) {
  const f = derived(sha, "-w.ndjson");
  writeFileSync(f + ".part", pages.map(p => JSON.stringify(p)).join("\n") + "\n");
  renameSync(f + ".part", f);
  cache.delete(sha);
}

/** The positions of a rendered document's or presentation's text. A scan goes to OCR (words_ok 4). */
export async function buildWords(id: number) {
  const d = rowById(id);
  if (!d || d.state !== "ok" || (d.kind !== "doc" && d.kind !== "slides") || !d.pages) {
    if (d) db.query("UPDATE doc SET words_ok = 3 WHERE id = ? AND words_ok = 0").run(id);
    return;
  }
  const pdf = pdfOf(d);
  if (!existsSync(pdf)) { db.query("UPDATE doc SET words_ok = 3 WHERE id = ?").run(id); return; }
  let pages: PageText[] = [];
  try { pages = parseBbox(new TextDecoder().decode(await run(["pdftotext", "-bbox-layout", "-l", String(WORDS_PAGES), "-enc", "UTF-8", pdf, "-"], 120_000))); }
  catch (e) { console.error(`words of doc ${id}:`, (e as Error).message); }
  const n = Math.min(d.pages, WORDS_PAGES);
  const scan = pages.length > 0 && pages.slice(0, n).reduce((s, p) => s + letters(p), 0) < SCAN_CHARS * n;
  write(d.sha256, pages);
  db.query("UPDATE doc SET words_ok = ? WHERE id = ?").run(scan ? 4 : 1, id);
}

/** OCR finished for a scan: its pages' lines (fractions), page by page. The text becomes the file's text for search. */
export function storeOcrWords(id: number, pages: { x: number; y: number; w: number; h: number; t: string }[][]): boolean {
  const d = rowById(id);
  if (!d) return false;
  const pt = pages.map(fromOcr);
  write(d.sha256, pt);
  const text = pt.map(p => p.l.map(l => l[4]).join("\n")).join("\n\n").trim();
  // a scan has fewer than SCAN_CHARS letters per page of its own: what OCR reads replaces it (also an earlier OCR's text)
  db.query("UPDATE doc SET words_ok = ?, text = coalesce(?, text) WHERE id = ?").run(text ? 2 : 3, text || null, id);
  reindexDoc(id);
  return !!text;
}

/* ---------- reading ---------- */
const cache = new Map<string, string[]>(); // the pages of the last few files, as JSON lines
function pagesOf(sha: string): string[] | null {
  let p = cache.get(sha);
  if (p) return p;
  const f = derived(sha, "-w.ndjson");
  if (!existsSync(f)) return null;
  p = readFileSync(f, "utf8").split("\n");
  if (p[p.length - 1] === "") p.pop();
  cache.set(sha, p);
  while (cache.size > 6) cache.delete(cache.keys().next().value!);
  return p;
}
/** The lines of page n (1-based) for the text layer; null when the file has no positions (yet). */
export function pageLines(id: number, n: number): Quad[] | null {
  const d = rowById(id);
  const p = d ? pagesOf(d.sha256) : null;
  if (!p || !Number.isInteger(n) || n < 1 || n > p.length) return null;
  return json<PageText>(p[n - 1], { l: [], w: [] }).l;
}

/* ---------- find ---------- */
export const FIND_MAX = 500;
const norm = (s: string) => fold(s).replace(/\s+/g, " ").trim();
/** The hits of `q` on one page: each a list of word boxes. Case, accents and ß do not matter; words may span lines. Pure. */
export function findOnPage(words: Quad[], q: string): [number, number, number, number][][] {
  const needle = norm(q);
  if (!needle) return [];
  let s = "";
  const starts: number[] = [];
  for (const w of words) { starts.push(s.length); s += norm(w[4]) + " "; }
  const out: [number, number, number, number][][] = [];
  for (let i = s.indexOf(needle); i >= 0 && out.length < FIND_MAX; i = s.indexOf(needle, i + 1)) {
    const end = i + needle.length, boxes: [number, number, number, number][] = [];
    for (let k = 0; k < words.length; k++) {
      const a = starts[k], b = a + norm(words[k][4]).length;
      if (b > i && a < end) boxes.push([words[k][0], words[k][1], words[k][2], words[k][3]]);
    }
    if (boxes.length) out.push(boxes);
  }
  return out;
}
/** Where `q` stands in a file: pages and boxes for documents and presentations, cells for sheets. */
export async function find(id: number, q: string): Promise<FindOut> {
  const d = rowById(id);
  if (!d || d.state !== "ok") throw new HttpError(404, "Das gibt es nicht (mehr).");
  const needle = norm(String(q ?? "").slice(0, 200));
  if (!needle) return { hits: [], more: false };
  if (d.kind === "sheet") {
    const sheets = json<{ rows: number }[]>(d.sheets, []), hits: FindOut["hits"] = [];
    // a sheet is read in windows, like the grid does; at most 200 000 rows per sheet are searched
    for (let s = 0; s < sheets.length && hits.length < FIND_MAX; s++)
      for (let from = 0; from < Math.min(sheets[s].rows, 200_000) && hits.length < FIND_MAX; from += 1000) {
        const w = await sheetRows(d, s, from, 1000);
        w.rows.forEach((row, k) => row.forEach((cell, c) => { if (cell && hits.length < FIND_MAX && norm(cell).includes(needle)) hits.push({ sheet: s, row: from + k, col: c }); }));
      }
    return { hits, more: hits.length >= FIND_MAX };
  }
  const p = pagesOf(d.sha256);
  if (!p) return { hits: [], more: false, none: true };
  const hits: FindOut["hits"] = [];
  for (let n = 0; n < p.length && hits.length < FIND_MAX; n++) {
    if (!p[n]) continue;
    for (const boxes of findOnPage(json<PageText>(p[n], { l: [], w: [] }).w, needle)) hits.push({ page: n + 1, boxes });
  }
  return { hits: hits.slice(0, FIND_MAX), more: hits.length >= FIND_MAX };
}
