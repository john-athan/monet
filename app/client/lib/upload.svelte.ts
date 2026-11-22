// Import from the browser: hash each file (streaming SHA-256), ask the server which it lacks, send those in chunks.
// A file goes into the library it was put on: your own, or the one of the person whose photos are on screen. That is
// fixed when the file is queued, so leaving the page while it uploads does not send the rest somewhere else.
import { hashFile } from "./sha256";
import { api } from "./api";
import { num, count } from "./format";
import { toast, viewing, member, genitive, go } from "./state.svelte";

export const CHUNK = 16 * 1024 * 1024;
const CHUNK_WAIT = 5 * 60_000;
const PARALLEL = 2;
// documents, sheets and slides (docs/files.md): the server checks the bytes, the name only has to be one of these
const DOCS = /\.(pdf|docx?|odt|rtf|pages|txt|md|markdown|tex|xlsx|xlsm|xls|ods|numbers|csv|tsv|pptx?|odp|key)$/i;
const MEDIA = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|dng|cr2|nef|arw|mp4|mov|m4v|webm|3gp|mkv|avi)$/i;

/** `reading`: a folder is being listed (the picker closed, no files yet). `bytes`/`moved`: the whole import and how much
 * of it is through (hashing counts a fifth of a file, sending the rest), so a 1 GB video moves the bar too. */
