// EPUB (docs/files.md, "Books"): container.xml -> OPF -> spine, table of contents (nav or NCX), author, cover, search text.
// Pure: reads a zip through a DocSource, no database. XML is read with small regexes, enough for what the format fixes.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { zipEntries, zipRead, type DocSource, type ZipEntry } from "./docsniff";
import type { BookOut } from "../shared/types";

export const fileSource = (path: string, fd: number): DocSource => ({ size: statSync(path).size, read: (off, len) => { const b = new Uint8Array(len); return b.subarray(0, readSync(fd, b, 0, len, off)); } });
/** Runs `f` with the file as a DocSource. */
export function withSource<T>(path: string, f: (src: DocSource) => T): T {
  const fd = openSync(path, "r");
  try { return f(fileSource(path, fd)); } finally { closeSync(fd); }
}

export type Book = BookOut & { by: string | null; /** path of the cover image inside the zip */ cover: string | null; /** dc:title */ name: string | null };

const dec = new TextDecoder();
const SPINE_MAX = 5000, TOC_MAX = 5000, ENTRY_MAX = 16 << 20;

const unxml = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e: string) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); try { return String.fromCodePoint(n); } catch { return " "; } }
  return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[e.toLowerCase()] ?? " ";
});
const plain = (html: string) => unxml(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
/** Value of attribute `name` in a start tag: whole name only ("type" is not "media-type"). */
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?<![\\w:.-])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? unxml(m[1] ?? m[2]) : null;
}
const tags = (xml: string, name: string) => xml.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>`, "gi")) ?? [];

/** Path inside the zip that `href` (relative to the entry `base`) points at, without the fragment; null: outside the book or not a local path. */
export function resolveHref(base: string, href: string): string | null {
  const h = href.split("#")[0].split("?")[0].trim();
  if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  const out = h.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const seg of h.split("/")) {
    let s = seg;
    try { s = decodeURIComponent(seg); } catch { /* keep as written */ }
    if (s === "" || s === ".") continue;
    if (s === "..") { if (!out.length) return null; out.pop(); } else out.push(s);
  }
  return out.length ? out.join("/") : null;
}
const withFragment = (base: string, href: string) => { const p = resolveHref(base, href); const k = href.indexOf("#"); return p == null ? null : k >= 0 && href.slice(k + 1) ? `${p}#${href.slice(k + 1)}` : p; };

/** The entries of a zip by name; null when the file is no zip. */
export const entryMap = (src: DocSource): Map<string, ZipEntry> | null => { const z = zipEntries(src); return z ? new Map(z.map(e => [e.name, e])) : null; };
export function readText(src: DocSource, map: Map<string, ZipEntry>, name: string, max = ENTRY_MAX): string | null {
  const e = map.get(name);
  const b = e && zipRead(src, e, max);
  return b ? dec.decode(b.subarray(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0)) : null;
}

