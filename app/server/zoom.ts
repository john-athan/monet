// Deep zoom and the original. A photo can be looked at down to its last pixel: libvips (already on the server) cuts the
// original into a pyramid of 512 px WebP tiles (DeepZoom layout) the first time someone opens it in the viewer; the
// client loads only the tiles it sees at the level it needs. Tiles are a cache: the newest KEEP pyramids stay, the rest
// is removed, and a removed one is simply made again.
// HDR is read from the original's first bytes (gain-map markers, or a PQ/HLG transfer in an nclx colour box); an HDR
// screen then shows the original itself, which the browser renders in HDR.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db";
import { DATA, ORIGINALS } from "./ingest";
import { run } from "./util";

export const TILE = 510, OVERLAP = 1; // 510 + 2 x 1 overlap = 512 px tiles
const KEEP = Number(process.env.MONET_ZOOM_KEEP ?? 400);
const VIPS_ENV = { VIPS_CONCURRENCY: "1" };
const ROOT = join(DATA, "z");
const dirOf = (sha: string) => join(ROOT, sha.slice(0, 2), sha);
const dziOf = (sha: string) => join(dirOf(sha), "p.dzi");

export type ZoomInfo = { ready: boolean; w: number; h: number; tile: number; overlap: number; maxLevel: number; hdr: boolean; mime: string; bytes: number };

// ---- HDR from the first bytes
const MARKERS = ["hdrgm:", "http://ns.adobe.com/hdr-gain-map/", "urn:com:apple:photo:2020:aux:hdrgainmap", "urn:iso:std:iso:ts:21496:-1"];
/** Does this file carry HDR: a gain map (Ultra HDR, Adobe, Apple, ISO 21496, AVIF tmap) or a PQ/HLG transfer? */
export function isHdr(head: Uint8Array): boolean {
  const s = Buffer.from(head).toString("latin1");
  if (MARKERS.some(m => s.includes(m))) return true;
  const bmff = s.slice(4, 8) === "ftyp";
  if (bmff && s.slice(0, 65536).includes("tmap")) return true; // the gain-map item of an AVIF or HEIF (ISO 21496)
  // ISOBMFF colr box of type nclx: primaries (2 bytes), transfer (2 bytes); 16 is PQ, 18 is HLG
  for (let i = s.indexOf("colrnclx"); i >= 0; i = s.indexOf("colrnclx", i + 1)) {
    const t = (head[i + 10] << 8) | head[i + 11];
    if (t === 16 || t === 18) return true;
  }
  return false;
}
const hdrCache = new Map<string, boolean>();
function hdrOf(sha: string, path: string): boolean {
  let v = hdrCache.get(sha);
  if (v === undefined) {
    const buf = new Uint8Array(262144);
    let n = 0;
    try { const fd = openSync(path, "r"); try { n = readSync(fd, buf, 0, buf.length, 0); } finally { closeSync(fd); } } catch {}
    v = isHdr(buf.subarray(0, n));
    hdrCache.set(sha, v);
  }
  return v;
}

// ---- the pyramid
/** Width, height and levels from a DeepZoom descriptor. */
export function parseDzi(xml: string): { w: number; h: number; maxLevel: number } | null {
  const w = Number(/Width="(\d+)"/.exec(xml)?.[1]), h = Number(/Height="(\d+)"/.exec(xml)?.[1]);
  if (!(w > 0 && h > 0)) return null;
  return { w, h, maxLevel: Math.ceil(Math.log2(Math.max(w, h))) };
}

