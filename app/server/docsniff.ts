// Which of the formats of docs/files.md is this file? Pure: imports no database, so tests run it directly.
// The bytes decide the family, the name only picks within it; a name whose extension is not in the table is refused.
// Also the text helpers the sheets need: decoding, CSV, the grid caps and the cover drawn as SVG.
import type { DocKind } from "../shared/types";

export type DocType = { format: string; kind: DocKind; mime: string };
/** A file seen through read(): the head and the zip directory at the end are read from where they are, never the whole file. */
export interface DocSource { size: number; read(off: number, len: number): Uint8Array }

const OOXML = "application/vnd.openxmlformats-officedocument.";
const ODF = "application/vnd.oasis.opendocument.";
/** Every format Monet keeps, by the extension of the original. PDF is `doc` here; render decides slides from the first page. */
export const FORMATS: Record<string, { kind: DocKind; mime: string }> = {
  pdf: { kind: "doc", mime: "application/pdf" },
  docx: { kind: "doc", mime: OOXML + "wordprocessingml.document" }, doc: { kind: "doc", mime: "application/msword" },
  odt: { kind: "doc", mime: ODF + "text" }, rtf: { kind: "doc", mime: "application/rtf" }, pages: { kind: "doc", mime: "application/vnd.apple.pages" },
  txt: { kind: "doc", mime: "text/plain" }, md: { kind: "doc", mime: "text/markdown" }, tex: { kind: "doc", mime: "application/x-tex" },
  xlsx: { kind: "sheet", mime: OOXML + "spreadsheetml.sheet" }, xlsm: { kind: "sheet", mime: "application/vnd.ms-excel.sheet.macroEnabled.12" },
  xls: { kind: "sheet", mime: "application/vnd.ms-excel" }, ods: { kind: "sheet", mime: ODF + "spreadsheet" }, numbers: { kind: "sheet", mime: "application/vnd.apple.numbers" },
  csv: { kind: "sheet", mime: "text/csv" }, tsv: { kind: "sheet", mime: "text/tab-separated-values" },
  pptx: { kind: "slides", mime: OOXML + "presentationml.presentation" }, ppt: { kind: "slides", mime: "application/vnd.ms-powerpoint" },
  odp: { kind: "slides", mime: ODF + "presentation" }, key: { kind: "slides", mime: "application/vnd.apple.keynote" },
};
/** Formats that are plain text: decoded by us, shown as text, and rendered from the decoded text. */
export const TEXT_FORMATS = new Set(["txt", "md", "tex", "csv", "tsv"]);
const ALIAS: Record<string, string> = { markdown: "md" };