/** Reads the book; null when it has no container, no OPF or an empty spine. */
export function parseBook(src: DocSource, map: Map<string, ZipEntry>): Book | null {
  const container = readText(src, map, "META-INF/container.xml");
  const rootTag = container && tags(container, "rootfile")[0];
  const opfPath = rootTag && attr(rootTag, "full-path");
  const opf = opfPath ? readText(src, map, opfPath) : null;
  if (!opfPath || !opf) return null;

  const items = new Map<string, { href: string; type: string; props: string }>();
  for (const t of tags(opf, "item")) {
    const id = attr(t, "id"), href = attr(t, "href");
    if (id && href) items.set(id, { href, type: attr(t, "media-type") ?? "", props: attr(t, "properties") ?? "" });
  }
  const spinePaths: string[] = [];
  for (const t of tags(opf, "itemref")) {
    const it = items.get(attr(t, "idref") ?? ""), p = it && resolveHref(opfPath, it.href);
    if (p && spinePaths.length < SPINE_MAX && !spinePaths.includes(p)) spinePaths.push(p);
  }
  if (!spinePaths.length) return null;

  // author: the first dc:creator
  const cm = /<(?:[\w-]+:)?creator\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?creator>/i.exec(opf);
  const by = cm ? plain(cm[1]).slice(0, 200) || null : null;
  // the book's own title (a file name like terraform_upandrunning3rdedition_V2.epub says little)
  const tm = /<(?:[\w-]+:)?title\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?title>/i.exec(opf);
  const name = tm ? plain(tm[1]).slice(0, 200) || null : null;

  // cover: properties="cover-image", else <meta name="cover" content="<item id>">
  let coverHref: string | null = null;
  for (const it of items.values()) if (/\bcover-image\b/.test(it.props)) { coverHref = it.href; break; }
  if (!coverHref) {
    const meta = tags(opf, "meta").find(t => attr(t, "name") === "cover"), it = meta && items.get(attr(meta, "content") ?? "");
    if (it) coverHref = it.href;
  }
  const cover = coverHref ? resolveHref(opfPath, coverHref) : null;

  // table of contents: the EPUB 3 nav document, else the NCX
  let toc: BookOut["toc"] = [];
  const nav = [...items.values()].find(i => /\bnav\b/.test(i.props));
  const navPath = nav && resolveHref(opfPath, nav.href), navXml = navPath ? readText(src, map, navPath) : null;
  if (navPath && navXml) toc = parseNav(navXml, navPath);
  if (!toc.length) {
    const sp = tags(opf, "spine")[0], ncx = (sp && items.get(attr(sp, "toc") ?? "")) || [...items.values()].find(i => i.type === "application/x-dtbncx+xml");
    const ncxPath = ncx && resolveHref(opfPath, ncx.href), ncxXml = ncxPath ? readText(src, map, ncxPath) : null;
    if (ncxPath && ncxXml) toc = parseNcx(ncxXml, ncxPath);
  }
  // a spine document is titled by the first entry of the contents that points at it
  const title = new Map<string, string>();
  for (const t of toc) { const p = t.href.split("#")[0]; if (!title.has(p)) title.set(p, t.title); }
  return { spine: spinePaths.map(href => ({ href, title: title.get(href) ?? null })), toc, by, cover, name };
}

function parseNav(xml: string, base: string): BookOut["toc"] {
  const navs = xml.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi) ?? [];
  const block = navs.find(n => /epub:type\s*=\s*["'][^"']*\btoc\b/i.test(n)) ?? navs[0];
  const out: BookOut["toc"] = [];
  if (!block) return out;
  let depth = -1;
  const re = /<ol\b[^>]*>|<\/ol>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (let m: RegExpExecArray | null; (m = re.exec(block)) && out.length < TOC_MAX;) {
    if (m[0][1] === "o") depth++;
    else if (m[0][1] === "/") depth--;
    else {
      const href = attr(m[1] ?? "", "href"), t = plain(m[2]), p = href && withFragment(base, href);
      if (p && t) out.push({ title: t.slice(0, 300), href: p, depth: Math.max(0, depth) });
    }
  }
  return out;
}

function parseNcx(xml: string, base: string): BookOut["toc"] {
  const out: BookOut["toc"] = [];
  let depth = 0, label = "";
  const re = /<navPoint\b[^>]*>|<\/navPoint>|<navLabel\b[^>]*>[\s\S]*?<\/navLabel>|<content\b[^>]*>/gi;
  for (let m: RegExpExecArray | null; (m = re.exec(xml)) && out.length < TOC_MAX;) {
    const t = m[0].toLowerCase();
    if (t.startsWith("</navpoint")) depth--;
    else if (t.startsWith("<navpoint")) { depth++; label = ""; }
    else if (t.startsWith("<navlabel")) label = plain(m[0]);
    else if (depth > 0) {
      const src = attr(m[0], "src"), p = src && withFragment(base, src);
      if (p && label) out.push({ title: label.slice(0, 300), href: p, depth: depth - 1 });
    }
  }
  return out;
}

/** The text of the spine documents with tags stripped, at most `cap` characters. */
export function bookText(src: DocSource, map: Map<string, ZipEntry>, spine: string[], cap: number): string {
  let out = "";
  for (const p of spine) {
    if (out.length >= cap) break;
    const x = readText(src, map, p, 8 << 20);
    if (!x) continue;
    out += plain(x.replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")) + " ";
  }
  return out.slice(0, cap);
}
