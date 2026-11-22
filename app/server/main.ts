// HTTP: routing, security headers, static client, media, models. Everything else lives in the modules this calls.
// Run as `monet` (the server), or as `monet invite <name> [--admin] [--theme ernst]`, `monet reset-passkeys [name]`
// and `monet members` (the accounts module's commands, docs/accounts.md: they print a link or a list and exit).
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { accounts, can, clientIp, ORIGIN, sameOrigin, type Principal } from "./auth";
import { db } from "./db";
import * as docs from "./docs";
import * as folders from "./folders";
import { ackExport, exportList, status } from "./status";
import { applySidecar, DATA, ORIGINALS, placeVideos, sweep, thumbPath } from "./ingest";
import * as lib from "./library";
import * as stack from "./stack";
import * as zoom from "./zoom";
import * as together from "./together";
import * as docvec from "./docvec";
import { moment, moments } from "./moments";
import { faceCrop, editPerson, loadCentroids, releaseWeak, mergePeople, moveFace, people, storeFaces } from "./people";
import { loadPlaces } from "./places";
import * as house from "./household";
import * as search from "./search";
import { check, evictParts, putChunk } from "./upload";
import { kickOcr } from "./ocr-queue";
import { decodeVec, fail, HttpError, J } from "./util";

const DIST = process.env.MONET_DIST ?? "dist";
const MODELS = process.env.MONET_MODELS ?? "models";

/* ---------- headers ---------- */
const CSP = "default-src 'self'; img-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const SECURITY: Record<string, string> = {
  "content-security-policy": CSP, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000; includeSubDomains", "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-resource-policy": "same-origin",
  // cross-origin isolation: onnxruntime-web then gets SharedArrayBuffer and wasm threads (about 3.5 times faster).
  // Everything the page loads is same-origin, so require-corp costs nothing.
  "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp",
};
// a handler that sets its own content-security-policy (the pages of a book) keeps it: only a missing one gets the global policy
function secure(r: Response): Response { for (const [k, v] of Object.entries(SECURITY)) if (k !== "content-security-policy" || !r.headers.has(k)) r.headers.set(k, v); return r; }

/* ---------- small helpers ---------- */
type Ctx = { req: Request; url: URL; p: Principal | null; m: RegExpExecArray; ip: string };
type Handler = (c: Ctx) => Response | Promise<Response>;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".wasm": "application/wasm", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".map": "application/json", ".onnx": "application/octet-stream", ".safetensors": "application/octet-stream",
};
async function body<T = any>(req: Request, max = 1 << 20): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > max) throw new HttpError(413, "Die Anfrage ist zu groß.");
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "Die Anfrage ist zu groß.");
  let v: unknown;
  try { v = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "Ungültiges JSON."); }
  // every route reads fields off the result: null or a bare number would end in a 500
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "Ungültiges JSON.");
  return v as T;
}
const need = (p: Principal | null): Principal => { if (!p) throw new HttpError(401, "Du bist nicht angemeldet."); return p; };
/** Pages and everything that reads the library: a browser session only. Devices see nothing but their own scopes. */
const browser = (p: Principal | null): Principal => { const q = need(p); if (q.kind !== "browser") throw new HttpError(403, "Das ist nicht erlaubt."); return q; };
const scope = (p: Principal | null, s: string): Principal => { const q = need(p); if (!can(q, s)) throw new HttpError(403, "Das ist nicht erlaubt."); return q; };
const id = (s: string) => { const n = Number(s); if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, "Das gibt es nicht (mehr)."); return n; };
/** The library a page reads: the person's own, or the one of whoever they are looking at (X-Monet-Of). Reads only;
 *  every write below takes `browser(c.p).owner`, so another person's photos are never changed from here. */
const lib_ = (c: Ctx): number => house.readerOf(browser(c.p).owner, c.req.headers.get("x-monet-of"));
/** Where an upload lands. The one exception to the rule above: photos dropped on another person's library are added
 *  to that library, because that is where they were put. Adding only: changing and deleting stay with the owner.
 *  A device always uploads into its own library. */