const queue: { sha: string; path: string }[] = [];
const busy = new Set<string>();
let working = false;
async function make(sha: string, path: string) {
  const dir = dirOf(sha), tmp = dir + ".part", v = join(ROOT, `${sha}.v`);
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  try {
    // turned upright first (dzsave itself ignores the orientation tag), then cut
    await run(["vips", "autorot", path, v], 180_000, VIPS_ENV);
    await run(["vips", "dzsave", v, join(tmp, "p"), "--layout", "dz", "--tile-size", String(TILE), "--overlap", String(OVERLAP), "--suffix", ".webp[Q=85,keep=icc]"], 300_000, VIPS_ENV);
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir); // only a finished pyramid is ever visible
  } finally { rmSync(v, { force: true }); rmSync(tmp, { recursive: true, force: true }); }
}
async function pump() {
  if (working) return;
  working = true;
  try {
    for (let job = queue.pop(); job; job = queue.pop()) { // newest first: what is being looked at now
      try { await make(job.sha, job.path); } catch (e: any) { console.error("zoom:", job.sha.slice(0, 12), e?.message ?? e); }
      busy.delete(job.sha);
    }
  } finally { working = false; }
  evict();
}
function want(sha: string, path: string) {
  if (busy.has(sha)) return;
  busy.add(sha); queue.push({ sha, path });
  while (queue.length > 4) busy.delete(queue.shift()!.sha); // a fast flick through photos leaves only the last few
  pump();
}

/** What the viewer needs to zoom a photo; asks for its pyramid when there is none yet. */
export function info(owner: number, itemId: number): ZoomInfo | null {
  const it = db.query("SELECT sha256, mime, kind, orig_path, bytes, width, height FROM item WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").get(itemId, owner) as
    { sha256: string; mime: string; kind: string; orig_path: string; bytes: number; width: number; height: number } | null;
  if (!it || it.kind !== "photo") return null;
  const path = join(ORIGINALS, it.orig_path), hdr = hdrOf(it.sha256, path), dzi = dziOf(it.sha256);
  const base = { tile: TILE, overlap: OVERLAP, hdr, mime: it.mime, bytes: it.bytes };
  if (existsSync(dzi)) {
    const p = parseDzi(readFileSync(dzi, "utf8"));
    if (p) { touch(it.sha256); return { ready: true, ...p, ...base }; }
  }
  want(it.sha256, path);
  return { ready: false, w: it.width, h: it.height, maxLevel: Math.ceil(Math.log2(Math.max(it.width, it.height, 1))), ...base };
}

/** The file of one tile, or null. */
export function tilePath(owner: number, itemId: number, level: number, col: number, row: number): string | null {
  const it = db.query("SELECT sha256 FROM item WHERE id = ? AND owner_id = ?").get(itemId, owner) as { sha256: string } | null;
  if (!it) return null;
  const p = join(dirOf(it.sha256), "p_files", String(level), `${col}_${row}.webp`);
  return existsSync(p) ? p : null;
}

function touch(sha: string) { try { const t = new Date(); utimesSync(dirOf(sha), t, t); } catch {} }
/** Keep the KEEP most recently looked-at pyramids and those of photos that still exist; remove the rest. */
export function evict() {
  if (!existsSync(ROOT)) return;
  const live = new Set((db.query("SELECT sha256 FROM item WHERE deleted_at IS NULL").all() as { sha256: string }[]).map(r => r.sha256));
  const all: { dir: string; sha: string; t: number }[] = [];
  for (const a of readdirSync(ROOT)) {
    const sub = join(ROOT, a);
    if (a.endsWith(".v")) { if (!busy.size) rmSync(sub, { force: true }); continue; } // a temp left by a crash
    if (!statSync(sub).isDirectory()) continue;
    for (const sha of readdirSync(sub)) {
      const dir = join(sub, sha);
      if (sha.endsWith(".part")) { if (!busy.has(sha.slice(0, -5))) rmSync(dir, { recursive: true, force: true }); continue; }
      all.push({ dir, sha, t: statSync(dir).mtimeMs });
    }
  }
  all.sort((a, b) => b.t - a.t);
  all.forEach((x, i) => { if (i >= KEEP || !live.has(x.sha)) rmSync(x.dir, { recursive: true, force: true }); });
}