export const up = $state({ total: 0, done: 0, skipped: 0, failed: 0, refused: 0, active: 0, other: 0, reading: false, docs: 0, bytes: 0, moved: 0, now: "" });
/** Where files go: the Ablage page on screen sets it, so a drop or an import there lands in that folder. */
export const dest = $state({ into: null as number | null, name: "" });
type Job = { file: File; of: number | null; into: number | null };
/** The path of a file inside the folder that was dropped (a drop has no webkitRelativePath, so the walk records it). */
const rel = new WeakMap<File, string>();
const pathOf = (f: File) => f.webkitRelativePath || rel.get(f) || "";
/** "Uni/Seminar" for "Uni/Seminar/a.pdf", "" for a file on its own. */
const dirOf = (f: File) => { const p = pathOf(f), i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
const queue: Job[] = [];
const live = new Map<Job, number>();
let running = 0, target: number | null = null, mixed = false, through = 0;
const track = () => { let m = through; for (const v of live.values()) m += v; up.moved = m; };
const part = (j: Job, f: number) => { live.set(j, j.file.size * Math.min(1, f)); track(); };
export const busy = () => up.reading || (up.total > 0 && up.done + up.skipped + up.failed < up.total);

const hidden = (f: File) => f.name.startsWith(".") || f.name.startsWith("~$") || pathOf(f).includes("__MACOSX/");
/** A photo or video by type or name. Hidden files are not: macOS writes `._name.jpg` beside every file on an external drive. */
export const isMedia = (f: File) => !hidden(f) && (f.type.startsWith("image/") || f.type.startsWith("video/") || MEDIA.test(f.name));
/** A document, sheet or presentation by its name (Office writes `~$name.docx` while a file is open). */
export const isDoc = (f: File) => !hidden(f) && DOCS.test(f.name);

/** Queues files for the library `of` (null: your own; default: the library on screen). */
export function addFiles(files: File[], of: number | null = viewing(), into: number | null = dest.into) {
  up.reading = false;
  const take = files.filter(f => isMedia(f) || isDoc(f)), other = files.length - take.length;
  if (!take.length) { toast("Darunter war kein Foto, kein Video und kein Dokument."); return; }
  if (up.done + up.skipped + up.failed >= up.total && !up.active) {
    Object.assign(up, { total: 0, done: 0, skipped: 0, failed: 0, refused: 0, other: 0, docs: 0, bytes: 0, moved: 0 }); through = 0; target = of; mixed = false;
  } else if (of !== target) mixed = true;
  up.total += take.length; up.other += other; queue.push(...take.map(file => ({ file, of, into })));
  up.bytes += take.reduce((n, f) => n + f.size, 0);
  // small files first: a folder that starts with two 1 GB videos otherwise shows "0 von 4000" for minutes
  queue.sort((a, b) => a.file.size - b.file.size);
  pump();
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const j = queue.shift()!; running++; up.active++;
    // a format the server does not store is skipped, not failed: trying again would not help
    up.now = j.file.name;
    one(j).catch(e => { if (e?.status === 415) { up.refused++; up.total--; } else up.failed++; })
      .finally(() => { live.delete(j); through += j.file.size; track(); running--; up.active--; pump(); if (!up.active && !queue.length) finish(); });
  }
}
// a photo that is in shows up on the page while the rest still uploads: at most every 4 seconds, so a folder of small
// files does not ask for the timeline a hundred times a minute
let tick: ReturnType<typeof setTimeout> | null = null;
function landed() {
  if (tick) return;
  tick = setTimeout(() => { tick = null; dispatchEvent(new CustomEvent("monet-uploaded")); }, 4000);
}
function finish() {
  if (tick) { clearTimeout(tick); tick = null; }
  const sent = up.done, docs = up.docs, photos = sent - docs, whose = !mixed && target != null ? member(target) : undefined;
  const where = whose ? ` in ${genitive(whose.name)} Fotos` : "";
  // in someone else's library the toast names it and, when you are elsewhere by now, leads there
  const there = `/bei/${target}`, action = whose && viewing() !== target ? { label: "Ansehen", run: () => go(there, false, undefined, true) } : undefined;
  const refused = up.refused ? ` ${num(up.refused)} ${up.refused === 1 ? "Datei hat" : "Dateien haben"} ein Format, das Monet nicht speichert.` : "";
  const made = [docs && count(docs, "Datei", "Dateien"), photos && count(photos, "Foto", "Fotos")].filter(Boolean).join(" und ");
  // with documents among them the toast names both kinds: "3 Dateien und 12 Fotos importiert"
  toast(docs && !up.failed ? `${made}${where} importiert${up.skipped ? `, ${num(up.skipped)} waren schon da` : ""}.` + refused : (up.failed ? `${num(sent)}${where} hochgeladen, ${num(up.failed)} nicht. Versuche es noch einmal.` : sent ? `${num(sent)} ${sent === 1 ? "Datei" : "Dateien"}${where} hochgeladen${up.skipped ? `, ${num(up.skipped)} waren schon da` : ""}.` : `Alles war${whose ? ` in ${genitive(whose.name)} Fotos` : ""} schon da.`) + refused, { action, ms: refused ? 6000 : undefined });
  dispatchEvent(new CustomEvent("monet-uploaded"));
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
/** The header that names the library (lib/api.ts sends the one on screen; an upload keeps the one it was queued for). */
const lib = (of: number | null): Record<string, string> => of != null ? { "x-monet-of": String(of) } : {};
async function one(j: Job) {
  const { file, of } = j;
  const sha = await hashFile(file, b => part(j, 0.2 * b / (file.size || 1)));
  const { missing } = await api<{ missing: string[] }>("/api/upload/check", { method: "POST", json: { hashes: [sha] }, headers: lib(of) });
  if (!missing.includes(sha)) {
    // already in the library: an empty PUT lets the server put it into the dropped folder if it is in none yet
    const folder = dirOf(file);
    if (folder || j.into != null) await fetch(`/api/upload/${sha}?offset=0&total=${file.size}&name=${encodeURIComponent(file.name)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}${j.into != null ? `&in=${j.into}` : ""}`,
      { method: "PUT", body: new Uint8Array(0), credentials: "same-origin", headers: lib(of) }).catch(() => {});
    up.skipped++; return;
  }
  const out = await send(file, sha, of, f => part(j, 0.2 + 0.8 * f), { folder: dirOf(file), into: j.into });
  up.done++;
  if (out?.doc) up.docs++;
  landed();
}

/** PUT the file in chunks. The server answers each chunk with how much it holds; a failed chunk is asked for again from there. */
export async function send(file: File, sha: string, of: number | null = null, progress?: (f: number) => void, where: { folder?: string; into?: number | null } = {}): Promise<{ item?: unknown; doc?: unknown; duplicate?: boolean } | undefined> {
  const total = file.size;
  let offset = 0, tries = 0;
  const base = `/api/upload/${sha}?total=${total}&name=${encodeURIComponent(file.name)}&mtime=${file.lastModified}&source=web${where.folder ? `&folder=${encodeURIComponent(where.folder)}` : ""}${where.into != null ? `&in=${where.into}` : ""}`;
  do {
    const end = Math.min(total, offset + CHUNK);
    let res: Response | null = null;
    // a request that never answers would hold the upload at one file forever: give up on it and ask again from where
    // the server is. Five minutes covers 16 MiB on a slow line plus the wait for the ingest queue on the last chunk.
    const signal = AbortSignal.timeout(CHUNK_WAIT);
    let j: any = {};
    try {
      res = await fetch(`${base}&offset=${offset}`, { method: "PUT", body: file.slice(offset, end), credentials: "same-origin", headers: lib(of), signal });
      j = await res.json().catch(() => ({}));
    } catch { res = null; }
    if (res?.ok || (res?.status === 409 && typeof j.received === "number")) {
      tries = 0;
      offset = typeof j.received === "number" ? j.received : end;
      progress?.(total ? offset / total : 1);
      if (j.item || j.doc) return j;
      continue;
    }
    if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw Object.assign(new Error(j.error ?? `Upload ${res.status}`), { status: res.status });
    if (++tries > 5) throw new Error("Upload abgebrochen");
    await wait(600 * 2 ** tries);
  } while (offset < total);
  // an empty file or a server that confirmed everything without an item: the check on the next run settles it
}

/** Everything a drop holds, folders included (webkitGetAsEntry walks them). */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  up.reading = true;
  const walk = async (e: any): Promise<void> => {
    if (e.isFile) { const f = await new Promise<File>((ok, no) => e.file(ok, no)); rel.set(f, String(e.fullPath ?? "").replace(/^\//, "")); out.push(f); return; }
    if (!e.isDirectory) return;
    const r = e.createReader();
    for (;;) {
      const batch: any[] = await new Promise((ok, no) => r.readEntries(ok, no));
      if (!batch.length) break;
      for (const c of batch) await walk(c);
    }
  };
  const entries = [...dt.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  try {
    if (entries.length) { for (const e of entries) await walk(e); return out; }
    return [...dt.files];
  } finally { up.reading = false; }
}