const into = (c: Ctx): Principal => {
  const p = scope(c.p, "upload");
  return p.kind === "browser" ? { ...p, owner: house.readerOf(p.owner, c.req.headers.get("x-monet-of")) } : p;
};
/** One photo, wherever it lives in the household: its owner, so the library code can read it as theirs. */
const ownerOfItem = (item: number): number => (db.query("SELECT owner_id FROM item WHERE id = ?").get(item) as { owner_id: number } | null)?.owner_id ?? 0;
const ownerOfFolder = (folder: number): number => (db.query("SELECT owner_id FROM folder WHERE id = ?").get(folder) as { owner_id: number } | null)?.owner_id ?? 0;
const ownerOfFace = (face: number): number => (db.query("SELECT i.owner_id FROM face f JOIN item i ON i.id = f.item_id WHERE f.id = ?").get(face) as { owner_id: number } | null)?.owner_id ?? 0;

/* ---------- files with ETag and Range ---------- */
const IMMUTABLE = "private, max-age=31536000, immutable";
function fileResponse(req: Request, path: string, type: string, etag: string, cache = IMMUTABLE, extra: Record<string, string> = {}): Response {
  if (!existsSync(path)) return fail(404, "Das gibt es nicht (mehr).");
  const h: Record<string, string> = { "content-type": type, etag, "cache-control": cache, "accept-ranges": "bytes", ...extra };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: h });
  const f = Bun.file(path), size = f.size;
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (r && (r[1] || r[2])) {
    let a = r[1] ? Number(r[1]) : size - Number(r[2]), b = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
    a = Math.max(0, a);
    if (a > b || a >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(f.slice(a, b + 1), { status: 206, headers: { ...h, "content-range": `bytes ${a}-${b}/${size}`, "content-length": String(b - a + 1) } });
  }
  return new Response(f, { headers: { ...h, "content-length": String(size) } });
}

function media(c: Ctx): Response {
  const itemId = id(c.m[1]), size = c.m[2];
  const p = need(c.p);
  // a device may fetch what it needs: s and m for its own panels and queues, l to index, the original for the Mac's second copy
  const thumb = size === "s" || size === "m";
  if (p.kind !== "browser" && !(size === "l" && can(p, "index")) && !(size === "o" && can(p, "export")) && !(thumb && (can(p, "index") || can(p, "upload")))) throw new HttpError(403, "Das ist nicht erlaubt.");
  // a browser sees the whole household's photos; a device only its owner's
  const owner = p.kind === "browser" ? ownerOfItem(itemId) : p.owner;
  const it = db.query("SELECT sha256, mime, orig_path FROM item WHERE id = ? AND owner_id = ?").get(itemId, owner) as { sha256: string; mime: string; orig_path: string } | null;
  if (!it) return fail(404, "Das gibt es nicht (mehr).");
  if (size === "o") return fileResponse(c.req, join(ORIGINALS, it.orig_path), it.mime, `"${it.sha256}-o"`);
  return fileResponse(c.req, thumbPath(it.sha256, size as "s" | "m" | "l"), "image/webp", `"${it.sha256}-${size}"`);
}