/** Lower case extension of a file name, or null. */
export function extOf(name: string | null | undefined): string | null {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec((name ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}
/** The format a name's extension stands for, if it is in the table. */
export const formatOfName = (name: string | null | undefined): string | null => { const e = extOf(name); const f = e ? (ALIAS[e] ?? e) : null; return f && FORMATS[f] ? f : null; };
/** A name with an extension outside the table is refused; a name without one decides nothing and is not refused. */
const nameOk = (name: string | null | undefined) => { const e = extOf(name); return !e || !!formatOfName(name); };
/** A name that only text can carry: such a file is a document even when its first bytes look like a picture ("GIF is ..."). */
export const isTextName = (name: string | null | undefined) => { const f = formatOfName(name); return !!f && TEXT_FORMATS.has(f); };
/** Title and extension of an original name; the extension is cut only when it is one of ours. */
export function splitName(name: string | null | undefined): { title: string; ext: string | null } {
  const base = (name ?? "").replace(/^.*[\\/]/, "").trim();
  const f = formatOfName(base);
  const title = (f ? base.replace(/\.[A-Za-z0-9]{1,12}$/, "") : base).trim();
  return { title: title || "Ohne Titel", ext: f };
}

const s = (h: Uint8Array, a: number, n: number) => String.fromCharCode(...h.subarray(a, a + n));
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const isOle = (h: Uint8Array) => h.length >= 8 && OLE.every((b, i) => h[i] === b);
const isZip = (h: Uint8Array) => h.length >= 4 && h[0] === 0x50 && h[1] === 0x4b && h[2] === 3 && h[3] === 4;
export const HEAD = 65536;
const noNul = (h: Uint8Array) => h.indexOf(0) < 0;

/** At the first chunk only the head is there: could this become a document? The last chunk decides (sniffDoc). */
export function docCandidate(head: Uint8Array, name: string | null | undefined): boolean {
  if (!nameOk(name)) return false;
  if (s(head, 0, 5) === "%PDF-" || s(head, 0, 5) === "{\\rtf" || isZip(head) || isOle(head)) return true;
  return isTextName(name) && noNul(head.subarray(0, HEAD));
}

/* ---------- zip: the central directory at the end of the file ---------- */
export type ZipEntry = { name: string; method: number; csize: number; off: number };
export function zipEntries(src: DocSource): ZipEntry[] | null {
  const tailLen = Math.min(src.size, 22 + 65535);
  const tail = src.read(src.size - tailLen, tailLen);
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) return null;
  const count = dv.getUint16(e + 10, true), cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true);
  // zip64 and absurd directories are not what an office program writes
  if (count === 0xffff || cdOff === 0xffffffff || cdSize > 16 << 20 || cdOff + cdSize > src.size) return null;
  const cd = src.read(cdOff, cdSize), cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength), out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let p = 0, k = 0; k < count && p + 46 <= cd.length; k++) {
    if (cv.getUint32(p, true) !== 0x02014b50) return null;
    const method = cv.getUint16(p + 10, true), csize = cv.getUint32(p + 20, true), nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true), off = cv.getUint32(p + 42, true);
    if (p + 46 + nl > cd.length) return null;
    out.push({ name: dec.decode(cd.subarray(p + 46, p + 46 + nl)), method, csize, off });
    p += 46 + nl + xl + cl;
  }
  return out;
}
/** The stored content (first bytes) of one entry, or null when it is compressed or unreadable. */
function storedHead(src: DocSource, z: ZipEntry, max = 100): string | null {
  if (z.method !== 0 || z.off + 30 > src.size) return null;
  const h = src.read(z.off, 30), dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
  if (h.length < 30 || dv.getUint32(0, true) !== 0x04034b50) return null;
  const at = z.off + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  return new TextDecoder().decode(src.read(at, Math.min(z.csize, max)));
}

/** The final decision, with the whole file within reach. null: not one of ours. */
export function sniffDoc(src: DocSource, name: string | null | undefined): DocType | null {
  if (!nameOk(name) || src.size <= 0) return null;
  const head = src.read(0, Math.min(src.size, HEAD)), ext = formatOfName(name);
  const mk = (format: string): DocType => ({ format, kind: FORMATS[format].kind, mime: FORMATS[format].mime });
  if (s(head, 0, 5) === "%PDF-") return mk("pdf");
  if (s(head, 0, 5) === "{\\rtf") return mk("rtf");
  if (isZip(head)) {
    const z = zipEntries(src);
    if (!z) return null;
    const names = z.map(e => e.name);
    const mt = z.find(e => e.name === "mimetype");
    if (mt) {
      const m = storedHead(src, mt) ?? "";
      for (const [k, f] of [["text", "odt"], ["spreadsheet", "ods"], ["presentation", "odp"]] as const) if (m.startsWith(ODF + k)) return mk(f);
      return null;
    }
    if (names.some(n => n.startsWith("word/"))) return mk("docx");
    if (names.some(n => n.startsWith("xl/"))) return mk(ext === "xlsm" ? "xlsm" : "xlsx");
    if (names.some(n => n.startsWith("ppt/"))) return mk("pptx");
    if (names.includes("Index/Document.iwa") || names.includes("index.xml")) return ext === "key" || ext === "pages" || ext === "numbers" ? mk(ext) : null;
    return null;
  }
  if (isOle(head)) return ext === "doc" || ext === "xls" || ext === "ppt" ? mk(ext) : null;
  if (ext && TEXT_FORMATS.has(ext) && noNul(head)) return mk(ext);
  return null;
}

