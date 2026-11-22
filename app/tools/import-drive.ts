#!/usr/bin/env bun
// One-time import of a Google Drive folder (the "My Drive" of Drive for desktop):
//   bun tools/import-drive.ts "<…/My Drive>" --origin https://monet.kaleve.dev --session <browser session> [--dry-run] [--log out.tsv]
// Only what Monet can show is sent: photos, videos and the formats of docs/files.md, no `other` files (archives,
// certificates, key stores). Google's own .gdoc/.gsheet are links, not files, and stay out.
// - Below Pictures/<name>/: photos and videos, each into the album <name>, no folder (the photo feed ignores folders).
// - Everything else goes into the Ablage under its Drive path, like a dropped folder (Uni/MA/thesis.pdf -> Uni/MA).
// - A photo or video the library holds as a smaller copy (the Takeout's recompressed one, same name, same picture) is
//   replaced: the server's supersede moves albums, favourite, place and a better date to the original and puts the
//   copy into the trash, from where it is purged after 30 days.
// --skip <file>: paths below the Drive root, one per line, that stay where they are (originals whose smaller copy the
// library keeps on purpose: sending them would put the same photo in twice).
// Safe to run again: files the server has are not sent, a copy that was replaced is in the trash and is not matched again.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { FORMATS, extOf } from "../server/docsniff";
import { known, MEDIA, missing, pool, post, sendFile, sha256File, walk } from "./upload-lib";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const root = args[0] && !args[0].startsWith("--") ? args[0].replace(/\/$/, "") : undefined;
const origin = (opt("origin") ?? process.env.MONET_ORIGIN ?? "").replace(/\/$/, ""), session = opt("session") ?? process.env.MONET_SESSION;
const skipList = opt("skip"), skip = new Set(skipList ? readFileSync(skipList, "utf8").split("\n").map(l => l.trim()).filter(Boolean) : []);
const dry = args.includes("--dry-run"), log = opt("log"), parallel = Math.max(1, Number(opt("parallel") ?? 3));
if (!root || !origin || !session) {
  console.error('usage: bun tools/import-drive.ts "<My Drive>" --origin <url> --session <browser session> [--skip list.txt] [--dry-run] [--log out.tsv] [--parallel 3]');
  process.exit(2);
}
const server = { origin, session };

const HIDDEN = (part: string) => part.startsWith(".") || part.startsWith("~$") || part === "__MACOSX";
const PICTURES = "Pictures";
type Plan = { path: string; rel: string; media: boolean; album: string | null; folder: string | null };
function planOf(path: string): Plan | null {
  const rel = relative(root!, path), parts = rel.split(sep);
  if (parts.some(HIDDEN) || skip.has(rel)) return null;
  const media = MEDIA.test(path), ext = extOf(path);
  if (!media && !(ext && ext in FORMATS)) return null;
  const dir = parts.slice(0, -1);
  if (dir[0] === PICTURES) {
    if (!media) return null;
    return { path, rel, media, album: dir[1] ?? null, folder: null };
  }
  return { path, rel, media, album: null, folder: dir.length ? dir.join("/") : null };
}
const gb = (b: number) => (b / 1e9).toFixed(1);

const plans = [...walk(root)].map(planOf).filter((p): p is Plan => p != null);
const size = new Map(plans.map(p => [p.path, Bun.file(p.path).size] as const));
console.log(`${plans.length} files Monet can show, ${gb(plans.reduce((a, p) => a + size.get(p.path)!, 0))} GB in ${root}`);

// Drive for desktop fetches each file on first read, so hashing is the slow part; four at a time
const hashes = new Map<string, string>();
await pool(plans, 4, async p => { hashes.set(p.path, await sha256File(p.path)); if (hashes.size % 250 === 0) console.log(`hashed ${hashes.size}/${plans.length}`); });
const need = await missing(server, [...new Set(hashes.values())]);
const toSend = plans.filter(p => need.has(hashes.get(p.path)!));
const byExt = new Map<string, number>();
for (const p of toSend) byExt.set(extOf(p.path) ?? "?", (byExt.get(extOf(p.path) ?? "?") ?? 0) + 1);
console.log(`the server lacks ${toSend.length} of them, ${gb(toSend.reduce((a, p) => a + size.get(p.path)!, 0))} GB: ${[...byExt].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${n} ${e}`).join(", ")}`);
if (dry) process.exit(0);

if (log) writeFileSync(log, "result\titem\treplaced\tpath\n");
const note = (result: string, id: number | string, replaced: number | string, p: Plan) => { if (log) appendFileSync(log, `${result}\t${id}\t${replaced}\t${p.rel}\n`); };
const sent = new Map<string, Promise<number | null>>(); // sha -> item id: a file Drive holds twice is sent once
let fresh = 0, replaced = 0, knownN = 0, failed = 0, finished = 0;
await pool(plans, parallel, async p => {
  const sha = hashes.get(p.path)!;
  try {
    let first = false;
    let id = sent.get(sha);
    if (!id) {
      first = true;
      id = (async () => {
        if (!need.has(sha)) {
          if (!p.album) return null; // nothing to add to a file the server has
          const item = await known(server, p.path, sha);
          return item ? item.id as number : null;
        }
        const r = await sendFile(server, p.path, sha, "web", p.folder ? { folder: p.folder } : {});
        return r.item ? r.item.id as number : null;
      })();
      sent.set(sha, id);
    }
    const itemId = await id;
    if (!first || !need.has(sha)) { knownN++; note("known", itemId ?? "", "", p); }
    else if (itemId == null) { fresh++; note("new-file", "", "", p); }
    else {
      const r = await post(server, `/api/items/${itemId}/supersede`, {});
      if (r.replaced) { replaced++; note("replaced", itemId, r.replaced, p); } else { fresh++; note("new", itemId, "", p); }
    }
    if (itemId != null && p.album) await post(server, `/api/items/${itemId}/sidecar`, { albums: [p.album] });
  } catch (e) { failed++; note("failed", "", "", p); console.error(`FAIL ${p.rel}: ${(e as Error).message}`); }
  if (++finished % 100 === 0 || finished === plans.length) console.log(`${finished}/${plans.length}: ${fresh} new, ${replaced} replaced a smaller copy, ${knownN} known, ${failed} failed`);
});
console.log(`done: ${fresh} new, ${replaced} replaced a smaller copy, ${knownN} known, ${failed} failed`);
process.exit(failed ? 1 : 0);