/** Content-Disposition for the original of a file: ASCII fallback plus RFC 5987 filename*, no control characters. */
function attachment(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "Datei";
  const ascii = clean.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
  const star = encodeURIComponent(clean).replace(/['()*]/g, ch => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}
/** The file a media request names. A browser reads the whole household's; a device with scope index (the darkroom in
 *  the Mac's WebView, the Mac's transcription) reads its own owner's covers, small pages and recordings, nothing else. */
function docOf(c: Ctx, what: string) {
  const p = need(c.p), d = docs.rowById(id(c.m[1]));
  if (p.kind === "browser") return d;
  if (!can(p, "index") || !["c", "t", "play"].includes(what)) throw new HttpError(403, "Das ist nicht erlaubt.");
  return d && d.owner_id === p.owner ? d : null;
}
/** /media/doc/:id/...: the household's files for a browser session; the original goes out as a download. */
async function mediaDoc(c: Ctx): Promise<Response> {
  const d = docOf(c, c.m[2]);
  if (!d) return fail(404, "Das gibt es nicht (mehr).");
  const what = c.m[2];
  if (what === "o") return fileResponse(c.req, join(ORIGINALS, d.orig_path), d.mime, `"${d.sha256}-o"`, IMMUTABLE, { "content-disposition": attachment(d.orig_name ?? `${d.title}.${d.format}`) });
  if (what === "c") return fileResponse(c.req, docs.derived(d.sha256, "-c.webp"), "image/webp", `"${d.sha256}-c"`);
  if (what === "text") {
    const etag = `"${d.sha256}-text"`;
    if (c.req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": IMMUTABLE } });
    const t = await docs.textOf(d);
    return t == null ? fail(404, "Das gibt es nicht (mehr).") : new Response(t, { headers: { "content-type": "text/plain; charset=utf-8", etag, "cache-control": IMMUTABLE } });
  }
  const page = await docs.pageFile(d, what as "p" | "t", Number(c.m[3]));
  return page ? fileResponse(c.req, page, "image/webp", `"${d.sha256}-${what}${c.m[3]}"`) : fail(404, "Diese Seite gibt es nicht.");
}

/* ---------- the pages of a book ---------- */
// no script, no frame, nothing from outside: the reader puts them in <iframe sandbox="allow-same-origin"> (docs/files.md)
const BOOK_CSP = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
const BOOK_STYLE = "<style>html{max-width:42rem;margin:0 auto;padding:1rem;color-scheme:light dark}img,svg,video{max-width:100%;height:auto}</style>";
const BOOK_MIME: Record<string, string> = {
  xhtml: "application/xhtml+xml; charset=utf-8", html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
};
/** The style goes before </head>; a page without one gets it after its <body> tag, else in front (after an XML declaration). */
function injectStyle(html: string): string {
  const h = /<\/head\s*>/i.exec(html);
  if (h) return html.slice(0, h.index) + BOOK_STYLE + html.slice(h.index);
  const b = /<body\b[^>]*>/i.exec(html);
  if (b) return html.slice(0, b.index + b[0].length) + BOOK_STYLE + html.slice(b.index + b[0].length);
  const x = /^\s*<\?xml[^>]*\?>/i.exec(html);
  return x ? html.slice(0, x[0].length) + BOOK_STYLE + html.slice(x[0].length) : BOOK_STYLE + html;
}
function mediaBook(c: Ctx): Response {
  browser(c.p);
  const d = docs.rowById(id(c.m[1]));
  if (!d || d.kind !== "book" || d.state !== "ok") return fail(404, "Das gibt es nicht (mehr).");
  const e = docs.bookEntry(d, c.m[2]);
  if (!e) return fail(404, "Das gibt es nicht.");
  const ext = e.name.slice(e.name.lastIndexOf(".") + 1).toLowerCase(), type = BOOK_MIME[ext] ?? "application/octet-stream";
  const etag = `"${d.sha256}-b${Bun.hash(e.name).toString(36)}"`;
  const markup = ext === "xhtml" || ext === "html" || ext === "htm", active = markup || ext === "svg";
  const h: Record<string, string> = { "content-type": type, etag, "cache-control": IMMUTABLE, ...(active ? { "content-security-policy": BOOK_CSP } : {}) };
  if (c.req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: h });
  const bytes = e.read();
  if (!bytes) return fail(404, "Das gibt es nicht.");
  return new Response(markup ? injectStyle(new TextDecoder().decode(bytes)) : bytes, { headers: h });
}

/* ---------- static client and models ---------- */
const HASHED = /[.-][A-Za-z0-9_]{8,}\.(js|css|wasm|woff2|png|svg|webp|jpg|map)$/;
function staticFile(req: Request, path: string): Response | null {
  const root = normalize(DIST).replace(/[\\/]+$/, "");
  const full = normalize(join(root, path));
  if (!full.startsWith(root + sep) || !existsSync(full) || !statSync(full).isFile()) return null;
  const ae = req.headers.get("accept-encoding") ?? "", ext = extname(full);
  const h: Record<string, string> = { "content-type": MIME[ext] ?? "application/octet-stream", vary: "accept-encoding", "cache-control": HASHED.test(full) || path.startsWith("vendor/ort/") ? "public, max-age=31536000, immutable" : "no-cache" };
  let src = full;
  if (ae.includes("br") && existsSync(full + ".br")) { src = full + ".br"; h["content-encoding"] = "br"; }
  else if (ae.includes("gzip") && existsSync(full + ".gz")) { src = full + ".gz"; h["content-encoding"] = "gzip"; }
  const st = statSync(src);
  h.etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  if (req.headers.get("if-none-match") === h.etag) return new Response(null, { status: 304, headers: h });
  return new Response(Bun.file(src), { headers: h });
}
function spa(req: Request, pathname: string): Response {
  if (pathname === "/") pathname = "/index.html";
  const hit = staticFile(req, pathname.slice(1));
  if (hit) return hit;
  // a path with an extension that is not there is a missing asset, not a client route
  if (/\.[A-Za-z0-9]{1,6}$/.test(pathname)) return fail(404, "Das gibt es nicht.");
  return staticFile(req, "index.html") ?? new Response("Monet: client not built (MONET_DIST)", { status: 503 });
}
function model(c: Ctx): Response {
  need(c.p);
  const name = c.m[1];
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return fail(404, "Das gibt es nicht.");
  const path = join(MODELS, name);
  if (!existsSync(path)) return fail(404, "Das gibt es nicht.");
  const st = statSync(path);
  return fileResponse(c.req, path, MIME[extname(name)] ?? "application/octet-stream", `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`);
}

const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) => routes.push([method, new RegExp(`^${path}$`), h]);

route("GET", "/healthz", () => J({ ok: true }));
// Digital Asset Links: proves to Chrome that the Android app may show this origin as a Trusted Web Activity (full
// screen, no address bar). The fingerprints are the app's signing certificates: the release key
// (~/.config/monet-android/release.jks on the build Mac) and the debug key of that Mac, for emulator runs.
const ANDROID_CERTS = [
  "4C:25:F5:0D:1C:46:6C:11:39:DC:A1:99:36:7A:14:BC:EB:18:08:9F:40:A9:EE:9A:62:2F:6D:9F:AD:CD:B2:8F",
  "5B:9D:DD:7C:1D:84:A0:A6:54:40:39:07:2F:D2:44:19:DF:76:17:9B:31:F0:15:20:35:B1:65:74:84:6F:57:DA",
];
route("GET", "/.well-known/assetlinks.json", () => J([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "dev.kaleve.monet", sha256_cert_fingerprints: ANDROID_CERTS } }]));
// accounts, passkeys, sessions, members and devices: the accounts module's routes (accounts.handle in dispatch)

