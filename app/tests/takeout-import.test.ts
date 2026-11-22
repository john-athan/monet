// tools/import-takeout.ts against a real server: macOS ._ files and Google's trash stay out, a file the server has is
// not sent again but still gets its sidecar (with a browser session, even when another device sent it), folders other
// than the year buckets become albums. Needs libvips (skipped otherwise).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, seedSession, startServer, type Srv } from "./helpers";

const haveVips = !!Bun.which("vips");
const suite = haveVips ? describe : describe.skip;
let srv: Srv, cookie: string, dir: string;

async function image(path: string, gain: number) {
  const raw = path + ".v.jpg";
  await Bun.spawn(["vips", "black", raw, "64", "48"]).exited;
  await Bun.spawn(["vips", "linear", raw, path, "1", String(gain)]).exited;
  await Bun.spawn(["rm", raw]).exited;
}
const sidecar = (dir: string, title: string, ts: number) =>
  writeFileSync(join(dir, `${title}.supplemental-metadata.json`), JSON.stringify({ title, photoTakenTime: { timestamp: String(ts) }, geoData: { latitude: 48.137, longitude: 11.575 } }));
const run = async (...auth: string[]) => {
  const p = Bun.spawn(["bun", join(ROOT, "tools/import-takeout.ts"), join(dir, "Takeout"), "--origin", srv.origin, ...auth], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text(); await p.exited;
  return { out, code: p.exitCode };
};

beforeAll(async () => {
  if (!haveVips) return;
  srv = await startServer(); cookie = await seedSession(srv);
  dir = mkdtempSync(join(tmpdir(), "monet-takeout-"));
  const year = join(dir, "Takeout/Google Photos/Photos from 2012"), album = join(dir, "Takeout/Google Photos/Urlaub"), bin = join(dir, "Takeout/Google Photos/Bin");
  for (const d of [year, album, bin]) mkdirSync(d, { recursive: true });
  await image(join(year, "a.jpg"), 10); sidecar(year, "a.jpg", 1340000000);
  await image(join(album, "b.jpg"), 20); sidecar(album, "b.jpg", 1340000100);
  await Bun.spawn(["cp", join(year, "a.jpg"), join(album, "a.jpg")]).exited; // Takeout repeats album photos
  await image(join(bin, "gone.jpg"), 30);
  writeFileSync(join(year, "._a.jpg"), new Uint8Array(4096)); // what macOS leaves on an exFAT drive
});
afterAll(() => haveVips && srv.stop());

suite("import-takeout", () => {
  test("b.jpg came in earlier from the browser, without date or place", async () => {
    const bytes = new Uint8Array(await Bun.file(join(dir, "Takeout/Google Photos/Urlaub/b.jpg")).arrayBuffer());
    const sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const r = await srv.fetch(`/api/upload/${sha}?offset=0&total=${bytes.length}&name=b.jpg&source=web`, { method: "PUT", cookie, body: bytes });
    expect(r.status).toBe(200);
  });
  test("a run sends a.jpg once, skips ._a.jpg and the trash, dates both and files them into the album", async () => {
    const { out, code } = await run("--session", cookie);
    expect(code).toBe(0);
    expect(out).toContain("3 media files");
    expect(out).toContain("1 uploaded, 2 already known, 3 sidecars posted, 0 failed");
    const rows = srv.db().query("SELECT orig_name, taken_src, taken_at, lat IS NOT NULL AS geo FROM item ORDER BY orig_name").all() as any[];
    expect(rows.map(r => [r.orig_name, r.taken_src, r.geo])).toEqual([["a.jpg", "sidecar", 1], ["b.jpg", "sidecar", 1]]);
    const album = srv.db().query("SELECT a.name, count(*) AS n FROM album a JOIN album_item ai ON ai.album_id = a.id GROUP BY a.id").all();
    expect(album).toEqual([{ name: "Urlaub", n: 2 }]);
  });
  test("a second run sends nothing", async () => {
    const { out, code } = await run("--session", cookie);
    expect(code).toBe(0);
    expect(out).toContain("the server lacks 0 files");
    expect(out).toContain("0 uploaded, 3 already known");
  });
});
