// Chunked, resumable upload. The client PUTs consecutive chunks to /api/upload/<sha256>; the server appends them to
// $MONET_DATA/up/<sha256>.part and answers with how much it holds. An offset that is not that size is a 409 with the
// real size, which is how a client resumes after a dropped connection. The last chunk triggers the hash check and ingest.
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db";
import { docCandidate, isTextName, sniffDoc, type DocType } from "./docsniff";
import { ingestDoc, summaryById as docById } from "./docs";
import { ensurePath } from "./folders";
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
  // soft-deleted items count as present: a photo deleted on purpose must not come back from the next sync; files likewise
  const have = new Set<string>();
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500), marks = part.map(() => "?").join(",");
    for (const t of ["item", "doc"]) for (const r of db.query(`SELECT sha256 FROM ${t} WHERE owner_id = ? AND sha256 IN (${marks})`).all(owner, ...part) as { sha256: string }[]) have.add(r.sha256);
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
/** The final decision whether a whole file is a document: the head and the zip directory are read from where they lie. */
function sniffDocFile(path: string, name: string | null): DocType | null {
  const fd = openSync(path, "r");
  try {
    return sniffDoc({ size: statSync(path).size, read: (off, len) => { const b = new Uint8Array(len); return b.subarray(0, readSync(fd, b, 0, len, off)); } }, name);
  } finally { closeSync(fd); }
}
/** folder= (a path below in=) and in= (a folder id) of an upload: undefined when the client named neither, else the folder
 *  the file belongs in (null: the top). Missing folders on the way are made. */
function folderOf(owner: number, url: URL): number | null | undefined {
  const path = url.searchParams.get("folder"), raw = url.searchParams.get("in");
  if (!path && !raw) return undefined;
  const inId = raw ? Number(raw) : 0;
  if (!Number.isInteger(inId) || inId < 0) throw new HttpError(400, "Ungültiger Ordner.");
  return ensurePath(owner, inId || null, path);
}
/** A file that is already in the library keeps its row; it goes into the named folder only if it had none. */
function placeKnown(table: "item" | "doc", owner: number, id: number, url: URL) {
  const r = db.query(`SELECT folder_id FROM ${table} WHERE id = ? AND owner_id = ?`).get(id, owner) as { folder_id: number | null } | null;
  if (!r || r.folder_id != null) return;
  const f = folderOf(owner, url);
  if (f != null) db.query(`UPDATE ${table} SET folder_id = ? WHERE id = ?`).run(f, id);
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
    placeKnown("item", p.owner, existing.id, url);
    const s = summaryById(p.owner, existing.id)!;
    return J({ item: s, duplicate: true } satisfies UploadDone);
  }
  const knownDoc = db.query("SELECT id FROM doc WHERE owner_id = ? AND sha256 = ?").get(p.owner, sha) as { id: number } | null;
  if (knownDoc) {
    await drain(req);
    rmSync(partPath(sha), { force: true });
    placeKnown("doc", p.owner, knownDoc.id, url);
    return J({ doc: docById(p.owner, knownDoc.id)!, duplicate: true } satisfies UploadDone);
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
    // (photos and videos by their magic bytes; a document candidate is decided at the last chunk, when the whole file is there)
    if (offset === 0 && !sniff(head(part)) && !docCandidate(head(part, 65536), url.searchParams.get("name"))) { rmSync(part, { force: true }); return fail(415, "Dieses Dateiformat wird nicht unterstützt."); }
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
  const name = url.searchParams.get("name"), mtime = Number(url.searchParams.get("mtime"));
  // a name that only text can carry wins over picture-like first bytes (a note that starts with "GIF")
  let doc = isTextName(name) ? sniffDocFile(part, name) : null;
  const sniffed = doc ? null : sniff(head(part));
  if (!sniffed && !doc) doc = sniffDocFile(part, name);
  if (!sniffed && !doc) { rmSync(part, { force: true }); return fail(415, "Dieses Dateiformat wird nicht unterstützt."); }
  const dev = p.deviceId != null ? (db.query("SELECT kind FROM auth_device WHERE id = ?").get(p.deviceId) as { kind: string } | null) : null;
  const wanted = url.searchParams.get("source") ?? "web";
  // a device cannot claim to be another kind of source (the Takeout importer runs on a device token and says so)
  const source = dev ? (wanted === "takeout" ? "takeout" : dev.kind) : SOURCES.includes(wanted) ? wanted : "web";
  const when = Number.isFinite(mtime) && mtime > 0 ? mtime : null;
  const folderId = folderOf(p.owner, url); // before anything is stored: a folder that is gone is a 404 and the part stays
  if (doc) {
    const r = ingestDoc({ owner: p.owner, sha, tmp: part, bytes: size, name, mtime: when, source, deviceId: p.deviceId, type: doc, folderId });
    return J({ doc: docById(p.owner, r.id)!, duplicate: r.duplicate } satisfies UploadDone);
  }
  const r = await ingest({ owner: p.owner, sha, tmp: part, bytes: size, name, mtime: when, source, deviceId: p.deviceId, sniffed: sniffed! });
  if (folderId != null) db.query("UPDATE item SET folder_id = ? WHERE id = ? AND owner_id = ? AND (folder_id IS NULL OR ?)").run(folderId, r.id, p.owner, r.duplicate ? 0 : 1);
  return J({ item: summaryById(p.owner, r.id)!, duplicate: r.duplicate } satisfies UploadDone);
}