/* ---------- upload ---------- */
route("POST", "/api/upload/check", async c => J(check(into(c).owner, (await body(c.req, 4 << 20)).hashes)));
route("PUT", "/api/upload/([0-9a-fA-F]{64})", c => putChunk(c.req, into(c), c.m[1].toLowerCase()));
route("POST", "/api/items/(\\d+)/sidecar", async c => {
  const p = scope(c.p, "upload"), item = id(c.m[1]);
  // a device may enrich what it uploaded itself, nothing else
  if (p.kind === "device" && (db.query("SELECT device_id FROM item WHERE id = ? AND owner_id = ?").get(item, p.owner) as any)?.device_id !== p.deviceId) throw new HttpError(403, "Das ist nicht erlaubt.");
  applySidecar(p.owner, item, await body(c.req));
  return J({ ok: true });
});

/* ---------- library ---------- */
route("GET", "/api/timeline", c => {
  const q = c.url.searchParams;
  return J(lib.timeline(lib_(c), { cursor: q.get("cursor"), from: q.get("from"), limit: Number(q.get("limit") ?? 24), favorite: q.get("favorite") === "1", album: q.get("album") ? Number(q.get("album")) : null, files: q.get("files") !== "0" }));
});
route("GET", "/api/band", c => J(lib.band(lib_(c))));
route("GET", "/api/items/(\\d+)", c => { browser(c.p); const i = id(c.m[1]); const d = lib.detail(ownerOfItem(i), i); return d ? J(d) : fail(404, "Das gibt es nicht (mehr)."); });
route("PATCH", "/api/items/(\\d+)", async c => { const p = browser(c.p); const b = await body(c.req); if ("favorite" in b) lib.setFavorite(p.owner, id(c.m[1]), !!b.favorite); return J({ ok: true }); });
route("DELETE", "/api/items/(\\d+)", c => { lib.softDelete(browser(c.p).owner, id(c.m[1])); return J({ ok: true }); });
route("POST", "/api/items/(\\d+)/unstack", c => { if (!stack.unstack(browser(c.p).owner, id(c.m[1]))) throw new HttpError(404, "Das Foto gibt es nicht."); return J({ ok: true }); });
route("POST", "/api/items/(\\d+)/restore", c => { lib.softDelete(browser(c.p).owner, id(c.m[1]), true); return J({ ok: true }); });
route("GET", "/api/trash", c => J(lib.trash(browser(c.p).owner)));
route("GET", "/media/(\\d+)/([sml]|o)", media);
route("GET", "/api/items/(\\d+)/zoom", c => { browser(c.p); const z = zoom.info(ownerOfItem(id(c.m[1])), id(c.m[1])); return z ? J(z) : fail(404, "Das gibt es nicht (mehr)."); });
route("GET", "/media/(\\d+)/z/(\\d+)/(\\d+)_(\\d+)", c => { browser(c.p); const t = zoom.tilePath(ownerOfItem(id(c.m[1])), id(c.m[1]), Number(c.m[2]), Number(c.m[3]), Number(c.m[4])); return t ? fileResponse(c.req, t, "image/webp", `"z-${c.m[1]}-${c.m[2]}-${c.m[3]}-${c.m[4]}"`) : fail(404, "Diese Kachel gibt es noch nicht."); });
route("GET", "/media/face/(\\d+)", async c => {
  browser(c.p); const faceId = id(c.m[1]);
  return fileResponse(c.req, await faceCrop(ownerOfFace(faceId), faceId), "image/webp", `"face-${faceId}"`);
});
route("GET", "/api/series", c => J(lib.series(lib_(c))));
route("GET", "/api/places", c => J(lib.places(lib_(c))));
route("GET", "/api/things", c => J(lib.things(lib_(c))));
route("GET", "/api/map", c => J(lib.map(lib_(c))));
// the summaries behind a map cluster (the same shape the grids use), owner scoped, at most 2000 ids
route("POST", "/api/map/items", async c => J(lib.mapItems(lib_(c), (await body(c.req)).ids)));
route("GET", "/api/albums", c => J(lib.albums(lib_(c))));
route("POST", "/api/albums", async c => J(lib.createAlbum(browser(c.p).owner, (await body(c.req)).name)));
route("GET", "/api/albums/(\\d+)", c => { const a = lib.albumDetail(lib_(c), id(c.m[1])); return a ? J(a) : fail(404, "Das Album gibt es nicht."); });
route("DELETE", "/api/albums/(\\d+)", c => { lib.deleteAlbum(browser(c.p).owner, id(c.m[1])); return J({ ok: true }); });
route("POST", "/api/albums/(\\d+)/items", async c => { lib.albumItems(browser(c.p).owner, id(c.m[1]), (await body(c.req)).ids, true); return J({ ok: true }); });
route("DELETE", "/api/albums/(\\d+)/items", async c => { lib.albumItems(browser(c.p).owner, id(c.m[1]), (await body(c.req)).ids, false); return J({ ok: true }); });

