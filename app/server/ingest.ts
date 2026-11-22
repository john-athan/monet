// Ingest: what happens to a file after its last chunk arrived (spec "Ingest", steps 1 to 7). One at a time, in a queue,
// because the server has two cores and shares them with the mail server. Every step can be repeated: processItem() is
// what the startup sweep runs again for items whose thumbs_ok is still 0.
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { db } from "./db";
import { kmeans, rgbToHex, readPpm } from "./calc";
import { dateFromName, emptyMeta, metaFromFfprobe, metaFromVips, type Meta } from "./exif";
import { reindexFts } from "./fts";
import { kickOcr } from "./ocr-queue";
import { placeIdFor } from "./places";
import { berlinOffsetMin, HttpError, localDay, now, run, runText } from "./util";

export const DATA = process.env.MONET_DATA ?? "data/files";
export const ORIGINALS = process.env.MONET_ORIGINALS ?? join(DATA, "originals");
export const thumbPath = (sha: string, size: "s" | "m" | "l") => join(DATA, "t", sha.slice(0, 2), `${sha}-${size}.webp`);
const VIPS_ENV = { VIPS_CONCURRENCY: "1" }; // two cores shared with mail: do not spawn a thread pool per call

/* ---------- queue ---------- */
let tail: Promise<unknown> = Promise.resolve();
/** Runs jobs strictly one after another. A failing job does not stop the queue. */
export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const r = tail.then(job, job);
  tail = r.catch(() => {});
  return r;
}

/* ---------- what is this file ---------- */
export type Sniffed = { kind: "photo" | "video"; mime: string; ext: string };
/** Decides by the first bytes, never by the name: only these formats are ever stored. */
export function sniff(h: Uint8Array): Sniffed | null {
  const s = (a: number, n: number) => String.fromCharCode(...h.slice(a, a + n));
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { kind: "photo", mime: "image/jpeg", ext: "jpg" };
  if (s(1, 3) === "PNG" && h[0] === 0x89) return { kind: "photo", mime: "image/png", ext: "png" };
  if (s(0, 3) === "GIF") return { kind: "photo", mime: "image/gif", ext: "gif" };
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return { kind: "photo", mime: "image/webp", ext: "webp" };
  if ((s(0, 2) === "II" && h[2] === 42 && h[3] === 0) || (s(0, 2) === "MM" && h[2] === 0 && h[3] === 42)) return { kind: "photo", mime: "image/tiff", ext: "tif" };
  if (s(4, 4) === "ftyp") {
    const brand = s(8, 4);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return { kind: "photo", mime: "image/heic", ext: "heic" };
    if (/^(avif|avis)$/.test(brand)) return { kind: "photo", mime: "image/avif", ext: "avif" };
    if (brand === "qt  ") return { kind: "video", mime: "video/quicktime", ext: "mov" };
    return { kind: "video", mime: "video/mp4", ext: "mp4" };
  }
  // older QuickTime writers (iPhones of 2022 among them) start with a "wide" or "mdat" atom and leave out ftyp
  if (/^(wide|mdat|moov|free|skip|pnot)$/.test(s(4, 4))) return { kind: "video", mime: "video/quicktime", ext: "mov" };
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return { kind: "video", mime: "video/webm", ext: "webm" };
  // JPEG 2000, which some tools save under a .jpg name; libvips reads it, the viewer shows the thumbnails
  if (s(4, 4) === "jP  " && h[8] === 0x0d && h[9] === 0x0a && h[10] === 0x87 && h[11] === 0x0a) return { kind: "photo", mime: "image/jp2", ext: "jp2" };
  return null;
}

/* ---------- step 2: metadata ---------- */
async function probe(path: string, kind: "photo" | "video"): Promise<Meta> {
  if (kind === "photo") return metaFromVips(await runText(["vipsheader", "-a", path], 30_000, VIPS_ENV));
  return metaFromFfprobe(JSON.parse(await runText(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], 30_000)));
}

