// Shared by upload-dir.ts and import-takeout.ts: hash a file, ask which hashes the server lacks, send files in chunks.
// Bun built-ins only. Talks to the server exactly like the Android app and the Mac agent do.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const MEDIA = /\.(jpe?g|png|gif|webp|heic|heif|avif|tiff?|mp4|mov|m4v|webm)$/i;
export const CHUNK = 16 * 1024 * 1024;

/** A device token, or a browser session (`session`): only a session may add sidecars to photos another device sent. */
export type Server = { origin: string; token?: string; session?: string };
const auth = (s: Server): Record<string, string> =>
  s.session ? { cookie: `__Host-monet=${s.session}`, origin: s.origin } : { authorization: `Bearer ${s.token}` };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith("._")) continue; // macOS metadata on exFAT and FAT drives, not photos
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else if (e.isFile()) yield p;
  }
}

/** Runs `fn` over `items` with `n` at a time. */
export async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}

export async function sha256File(path: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  for await (const c of Bun.file(path).stream()) h.update(c);
  return h.digest("hex");
}

export async function post(s: Server, path: string, body: unknown) {
  const r = await fetch(s.origin + path, { method: "POST", headers: { ...auth(s), "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<any>;
}

export async function missing(s: Server, hashes: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < hashes.length; i += 500) for (const h of (await post(s, "/api/upload/check", { hashes: hashes.slice(i, i + 500) })).missing) out.add(h);
  return out;
}

/** The item of a file the server already has, without sending its bytes: the server answers a known hash at once. */
export async function known(s: Server, path: string, sha: string): Promise<any | null> {
  const total = Bun.file(path).size;
  const r = await fetch(`${s.origin}/api/upload/${sha}?offset=0&total=${total}`, { method: "PUT", headers: auth(s), body: new Uint8Array(0) });
  const j: any = await r.json().catch(() => ({}));
  return r.ok && j.item ? j.item : null;
}

/** Sends one file. Resumes from the server's `received` after a 409 or a dropped connection. Returns the item, or the
 *  doc for a file that is no photo or video. `extra`: more query parameters (folder=, in=). */
export async function sendFile(s: Server, path: string, sha: string, source = "web", extra: Record<string, string> = {}): Promise<{ item?: any; doc?: any; duplicate: boolean }> {
  const f = Bun.file(path), total = f.size, mtime = Math.floor(statSync(path).mtimeMs);
  const name = path.split("/").pop()!;
  let offset = 0, tries = 0;
  for (;;) {
    const end = Math.min(total, offset + CHUNK);
    let res: Response | null = null;
    try {
      res = await fetch(`${s.origin}/api/upload/${sha}?offset=${offset}&total=${total}&name=${encodeURIComponent(name)}&mtime=${mtime}&source=${source}${Object.entries(extra).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("")}`,
        { method: "PUT", headers: auth(s), body: f.slice(offset, end) });
    } catch { /* network: retry below */ }
    const j: any = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok && (j.item || j.doc)) return j;
    if (res?.ok || (res?.status === 409 && typeof j.received === "number")) { tries = 0; offset = j.received ?? end; continue; }
    if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new Error(`${name}: ${res.status} ${j.error ?? ""}`);
    if (++tries > 5) throw new Error(`${name}: upload gave up`);
    await wait(500 * 2 ** tries);
  }
}