/* ---------- files: documents, sheets, slides and the Ablage (docs/files.md) ---------- */
route("GET", "/api/docs", c => { const q = c.url.searchParams; return J(docs.list(lib_(c), { kind: q.get("kind"), q: q.get("q"), cursor: q.get("cursor"), limit: q.has("limit") ? Number(q.get("limit")) : undefined })); });
route("GET", "/api/docs/(\\d+)", c => { browser(c.p); const d = docs.detail(id(c.m[1])); return d ? J(d) : fail(404, "Das gibt es nicht (mehr)."); });
route("PATCH", "/api/docs/(\\d+)", async c => {
  const p = browser(c.p), b = await body(c.req), i = id(c.m[1]);
  const s = b.title !== undefined ? docs.rename(p.owner, i, b.title) : docs.summaryById(p.owner, i);
  return s ? J(s) : fail(404, "Das gibt es nicht (mehr).");
});
route("GET", "/api/docs/(\\d+)/stack", c => J(together.stackOf(id(c.m[1]), lib_(c))));
route("POST", "/api/docs/(\\d+)/unstack", c => { together.unstackDoc(browser(c.p).owner, id(c.m[1])); return J({ ok: true }); });
route("DELETE", "/api/docs/(\\d+)", c => { docs.softDelete(browser(c.p).owner, id(c.m[1])); return J({ ok: true }); });
route("POST", "/api/docs/(\\d+)/restore", c => { docs.softDelete(browser(c.p).owner, id(c.m[1]), true); return J({ ok: true }); });
route("GET", "/api/docs/(\\d+)/sheet/(\\d+)", async c => {
  browser(c.p);
  const d = docs.rowById(id(c.m[1])), q = c.url.searchParams;
  if (!d) return fail(404, "Das gibt es nicht (mehr).");
  return J(await docs.sheetRows(d, Number(c.m[2]), Number(q.get("from") ?? 0), q.has("n") ? Number(q.get("n")) : 200));
});
route("GET", "/api/docs/(\\d+)/book", c => {
  browser(c.p);
  const d = docs.rowById(id(c.m[1])), b = d && d.kind === "book" && d.state === "ok" ? docs.bookOf(d) : null;
  return b ? J(b) : fail(404, "Das gibt es nicht (mehr).");
});
route("GET", "/media/doc/(\\d+)/book/(.+)", mediaBook);
route("GET", "/media/doc/(\\d+)/play", c => {
  const d = docOf(c, "play");
  if (!d || d.kind !== "audio") return fail(404, "Das gibt es nicht (mehr).");
  return fileResponse(c.req, join(ORIGINALS, d.orig_path), d.mime, `"${d.sha256}-o"`, IMMUTABLE, { "content-disposition": "inline" });
});
route("GET", "/media/doc/(\\d+)/(c|o|text)", mediaDoc);
route("GET", "/media/doc/(\\d+)/(p|t)/(\\d+)", mediaDoc);
route("GET", "/api/folders/(\\d+)", c => {
  browser(c.p);
  const f = Number(c.m[1]);
  return J(folders.folderOut(f === 0 ? lib_(c) : ownerOfFolder(f), f));
});
route("POST", "/api/folders", async c => { const b = await body(c.req); return J(folders.createFolder(browser(c.p).owner, b.name, b.parentId)); });
route("PATCH", "/api/folders/(\\d+)", async c => { const p = browser(c.p), b = await body(c.req); return J(folders.renameFolder(p.owner, id(c.m[1]), b.name)); });
route("DELETE", "/api/folders/(\\d+)", c => { folders.deleteFolder(browser(c.p).owner, id(c.m[1])); return J({ ok: true }); });
route("POST", "/api/move", async c => { const p = browser(c.p); folders.move(p.owner, await body(c.req, 4 << 20)); return J({ ok: true }); });

