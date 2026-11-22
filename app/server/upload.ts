// Chunked, resumable upload. The client PUTs consecutive chunks to /api/upload/<sha256>; the server appends them to
// $MONET_DATA/up/<sha256>.part and answers with how much it holds. An offset that is not that size is a 409 with the
// real size, which is how a client resumes after a dropped connection. The last chunk triggers the hash check and ingest.
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db";
import { DATA, ingest, SOURCES, sniff } from "./ingest";
import { summaryById } from "./library";
import { fail, HttpError, J } from "./util";
import type { Principal } from "./auth";
import type { UploadDone } from "../shared/types";

export const CHUNK_MAX = 32 * 1024 * 1024;
const TOTAL_MAX = 8 * 1024 ** 3;
const SHA = /^[0-9a-f]{64}$/;
const busy = new Set<string>(); // one writer per file at a time

const partPath = (sha: string) => join(DATA, "up", `${sha}.part`);

/** A part nobody added to for a day is an upload its client gave up on (deleted on the phone, a browser tab closed).
 *  It goes, or it holds disk space forever; a client that does come back gets a 409 with received 0 and starts over. */
export const PART_TTL = 24 * 3600_000;
export function evictParts(at = Date.now()): number {
  let n = 0;
  let names: string[] = [];
  try { names = readdirSync(join(DATA, "up")); } catch { return 0; }
  for (const f of names) {
    const sha = f.replace(/\.part$/, ""), path = join(DATA, "up", f);
    if (busy.has(sha)) continue;
    try { if (at - statSync(path).mtimeMs > PART_TTL) { rmSync(path, { force: true }); n++; } } catch { /* gone meanwhile */ }
  }
  return n;
}

export function check(owner: number, hashes: unknown) {
  const list = (Array.isArray(hashes) ? hashes : []).filter((h): h is string => typeof h === "string" && SHA.test(h)).slice(0, 2000);
  // soft-deleted items count as present: a photo deleted on purpose must not come back from the next sync
  const have = new Set<string>();
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500);
    for (const r of db.query(`SELECT sha256 FROM item WHERE owner_id = ? AND sha256 IN (${part.map(() => "?").join(",")})`).all(owner, ...part) as { sha256: string }[]) have.add(r.sha256);
  }
  return { missing: list.filter(h => !have.has(h)) };
}

async function sha256File(path: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  for await (const c of Bun.file(path).stream()) h.update(c);
  return h.digest("hex");
}
function head(path: string, n = 32): Uint8Array {
  const fd = openSync(path, "r"); const b = new Uint8Array(n);
  try { const got = readSync(fd, b, 0, n, 0); return b.slice(0, got); } finally { closeSync(fd); }
}

export async function putChunk(req: Request, p: Principal, sha: string): Promise<Response> {
  if (!SHA.test(sha)) return fail(400, "Ungültiger Hash.");
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") ?? 0), total = Number(url.searchParams.get("total"));
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(total) || total <= 0 || total > TOTAL_MAX) return fail(400, total === 0 ? "Die Datei ist leer." : "Ungültige Größe.");
  const len = Number(req.headers.get("content-length"));
  if (!Number.isInteger(len) || len < 0) return fail(411, "Content-Length fehlt.");
  if (len > CHUNK_MAX) return fail(413, "Der Block ist zu groß (höchstens 32 MiB).");
  if (offset + len > total) return fail(400, "Der Block geht über die angegebene Größe hinaus.");

  const existing = db.query("SELECT id FROM item WHERE owner_id = ? AND sha256 = ?").get(p.owner, sha) as { id: number } | null;
  if (existing) {
    await drain(req);
    rmSync(partPath(sha), { force: true });
    const s = summaryById(p.owner, existing.id)!;
    return J({ item: s, duplicate: true } satisfies UploadDone);
  }
  if (busy.has(sha)) { await drain(req); return fail(409, "Dieser Upload läuft gerade.", { received: existsSync(partPath(sha)) ? statSync(partPath(sha)).size : 0 }); }
  busy.add(sha);
  try {
    mkdirSync(join(DATA, "up"), { recursive: true });
    const part = partPath(sha);
    const have = existsSync(part) ? statSync(part).size : 0;
    // a part that already holds every byte lost its last step (a restart between the last chunk and ingest): finish it
    // now. Answering 409 with the full size made clients count the file as sent while the server never stored it.
    if (have > 0 && have >= total) { await drain(req); return await finish(p, sha, part, have, url); }
    if (offset !== have) { await drain(req); return fail(409, "Der Offset passt nicht.", { received: have }); }
    if (offset === 0 && len === 0) return fail(400, "Die Datei ist leer.");

    // append the body; if the connection drops half-way the partial bytes stay and the client learns the size from the next 409
    const fd = openSync(part, "a");
    let wrote = 0;
    try {
      for await (const c of req.body ?? []) {
        if (wrote + c.length > len) { ftruncateSync(fd, have); throw new HttpError(400, "Der Block ist länger als angegeben."); }
        writeSync(fd, c); wrote += c.length;
      }
    } finally { closeSync(fd); }
    if (wrote !== len) { return fail(409, "Der Block war unvollständig.", { received: statSync(part).size }); }
    const size = have + wrote;
    // refuse unknown formats at the first chunk, before gigabytes arrive
    if (offset === 0 && !sniff(head(part))) { rmSync(part, { force: true }); return fail(415, "Dieses Dateiformat wird nicht unterstützt."); }
    if (size < total) return J({ received: size });
    return await finish(p, sha, part, size, url);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message, e.extra);
    throw e;
  } finally { busy.delete(sha); }
}

/** Reads and drops a request body the answer does not need. Answering before the body is read made nginx cut the
 *  stream (broken pipe), and the browser's next PUT on that HTTP/2 connection never arrived. */
async function drain(req: Request) {
  try { for await (const _ of req.body ?? []) { /* discard */ } } catch { /* the client went away: nothing to answer */ }
}

/** The last step of an upload whose bytes are all in `part`: verify the hash, then ingest. */
async function finish(p: Principal, sha: string, part: string, size: number, url: URL): Promise<Response> {
  const actual = await sha256File(part);
  if (actual !== sha) { rmSync(part, { force: true }); return fail(422, "Die Prüfsumme stimmt nicht. Bitte noch einmal hochladen.", { received: 0 }); }
  const sniffed = sniff(head(part));
  if (!sniffed) { rmSync(part, { force: true }); return fail(415, "Dieses Dateiformat wird nicht unterstützt."); }
  const name = url.searchParams.get("name"), mtime = Number(url.searchParams.get("mtime"));
  const dev = p.deviceId != null ? (db.query("SELECT kind FROM auth_device WHERE id = ?").get(p.deviceId) as { kind: string } | null) : null;
  const wanted = url.searchParams.get("source") ?? "web";
  // a device cannot claim to be another kind of source (the Takeout importer runs on a device token and says so)
  const source = dev ? (wanted === "takeout" ? "takeout" : dev.kind) : SOURCES.includes(wanted) ? wanted : "web";
  const r = await ingest({ owner: p.owner, sha, tmp: part, bytes: size, name, mtime: Number.isFinite(mtime) && mtime > 0 ? mtime : null, source, deviceId: p.deviceId, sniffed });
  return J({ item: summaryById(p.owner, r.id)!, duplicate: r.duplicate } satisfies UploadDone);
}
