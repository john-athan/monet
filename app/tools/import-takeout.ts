#!/usr/bin/env bun
// Imports an unpacked Google Takeout: uploads every photo and video, then posts the sidecar JSON (photoTakenTime,
// geoData) to /api/items/:id/sidecar, and puts items into albums named after their folder.
//   bun tools/import-takeout.ts <Takeout dir> --origin https://monet.kaleve.dev --token <device token>
//   bun tools/import-takeout.ts <Takeout dir> --origin https://monet.kaleve.dev --session <browser session>
// A device may only add sidecars to what it sent itself; with --session the photos an earlier import (the browser's
// folder import, say) already brought in get their dates, places and albums too.
// "Photos from 2019" folders are Google's own year buckets, not albums; "Bin" is Google's trash and stays out.
// Safe to run again: files the server has are not sent again (their sidecar is still posted, which the server applies
// only where the file itself had no date or place).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { known, MEDIA, missing, post, sendFile, sha256File, walk } from "./upload-lib";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const root = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
const origin = (opt("origin") ?? process.env.MONET_ORIGIN ?? "").replace(/\/$/, "");
const token = opt("token") ?? process.env.MONET_TOKEN, session = opt("session") ?? process.env.MONET_SESSION;
const parallel = Math.max(1, Number(opt("parallel") ?? 3));
if (!root || !origin || !(token || session)) {
  console.error("usage: bun tools/import-takeout.ts <Takeout dir> --origin <url> (--token <device token> | --session <browser session>) [--parallel 3]");
  process.exit(2);
}
const server = { origin, token, session };

const YEAR_BUCKET = /^(Photos from|Fotos von) \d{4}$/;
const TRASH = /^(Bin|Trash|Papierkorb)$/;
type Side = { takenAt?: number; lat?: number; lon?: number };

/** title -> parsed sidecar, for one directory. Takeout truncates long file names, so the `title` field is the reliable key. */
const sidecars = new Map<string, Map<string, Side>>();
function sidecarsOf(dir: string): Map<string, Side> {
  let m = sidecars.get(dir);
  if (m) return m;
  m = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("._")) continue;
    try {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (typeof j.title !== "string") continue;
      const s: Side = {};
      const t = Number(j.photoTakenTime?.timestamp);
      if (Number.isFinite(t) && t > 0) s.takenAt = t * 1000;
      const g = j.geoData;
      if (g && (g.latitude || g.longitude)) { s.lat = Number(g.latitude); s.lon = Number(g.longitude); }
      m.set(j.title, s);
    } catch { /* not a sidecar */ }
  }
  sidecars.set(dir, m);
  return m;
}
function sidecarFor(path: string): Side | undefined {
  const m = sidecarsOf(dirname(path)), name = basename(path);
  // an edited copy ("IMG_1-edited.jpg", "IMG_1-bearbeitet.jpg") shares the original's sidecar
  return m.get(name) ?? m.get(name.replace(/-(edited|bearbeitet)(?=\.[^.]+$)/i, ""));
}

/** Runs `fn` over `items` with `n` at a time. */
async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}
const gb = (b: number) => (b / 1e9).toFixed(1);
const t0 = Date.now();

const files = [...walk(root)].filter(p => MEDIA.test(p) && !relative(root, p).split("/").some(d => TRASH.test(d)));
const size = new Map(files.map(p => [p, statSync(p).size] as const));
const totalBytes = files.reduce((a, p) => a + size.get(p)!, 0);
console.log(`${files.length} media files, ${gb(totalBytes)} GB in ${root} (trash left out)`);

// Four at a time: a USB drive reads no faster with more, and thousands of open streams at once only thrash it.
const hashes = new Map<string, string>();
await pool(files, 4, async p => { hashes.set(p, await sha256File(p)); if (hashes.size % 1000 === 0) console.log(`hashed ${hashes.size}/${files.length}`); });
const need = await missing(server, [...new Set(hashes.values())]);
const needBytes = files.filter(p => need.has(hashes.get(p)!)).reduce((a, p) => a + size.get(p)!, 0);
console.log(`hashed in ${Math.round((Date.now() - t0) / 1000)} s; the server lacks ${need.size} files, ${gb(needBytes)} GB`);

const done = new Map<string, Promise<number>>(); // sha -> item id, so a duplicate inside the export is sent once
let uploaded = 0, knownCount = 0, failed = 0, sidecarsPosted = 0, sentBytes = 0, finished = 0;
const t1 = Date.now();
await pool(files, parallel, async p => {
  const sha = hashes.get(p)!;
  try {
    let id = done.get(sha);
    if (!id) {
      id = (async () => {
        if (!need.has(sha)) { const item = await known(server, p, sha); if (item) { knownCount++; return item.id as number; } }
        const r = await sendFile(server, p, sha, "takeout");
        if (r.duplicate) knownCount++; else { uploaded++; sentBytes += size.get(p)!; }
        return r.item.id as number;
      })();
      done.set(sha, id);
    } else knownCount++;
    const itemId = await id;
    const folder = basename(dirname(p));
    const albums = YEAR_BUCKET.test(folder) || dirname(p) === root ? [] : [folder];
    await post(server, `/api/items/${itemId}/sidecar`, { ...sidecarFor(p), albums });
    sidecarsPosted++;
  } catch (e) { failed++; console.error(`FAIL ${p}: ${(e as Error).message}`); }
  if (++finished % 100 === 0 || finished === files.length) {
    const s = (Date.now() - t1) / 1000, rate = sentBytes / Math.max(1, s);
    const left = rate > 0 ? Math.round((needBytes - sentBytes) / rate / 60) : 0;
    console.log(`${finished}/${files.length}: ${uploaded} new (${gb(sentBytes)}/${gb(needBytes)} GB, ${(rate * 8 / 1e6).toFixed(0)} Mbit/s, ~${left} min left), ${knownCount} known, ${failed} failed`);
  }
});
console.log(`done: ${uploaded} uploaded, ${knownCount} already known, ${sidecarsPosted} sidecars posted, ${failed} failed, ${Math.round((Date.now() - t0) / 60000)} min`);
process.exit(failed ? 1 : 0);