/* ---------- text ---------- */
/** UTF-8 (a BOM is dropped); a file that is not valid UTF-8 is read as windows-1252. A cut in the middle of a character is not an error. */
export function decodeText(b: Uint8Array): string {
  const t = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(t, { stream: true }); } catch { return new TextDecoder("windows-1252").decode(t); }
}

/** CSV with quoted fields: commas, doubled quotes and line breaks inside quotes. Stops after `maxRows` rows when given. */
export function parseCsv(text: string, delim: string, maxRows = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = "", q = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (q) {
      if (ch !== '"') f += ch;
      else if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
    } else if (ch === '"' && f === "") q = true;
    else if (ch === delim) { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f); rows.push(row); row = []; f = "";
      if (rows.length >= maxRows) return rows;
    } else f += ch;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}
/** tsv: tab; else the most frequent of , ; tab in the first line (comma on a tie). */
export function detectDelimiter(text: string, format: string): string {
  if (format === "tsv") return "\t";
  const line = text.slice(0, Math.max(0, text.search(/[\r\n]/)) || 4096);
  let best = ",", n = 0;
  for (const d of [",", ";", "\t"]) { const c = line.split(d).length - 1; if (c > n) { n = c; best = d; } }
  return best;
}

export const SHEET_MAX_ROWS = 100_000, SHEET_MAX_COLS = 200;
/** Drops trailing empty rows and columns, applies the caps (`truncated` says when more were there) and pads every row. */
export function toGrid(raw: string[][], maxRows = SHEET_MAX_ROWS, maxCols = SHEET_MAX_COLS): { rows: string[][]; cols: number; truncated: boolean } {
  const wid = (r: string[]) => { let w = r.length; while (w > 0 && r[w - 1] === "") w--; return w; };
  let h = raw.length;
  while (h > 0 && wid(raw[h - 1]) === 0) h--;
  let cols = 0;
  for (let k = 0; k < h; k++) cols = Math.max(cols, wid(raw[k]));
  const truncated = h > maxRows || cols > maxCols;
  h = Math.min(h, maxRows); cols = Math.min(cols, maxCols);
  const rows: string[][] = new Array(h);
  for (let k = 0; k < h; k++) { const o = raw[k].slice(0, cols); while (o.length < cols) o.push(""); rows[k] = o; }
  return { rows, cols, truncated };
}

/* ---------- the cover of a sheet: a clean grid of the first cells ---------- */
const esc = (t: string) => t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 960 x 720 (4:3), white, light rules, the first row a little darker. Cell text is cut to fit and escaped for XML. */
export function sheetSvg(rows: string[][], maxRows = 10, maxCols = 6): string {
  const W = 960, H = 720, cw = W / maxCols, rh = H / maxRows;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/><rect width="${W}" height="${rh}" fill="#f1f3f5"/>`;
  for (let c = 1; c < maxCols; c++) o += `<line x1="${c * cw}" y1="0" x2="${c * cw}" y2="${H}" stroke="#d9dee3" stroke-width="2"/>`;
  for (let r = 1; r < maxRows; r++) o += `<line x1="0" y1="${r * rh}" x2="${W}" y2="${r * rh}" stroke="#d9dee3" stroke-width="2"/>`;
  for (let r = 0; r < Math.min(maxRows, rows.length); r++) for (let c = 0; c < Math.min(maxCols, rows[r].length); c++) {
    let t = rows[r][c].replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.length > 12) t = t.slice(0, 10) + "...";
    o += `<text x="${c * cw + 12}" y="${r * rh + rh / 2 + 8}" font-family="sans-serif" font-size="24" font-weight="${r === 0 ? 700 : 400}" fill="#2b3138">${esc(t)}</text>`;
  }
  return o + "</svg>";
}
