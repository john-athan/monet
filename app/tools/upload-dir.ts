#!/usr/bin/env bun
// Uploads every photo and video below a directory to a Monet server with the chunk protocol.
//   bun tools/upload-dir.ts <dir> --origin https://monet.kaleve.dev --token <device token> [--source web|android|mac|takeout]
// Files the server already has are skipped (one /api/upload/check per 500 hashes). Safe to run again.
import { MEDIA, missing, sendFile, sha256File, walk } from "./upload-lib";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dir = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
const origin = (opt("origin") ?? process.env.MONET_ORIGIN ?? "").replace(/\/$/, ""), token = opt("token") ?? process.env.MONET_TOKEN ?? "";
if (!dir || !origin || !token) { console.error("usage: bun tools/upload-dir.ts <dir> --origin <url> --token <device token> [--source web|android|mac|takeout]"); process.exit(2); }
const server = { origin, token };
const source = opt("source") ?? "web";

const files = [...walk(dir)].filter(p => MEDIA.test(p));
console.log(`${files.length} files in ${dir}`);
const hashes = new Map<string, string>();
for (const p of files) hashes.set(p, await sha256File(p));
const need = await missing(server, [...new Set(hashes.values())]);
let sent = 0, dup = 0, skipped = 0, failed = 0;
const sentHash = new Set<string>();
for (const p of files) {
  const sha = hashes.get(p)!;
  if (!need.has(sha) || sentHash.has(sha)) { skipped++; continue; }
  try {
    const r = await sendFile(server, p, sha, source);
    sentHash.add(sha);
    r.duplicate ? dup++ : sent++;
    console.log(`ok   ${p.split("/").pop()} -> item ${r.item.id}`);
  } catch (e) { failed++; console.error(`FAIL ${(e as Error).message}`); }
}
console.log(`done: ${sent} uploaded, ${dup} already known, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