type Dated = { takenAt: number; tzMin: number | null; src: "exif" | "name" | "sidecar" | "mtime" | "upload" };
/** The date fallback chain of the spec: EXIF, file name, (sidecar, applied later), file mtime, upload time. */
export function chooseDate(meta: Meta, name: string | null, mtime: number | null, uploadedAt: number): Dated {
  if (meta.taken) return { takenAt: meta.taken.utc, tzMin: meta.taken.tzMin, src: "exif" };
  const n = name ? dateFromName(name) : null;
  if (n) return { takenAt: n.utc, tzMin: null, src: "name" };
  // a mtime in the future or before 1990 is a broken clock, not a date
  if (mtime && mtime > 631152000_000 && mtime < uploadedAt + 86400_000) return { takenAt: mtime, tzMin: null, src: "mtime" };
  return { takenAt: uploadedAt, tzMin: null, src: "upload" };
}

function moveFile(from: string, to: string) {
  mkdirSync(dirname(to), { recursive: true });
  try { renameSync(from, to); } catch (e: any) { if (e.code !== "EXDEV") throw e; copyFileSync(from, to); rmSync(from); } // originals may sit on another mount
}

/* ---------- steps 3 to 7: derived data ---------- */
async function makeThumbs(sha: string, src: string) {
  mkdirSync(dirname(thumbPath(sha, "s")), { recursive: true });
  // write to a temp name and rename: a crash never leaves half a thumbnail that thumbs_ok then vouches for
  const plan: [("s" | "m" | "l"), string[]][] = [
    ["m", ["-s", "720x720>"]], ["s", ["-s", "256x256", "-m", "attention"]], ["l", ["-s", "2048x2048>"]],
  ];
  // m first: s is cut from it (same crop, far cheaper than decoding a big HEIC a second time)
  for (const [size, args] of plan) {
    const out = thumbPath(sha, size), tmp = out.replace(/\.webp$/, ".part.webp");
    const input = size === "s" && existsSync(thumbPath(sha, "m")) ? thumbPath(sha, "m") : src;
    await run(["vipsthumbnail", input, ...args, "-o", `${tmp}[Q=${size === "s" ? 78 : 82},strip]`], 120_000, VIPS_ENV);
    renameSync(tmp, out);
  }
}
async function colours(sha: string): Promise<{ color: string; colors: string[] }> {
  const ppm = join(DATA, "up", `${sha}.colors.ppm`);
  mkdirSync(dirname(ppm), { recursive: true });
  try {
    await run(["vipsthumbnail", thumbPath(sha, "m"), "-s", "16x16", "-o", ppm], 30_000, VIPS_ENV);
    const { mean, centres } = kmeans(readPpm(new Uint8Array(await Bun.file(ppm).arrayBuffer())), 3);
    return { color: rgbToHex(mean), colors: centres.map(rgbToHex) };
  } finally { rmSync(ppm, { force: true }); }
}

/** Same owner, same camera, within 2 s of a neighbour: one burst. Rank by file size, biggest first (a sharper JPEG is
 *  larger); rank 1 is what the timeline shows. Merges two bursts when the new item bridges them. */
export function updateBurst(itemId: number) {
  const it = db.query("SELECT id, owner_id, kind, camera, taken_at, burst_id, unstacked FROM item WHERE id = ?").get(itemId) as any;
  if (!it || it.kind !== "photo" || !it.camera || it.unstacked) return;
  const near = db.query(`SELECT id, burst_id FROM item WHERE owner_id = ? AND kind = 'photo' AND camera = ? AND id != ? AND unstacked = 0 AND taken_at BETWEEN ? AND ?`)
    .all(it.owner_id, it.camera, it.id, it.taken_at - 2000, it.taken_at + 2000) as { id: number; burst_id: number | null }[];
  if (!near.length && it.burst_id == null) return;
  joinStack(it, near);
}
/** Puts `it` and `others` into one stack, merging any stacks they already belong to. The stack is named after its
 *  smallest member or stack id, so merging is order independent. Shared by bursts (here) and variations (stack.ts).
 *  Returns false when they already were one stack. */
