// Model files: fetched from this origin (/models/<name>), checked against manifest.json, kept in Cache Storage
// so they download once. The cache key carries the sha256, so a changed file is a new entry.
export type Manifest = { files: { path: string; bytes: number; sha256: string }[]; models: { image: string; text: string; faceDetect: string; faceEmbed: string } };
export type Progress = { file: string; loaded: number; total: number; done: boolean; cached: boolean };

const CACHE = "monet-models-v1";
let manifest: Promise<Manifest> | null = null;

export function loadManifest(base = "/models/"): Promise<Manifest> {
  return (manifest ??= fetch(base + "manifest.json", { cache: "no-cache" }).then(r => {
    if (!r.ok) throw new Error(`models/manifest.json: HTTP ${r.status}`);
    return r.json();
  }).catch(e => { manifest = null; throw e; }));
}

async function sha256hex(b: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  return Array.from(h, x => x.toString(16).padStart(2, "0")).join("");
}

export async function getFile(name: string, onProgress?: (p: Progress) => void, base = "/models/"): Promise<Uint8Array> {
  const m = await loadManifest(base);
  const entry = m.files.find(f => f.path === name);
  if (!entry) throw new Error(`models: ${name} is not in the manifest`);
  const url = `${base}${name}?v=${entry.sha256.slice(0, 12)}`;
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); } catch { /* no Cache Storage: download every time */ }
  const hit = cache && (await cache.match(url));
  if (hit) {
    const buf = new Uint8Array(await hit.arrayBuffer());
    if (buf.length === entry.bytes) { onProgress?.({ file: name, loaded: buf.length, total: buf.length, done: true, cached: true }); return buf; }
    await cache!.delete(url);
  }
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`models/${name}: HTTP ${r.status}`);
  const total = entry.bytes, buf = new Uint8Array(total);
  let loaded = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > total) throw new Error(`models/${name}: larger than the manifest says`);
    buf.set(value, loaded); loaded += value.length;
    onProgress?.({ file: name, loaded, total, done: false, cached: false });
  }
  if (loaded !== total) throw new Error(`models/${name}: ${loaded} of ${total} bytes`);
  if ((await sha256hex(buf)) !== entry.sha256) throw new Error(`models/${name}: sha256 differs from the manifest`);
  try { await cache?.put(url, new Response(buf, { headers: { "content-type": "application/octet-stream" } })); } catch { /* quota: fine */ }
  onProgress?.({ file: name, loaded, total, done: true, cached: false });
  return buf;
}

export const getText = async (name: string, p?: (x: Progress) => void) => new TextDecoder().decode(await getFile(name, p));
export const getJson = async (name: string, p?: (x: Progress) => void) => JSON.parse(await getText(name, p));