/* ---------- people and search ---------- */
route("GET", "/api/people", c => J(people(lib_(c))));
route("POST", "/api/people/merge", async c => { const b = await body(c.req); mergePeople(browser(c.p).owner, Number(b.from), Number(b.into)); return J({ ok: true }); });
route("POST", "/api/people/(\\d+)", async c => { editPerson(browser(c.p).owner, id(c.m[1]), await body(c.req)); return J({ ok: true }); });
route("POST", "/api/faces/(\\d+)", async c => { const b = await body(c.req); moveFace(browser(c.p).owner, id(c.m[1]), b.personId == null ? null : Number(b.personId)); return J({ ok: true }); });
// `everyone: true` searches the whole household; without it, the library being looked at
const searchOwners = (c: Ctx, everyone: unknown) => everyone === true ? house.ownerIds() : [lib_(c)];
route("POST", "/api/search/parse", async c => { const b = await body(c.req); return J(search.parse(searchOwners(c, b.everyone), b.q)); });
route("POST", "/api/search", async c => { const b = await body(c.req); return J(search.search(searchOwners(c, b.everyone), b, lib_(c))); });

/* ---------- everything together (docs/together.md) ---------- */
// the files that name a person or a place: the person's and the place's pages show them
route("GET", "/api/links", c => {
  const q = c.url.searchParams, kind = q.has("person") ? "person" : "place", ref = Number(q.get(kind));
  if (!Number.isInteger(ref) || ref <= 0) throw new HttpError(400, "Wer oder wo?");
  return J(together.linkedDocs(kind, ref, [lib_(c)], lib_(c)));
});
route("GET", "/api/moments", c => J(moments(lib_(c))));
route("GET", "/api/moments/(\\d{4}-\\d{2}-\\d{2})", c => { const m = moment(lib_(c), c.m[1]); return m ? J(m) : fail(404, "Diesen Moment gibt es nicht (mehr)."); });

/* ---------- household ---------- */
route("GET", "/api/household", c => J(house.household(browser(c.p).owner)));
route("PATCH", "/api/household/me", async c => { const p = browser(c.p); house.setProfile(p.owner, await body(c.req)); return J(house.household(p.owner)); });