export function joinStack(it: { id: number; burst_id: number | null }, others: { id: number; burst_id: number | null }[]): boolean {
  const ids = new Set<number>([it.id, ...others.map(n => n.id)]);
  const stacks = new Set(others.map(n => n.burst_id).filter((x): x is number => x != null));
  if (it.burst_id != null) stacks.add(it.burst_id);
  const id = Math.min(...ids, ...stacks);
  if (it.burst_id === id && others.every(o => o.burst_id === id)) return false;
  db.transaction(() => {
    for (const s of stacks) db.query("UPDATE item SET burst_id = ? WHERE burst_id = ?").run(id, s);
    for (const i of ids) db.query("UPDATE item SET burst_id = ? WHERE id = ?").run(id, i);
    rankBurst(id);
  })();
  return true;
}
/** Ranks the live members of one burst. A burst of one is no burst. Deleted members do not count. */
export function rankBurst(burstId: number | null) {
  if (burstId == null) return;
  const m = db.query("SELECT id FROM item WHERE burst_id = ? AND deleted_at IS NULL ORDER BY bytes DESC, id").all(burstId) as { id: number }[];
  db.query("UPDATE item SET burst_rank = NULL WHERE burst_id = ? AND deleted_at IS NOT NULL").run(burstId);
  m.forEach((r, i) => db.query("UPDATE item SET burst_rank = ? WHERE id = ?").run(i + 1, r.id));
}

/** Steps 3 to 7 for an item that already has its row and its original. Safe to run again. */
export async function processItem(id: number) {
  const it = db.query("SELECT id, sha256, kind, orig_path, lat, lon FROM item WHERE id = ?").get(id) as any;
  if (!it) return;
  const orig = join(ORIGINALS, it.orig_path);
  let src = orig, frame: string | null = null;
  try {
    if (it.kind === "video") {
      frame = join(DATA, "up", `${it.sha256}.frame.jpg`);
      mkdirSync(dirname(frame), { recursive: true });
      const dur = (db.query("SELECT duration_ms FROM item WHERE id = ?").get(id) as any).duration_ms ?? 0;
      // a frame at 1 s; shorter clips take their first frame
      await videoFrame(orig, frame, dur > 1500 ? 1 : 0);
      src = frame;
    }
    await makeThumbs(it.sha256, src);
    const c = await colours(it.sha256);
    const place = it.lat != null && it.lon != null ? placeIdFor(it.lat, it.lon) : null;
    db.query("UPDATE item SET color = ?, colors = ?, place_id = ?, thumbs_ok = 1 WHERE id = ?").run(c.color, JSON.stringify(c.colors), place, id);
    borrowPlaces(id);
    updateBurst(id);
    reindexFts(id);
    if (it.kind === "photo") kickOcr();
  } finally { if (frame) rmSync(frame, { force: true }); }
}

/** One frame of a video at `at` seconds, as JPEG. Some phones (a Samsung video of 2023 in the Takeout) mark the colour
 *  space "reserved" in the stream itself, which ffmpeg 7.1 refuses to convert ("Invalid color space"): then the first
 *  seconds are copied with the marks set to "unspecified", and the frame comes from that copy. The original stays as it is. */