/* ---------- indexing (browser Dunkelkammer, Mac WebView) ---------- */
route("GET", "/api/index/pending", c => {
  const p = scope(c.p, "index"), limit = Math.max(1, Math.min(50, Number(c.url.searchParams.get("limit") ?? 8) || 8));
  // ?needs= names the work the caller can do (the browser: clip,faces; the Mac: ocr). Without it, an item missing
  // only work the caller cannot do would come back first every time and starve everything behind it.
  const can = new Set((c.url.searchParams.get("needs") ?? "clip,faces,ocr").split(",")), cond: string[] = [];
  if (can.has("clip")) cond.push("clip_ok = 0");
  if (can.has("faces")) cond.push("faces_ok = 0");
  if (can.has("ocr")) cond.push("(ocr_ok = 0 AND kind = 'photo')");
  if (!cond.length) return J([]);
  // a browser's darkroom works for the whole household (its own photos first); a device only for its owner
  const all = p.kind === "browser";
  const rows = db.query(`SELECT id, kind, clip_ok, faces_ok, ocr_ok FROM item WHERE ${all ? "1" : "owner_id = ?"} AND thumbs_ok = 1 AND deleted_at IS NULL
    AND (${cond.join(" OR ")}) ORDER BY owner_id = ? DESC, taken_at DESC LIMIT ?`).all(...(all ? [] : [p.owner]), p.owner, limit) as any[];
  return J(rows.map(r => ({ id: r.id, kind: r.kind, needs: [!r.clip_ok && "clip", !r.faces_ok && "faces", !r.ocr_ok && r.kind === "photo" && "ocr"].filter(Boolean) })));
});
// files: the pictures and text pieces to embed (docvec.ts); a browser works for the whole household, a device for its owner
route("GET", "/api/index/docs/pending", c => {
  const p = scope(c.p, "index"), limit = Math.max(1, Math.min(50, Number(c.url.searchParams.get("limit") ?? 8) || 8));
  return J(docvec.pendingDocs(p.kind === "browser" ? null : p.owner, p.owner, limit));
});
route("POST", "/api/index/doc/(\\d+)", async c => {
  const p = scope(c.p, "index"), d = docs.rowById(id(c.m[1]));
  if (!d || (p.kind !== "browser" && d.owner_id !== p.owner)) throw new HttpError(404, "Das gibt es nicht (mehr).");
  docvec.storeDocVecs(d.id, await body(c.req, 8 << 20));
  return J({ ok: true });
});
// speech: the Mac transcribes videos and recordings of its owner (together.ts)
route("GET", "/api/index/speech/pending", c => {
  const p = scope(c.p, "index"), limit = Math.max(1, Math.min(50, Number(c.url.searchParams.get("limit") ?? 10) || 10));
  return J(together.speechPending(p.owner, limit));
});
route("POST", "/api/index/speech/(item|doc)/(\\d+)", async c => {
  const p = scope(c.p, "index"), ref = c.m[1] as "item" | "doc", n = id(c.m[2]);
  const row = db.query(`SELECT owner_id FROM ${ref} WHERE id = ?`).get(n) as { owner_id: number } | null;
  if (!row || row.owner_id !== p.owner) throw new HttpError(404, "Das gibt es nicht (mehr).");
  together.storeSpeech(ref, n, await body(c.req, 16 << 20));
  return J({ ok: true });
});
route("GET", "/api/index/vocab", c => { scope(c.p, "index"); return J({ have: search.hasVocab(c.url.searchParams.get("model") ?? "") }); });
route("POST", "/api/index/vocab", async c => {
  const p = scope(c.p, "index"); const b = await body(c.req, 8 << 20);
  const n = search.storeVocab(String(b.model), Array.isArray(b.labels) ? b.labels : []);
  void search.relabelAll().then(() => docvec.relabelDocs()); void p;
  return J({ ok: true, stored: n });
});
route("POST", "/api/index/(\\d+)", async c => {
  const p = scope(c.p, "index"), itemId = id(c.m[1]), b = await body(c.req, 4 << 20);
  const it = db.query("SELECT id, kind, owner_id FROM item WHERE id = ? AND owner_id = ?").get(itemId, p.kind === "browser" ? ownerOfItem(itemId) : p.owner) as { owner_id: number } | null;
  if (!it) throw new HttpError(404, "Das gibt es nicht (mehr).");
  const owner = it.owner_id;
  // an OCR-only post (Apple Vision on the Mac) may name its own model; a clip vector must come from the CLIP model
  const ocrOnly = typeof b.ocr === "string" && b.clip == null && !Array.isArray(b.faces);
  if (b.model !== search.CLIP_MODEL && !(ocrOnly && b.model === "vision-ocr")) throw new HttpError(400, "Unbekanntes Modell.");
  const done: string[] = [];
  if (b.clip != null) { const v = decodeVec(b.clip, search.DIM); if (!v) throw new HttpError(400, "Der CLIP-Vektor ist ungültig."); search.storeClip(owner, itemId, v); stack.stackSimilar(itemId); done.push("clip"); }
  if (Array.isArray(b.faces)) { storeFaces(owner, itemId, b.faces); done.push("faces"); }
  if (typeof b.ocr === "string") { search.storeOcr(itemId, b.ocr); done.push("ocr"); }
  if (done.includes("ocr") || done.includes("clip")) (await import("./fts")).reindexFts(itemId);
  return J({ ok: true, done });
});