async function videoFrame(orig: string, frame: string, at: number) {
  const grab = (input: string) => run(["ffmpeg", "-nostdin", "-v", "error", "-ss", String(at), "-i", input, "-frames:v", "1", "-y", frame], 180_000);
  try { await grab(orig); return; } catch (e) {
    if (!/Invalid color space/i.test((e as Error).message)) throw e;
    const codec = (await runText(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", orig], 30_000)).trim();
    const bsf = codec === "h264" ? "h264_metadata" : codec === "hevc" ? "hevc_metadata" : null;
    if (!bsf) throw e;
    const copy = frame.replace(/\.jpg$/, ".ts");
    try {
      await run(["ffmpeg", "-nostdin", "-v", "error", "-i", orig, "-t", String(at + 1), "-map", "0:v:0", "-c:v", "copy",
        "-bsf:v", `${bsf}=colour_primaries=2:transfer_characteristics=2:matrix_coefficients=2`, "-f", "mpegts", "-y", copy], 180_000);
      await grab(copy);
    } finally { rmSync(copy, { force: true }); }
  }
}

/* ---------- a place for videos without one ---------- */
const NEAR_MS = 10 * 60_000;
/** A phone often records a video before it has a GPS fix, so the video has no place while the photos around it do.
 *  Such a video takes the place of the photo or video with GPS nearest in time, within 10 minutes, in the same
 *  library. Only videos: a photo without GPS is mostly a screenshot or a download, and those were not taken there. */
function placeVideo(owner: number, id: number, takenAt: number): boolean {
  const n = db.query(`SELECT lat, lon FROM item WHERE owner_id = ? AND id != ? AND deleted_at IS NULL AND lat IS NOT NULL AND lon IS NOT NULL
      AND taken_at BETWEEN ? AND ? ORDER BY abs(taken_at - ?) LIMIT 1`).get(owner, id, takenAt - NEAR_MS, takenAt + NEAR_MS, takenAt) as { lat: number; lon: number } | null;
  if (!n) return false;
  db.query("UPDATE item SET lat = ?, lon = ?, place_id = ? WHERE id = ? AND lat IS NULL").run(n.lat, n.lon, placeIdFor(n.lat, n.lon), id);
  return true;
}
/** After `id` is in: a video without a place looks for one; an item with a place lends it to such videos around it
 *  (upload order is not shooting order, so either may arrive first). */
export function borrowPlaces(id: number) {
  const it = db.query("SELECT owner_id, kind, taken_at, lat FROM item WHERE id = ?").get(id) as { owner_id: number; kind: string; taken_at: number; lat: number | null } | null;
  if (!it) return;
  if (it.lat == null) { if (it.kind === "video") placeVideo(it.owner_id, id, it.taken_at); return; }
  const open = db.query(`SELECT id, taken_at FROM item WHERE owner_id = ? AND kind = 'video' AND lat IS NULL AND deleted_at IS NULL AND taken_at BETWEEN ? AND ?`)
    .all(it.owner_id, it.taken_at - NEAR_MS, it.taken_at + NEAR_MS) as { id: number; taken_at: number }[];
  for (const v of open) placeVideo(it.owner_id, v.id, v.taken_at);
}
/** Startup: videos that came in before this rule existed. Each one is a single indexed lookup, so it runs every time. */
export function placeVideos(): number {
  const open = db.query("SELECT id, owner_id, taken_at FROM item WHERE kind = 'video' AND lat IS NULL AND deleted_at IS NULL").all() as { id: number; owner_id: number; taken_at: number }[];
  let n = 0;
  for (const v of open) if (placeVideo(v.owner_id, v.id, v.taken_at)) n++;
  return n;
}

/* ---------- step 1 and the row ---------- */
export type IngestIn = { owner: number; sha: string; tmp: string; bytes: number; name: string | null; mtime: number | null; source: string; deviceId: number | null; sniffed: Sniffed };
export const SOURCES = ["web", "android", "mac", "takeout"];

/** The whole pipeline for one verified upload. Returns the item id and whether it already existed. Runs inside the queue. */
export function ingest(i: IngestIn): Promise<{ id: number; duplicate: boolean }> {
  return enqueue(async () => {
    const have = db.query("SELECT id FROM item WHERE owner_id = ? AND sha256 = ?").get(i.owner, i.sha) as { id: number } | null;
    if (have) { rmSync(i.tmp, { force: true }); return { id: have.id, duplicate: true }; }
    const uploadedAt = now();
    const work = join(DATA, "up", `${i.sha}.${i.sniffed.ext}`);
    renameSync(i.tmp, work);
    let meta: Meta;
    try { meta = await probe(work, i.sniffed.kind); }
    catch (e) { rmSync(work, { force: true }); throw new HttpError(422, "file could not be read as " + i.sniffed.kind); }
    const d = chooseDate(meta, i.name, i.mtime, uploadedAt);
    const day = localDay(d.takenAt, d.tzMin);
    const rel = `${day.slice(0, 4)}/${day.slice(5, 7)}/${i.sha}.${i.sniffed.ext}`;
    const dest = join(ORIGINALS, rel);
    if (existsSync(dest)) rmSync(work, { force: true }); else moveFile(work, dest); // never overwrite an original
    const name = i.name ? basename(i.name).slice(0, 200) : null;
    const row = db.query(`INSERT INTO item (owner_id, sha256, kind, mime, ext, bytes, width, height, taken_at, tz_min, taken_src, day, lat, lon, camera, exposure, fnumber, iso, focal,
        duration_ms, orig_name, source, device_id, uploaded_at, orig_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .get(i.owner, i.sha, i.sniffed.kind, i.sniffed.mime, i.sniffed.ext, i.bytes, meta.width, meta.height, d.takenAt, d.tzMin, d.src, day, meta.lat, meta.lon, meta.camera,
        meta.exposure, meta.fnumber, meta.iso, meta.focal, meta.durationMs, name, SOURCES.includes(i.source) ? i.source : "web", i.deviceId, uploadedAt, rel) as { id: number };
    try { await processItem(row.id); } catch (e) { console.error(`ingest ${row.id} (${name}): thumbnails failed, the sweep retries at next start:`, (e as Error).message); }
    return { id: row.id, duplicate: false };
  });
}

/** Startup sweep: items that have a row but never finished steps 3 to 7. */
export async function sweep() {
  const ids = (db.query("SELECT id FROM item WHERE thumbs_ok = 0 AND deleted_at IS NULL ORDER BY id").all() as { id: number }[]).map(r => r.id);
  for (const id of ids) {
    try { await enqueue(() => processItem(id)); } catch (e) { console.error(`sweep ${id}:`, (e as Error).message); }
  }
  return ids.length;
}

/* ---------- sidecar (Takeout) ---------- */
export type Sidecar = { takenAt?: number; lat?: number; lon?: number; albums?: string[] };
/** Takeout's photoTakenTime and geoData. Follows the date order of the spec: it fills in only what the file itself
 *  (EXIF, then the file name) did not know. Albums are created by name. */
export function applySidecar(owner: number, id: number, s: Sidecar) {
  const it = db.query("SELECT * FROM item WHERE id = ? AND owner_id = ?").get(id, owner) as any;
  if (!it) throw new HttpError(404, "not found");
  const sets: string[] = [], args: any[] = [];
  if (Number.isFinite(s.takenAt) && s.takenAt! > 631152000_000 && s.takenAt! < now() + 86400_000 && (it.taken_src === "mtime" || it.taken_src === "upload")) {
    const tz = null, day = localDay(s.takenAt!, tz);
    sets.push("taken_at = ?", "tz_min = ?", "taken_src = 'sidecar'", "day = ?"); args.push(s.takenAt, tz, day);
  }
  const hasGeo = Number.isFinite(s.lat) && Number.isFinite(s.lon) && !(s.lat === 0 && s.lon === 0) && Math.abs(s.lat!) <= 90 && Math.abs(s.lon!) <= 180;
  if (hasGeo && it.lat == null) { sets.push("lat = ?", "lon = ?", "place_id = ?"); args.push(s.lat, s.lon, placeIdFor(s.lat!, s.lon!)); }
  if (sets.length) db.query(`UPDATE item SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
  for (const raw of (s.albums ?? []).slice(0, 20)) {
    const name = String(raw).trim().slice(0, 120);
    if (!name) continue;
    const a = (db.query("SELECT id FROM album WHERE owner_id = ? AND name = ?").get(owner, name) as { id: number } | null)
      ?? db.query("INSERT INTO album (owner_id, name, created_at) VALUES (?, ?, ?) RETURNING id").get(owner, name, now()) as { id: number };
    db.query("INSERT OR IGNORE INTO album_item (album_id, item_id, added_at) VALUES (?, ?, ?)").run(a.id, id, now());
    db.query("UPDATE album SET cover_item_id = coalesce(cover_item_id, ?) WHERE id = ?").run(id, a.id);
  }
  if (sets.length) { updateBurst(id); }
  reindexFts(id);
}

/* ---------- a better copy of a photo the library already has ---------- */
// The Takeout gave recompressed copies (Google's "storage saver"); the originals came later from Drive under the same
// name. The original takes over what the copy had gathered, the copy goes to the trash. Faces, labels and the text
// are not carried over: the indexer works on the original again.
const DATE_RANK: Record<string, number> = { exif: 0, sidecar: 1, name: 2, mtime: 3, upload: 4 };
const DAY_MS = 86400_000;
type Cand = { id: number; kind: string; bytes: number; width: number | null; height: number | null; taken_at: number; tz_min: number | null; taken_src: string; day: string;
  lat: number | null; lon: number | null; place_id: number | null; favorite: number; folder_id: number | null; burst_id: number | null; unstacked: number; orig_name: string | null };
/** Same picture? Same aspect (either way round, for a copy that was rotated on the way) and no more pixels than the original. */
function samePicture(a: Cand, b: Cand): boolean {
  if (!a.width || !a.height || !b.width || !b.height) return a.kind === "video"; // ffprobe may not know a size
  const r = (w: number, h: number) => w / h, ra = r(a.width, a.height);
  const fits = (w: number, h: number) => Math.abs(r(w, h) - ra) / ra < 0.02;
  return (fits(b.width, b.height) || fits(b.height, b.width)) && a.width * a.height >= b.width * b.height * 0.98;
}
/** Finds the smaller Takeout copy of `newId` (same name and kind, fewer bytes, the same picture, taken within a day: a copy may
 *  read its time in another zone) and puts `newId` in its place. Returns the id of the copy, or null when there is none. */
export function supersede(owner: number, newId: number): number | null {
  const COLS = "id, kind, bytes, width, height, taken_at, tz_min, taken_src, day, lat, lon, place_id, favorite, folder_id, burst_id, unstacked, orig_name";
  const it = db.query(`SELECT ${COLS} FROM item WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`).get(newId, owner) as Cand | null;
  if (!it) throw new HttpError(404, "Das gibt es nicht (mehr).");
  if (!it.orig_name) return null;
  const old = (db.query(`SELECT ${COLS} FROM item WHERE owner_id = ? AND id != ? AND deleted_at IS NULL AND source = 'takeout' AND kind = ? AND lower(orig_name) = lower(?) AND bytes < ?`)
    .all(owner, it.id, it.kind, it.orig_name, it.bytes) as Cand[])
    .filter(o => Math.abs(o.taken_at - it.taken_at) <= DAY_MS && samePicture(it, o))
    .sort((a, b) => Math.abs(a.taken_at - it.taken_at) - Math.abs(b.taken_at - it.taken_at))[0];
  if (!old) return null;
  db.transaction(() => {
    const sets = ["favorite = ?", "unstacked = ?"], args: any[] = [Math.max(it.favorite, old.favorite), Math.max(it.unstacked, old.unstacked)];
    if ((DATE_RANK[old.taken_src] ?? 9) < (DATE_RANK[it.taken_src] ?? 9)) {
      sets.push("taken_at = ?", "tz_min = ?", "taken_src = ?", "day = ?"); args.push(old.taken_at, old.tz_min, old.taken_src, old.day);
    }
    if (it.lat == null && old.lat != null) { sets.push("lat = ?", "lon = ?", "place_id = ?"); args.push(old.lat, old.lon, old.place_id); }
    if (it.folder_id == null && old.folder_id != null) { sets.push("folder_id = ?"); args.push(old.folder_id); }
    db.query(`UPDATE item SET ${sets.join(", ")} WHERE id = ?`).run(...args, it.id);
    db.query("INSERT OR IGNORE INTO album_item (album_id, item_id, added_at) SELECT album_id, ?, added_at FROM album_item WHERE item_id = ?").run(it.id, old.id);
    db.query("DELETE FROM album_item WHERE item_id = ?").run(old.id);
    db.query("UPDATE album SET cover_item_id = ? WHERE cover_item_id = ?").run(it.id, old.id);
    db.query("UPDATE item SET deleted_at = ? WHERE id = ?").run(now(), old.id);
  })();
  rankBurst(old.burst_id);
  updateBurst(it.id);
  reindexFts(it.id);
  return old.id;
}