/* ---------- status and export ---------- */
route("GET", "/api/status", c => J(status(need(c.p).owner)));
route("GET", "/api/export/list", c => J(exportList(scope(c.p, "export").owner, Number(c.url.searchParams.get("after") ?? 0) || 0, Number(c.url.searchParams.get("limit") ?? 500) || 500)));
route("POST", "/api/export/ack", async c => { const p = need(c.p); ackExport(p.owner, ((await body(c.req)).ids ?? []).map(Number).filter(Number.isInteger)); return J({ ok: true }); });
route("GET", "/models/([^/]+)", model);

/* ---------- dispatch ---------- */
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export async function handle(req: Request, peer = "127.0.0.1"): Promise<Response> {
  const url = new URL(req.url);
  try {
    const ip = clientIp(req, peer);
    const own = await accounts.handle(req, ip);
    if (own) return secure(own);
    if (STATE_CHANGING.has(req.method) && !sameOrigin(req)) return secure(fail(403, "Anfrage von einer anderen Herkunft."));
    for (const [method, re, h] of routes) {
      if (method !== req.method && !(method === "GET" && req.method === "HEAD")) continue;
      const m = re.exec(url.pathname);
      if (!m) continue;
      return secure(await h({ req, url, p: await accounts.principal(req), m, ip }));
    }
    if (req.method === "GET" && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/media/") && !url.pathname.startsWith("/models/")) return secure(spa(req, url.pathname));
    return secure(fail(404, "Das gibt es nicht."));
  } catch (e) {
    if (e instanceof HttpError) return secure(fail(e.status, e.message, e.extra));
    console.error(`${req.method} ${url.pathname}:`, e);
    return secure(fail(500, "Der Server hat ein Problem."));
  }
}

/* ---------- start ---------- */
if (import.meta.main) {
  const argv = process.argv.slice(2);
  // `monet ocr-worker`: started by server/ocr-queue.ts for one batch of photos (stdin), never by hand
  if (argv[0] === "ocr-worker") {
    const { ocrWorker } = await import("./ocr-worker");
    await ocrWorker(JSON.parse(await Bun.stdin.text()), l => process.stdout.write(l + "\n"));
    process.exit(0);
  }
  // `monet invite`, `monet reset-passkeys`, `monet members`: run against the live database, print, exit
  try {
    const out = await accounts.cli(argv);
    if (out != null) { console.log(`\n${out}\n`); process.exit(0); }
  } catch (e) { console.error((e as Error).message); process.exit(2); }
  const n = loadPlaces();
  const requeued = search.requeueOtherModels(); if (requeued) console.log(`${requeued} items analysed by an older image model: queued again for ${search.CLIP_MODEL}`);
  const freed = releaseWeak(); if (freed) console.log(`faces: ${freed} unsure faces taken out of groups without a name`);
  loadCentroids(); search.loadMatrices();
  const stacked = stack.restackAll(); if (stacked) console.log(`stacked ${stacked} similar photos under the current rule`);
  const server = Bun.serve({
    hostname: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 4320),
    // big uploads come in 32 MiB chunks; allow a little more than that for the headers
    maxRequestBodySize: 40 * 1024 * 1024, idleTimeout: 120,
    fetch: (req, srv) => handle(req, srv.requestIP(req)?.address ?? "127.0.0.1"),
  });
  console.log(`monet listening on ${server.hostname}:${server.port}, origin ${ORIGIN}, ${n} places, data ${DATA}`);
  { const k = placeVideos(); if (k) console.log(`places: ${k} videos without GPS took the place of a photo or video next to them`); }
  // the photo sweep first, then the files still waiting to be rendered
  sweep().then(k => k && console.log(`sweep: finished ${k} unfinished items`)).finally(kickOcr)
    .finally(() => docs.sweepDocs().then(k => k && console.log(`sweep: rendered ${k} pending files`)).catch(e => console.error("sweep docs:", e))
      .finally(() => together.sweepTogether().then(r => (r.dated || r.reindexed) && console.log(`together: dated ${r.dated} files, reindexed ${r.reindexed}, ${r.stacks} stacks`)).catch(e => console.error("sweep together:", e))));
  setInterval(() => void together.relinkAll().catch(e => console.error("relink:", e)), 6 * 3600_000).unref();
  lib.purge();
  setInterval(() => lib.purge(), 6 * 3600_000).unref();
  zoom.evict(); setInterval(() => zoom.evict(), 6 * 3600_000).unref();
  const parts = () => { const k = evictParts(); if (k) console.log(`uploads: removed ${k} unfinished uploads untouched for a day`); };
  parts(); setInterval(parts, 6 * 3600_000).unref();
}
