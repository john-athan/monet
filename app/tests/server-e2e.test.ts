// End to end: the photo folder MONET_TESTDATA names, through tools/upload-dir.ts into a real server (skipped when
// that is unset or libvips is missing).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pairDevice, ROOT, seedSession, startServer, type Srv } from "./helpers";

const DIR = process.env.MONET_TESTDATA ?? "";
const ok = !!DIR && existsSync(DIR) && !!Bun.which("vips") && !!Bun.which("vipsthumbnail");
let srv: Srv, cookie: string;
beforeAll(async () => { if (ok) { srv = await startServer(); cookie = await seedSession(srv); } });
afterAll(() => ok && srv.stop());
const j = (r: Response) => r.json() as Promise<any>;

test.skipIf(!ok)("the sample folder: every file an item with thumbnails, the HEIC in Munich, plausible dates, German day titles", async () => {
  const dev = await pairDevice(srv, cookie, "android");
  const files = readdirSync(DIR).filter(f => /\.(jpe?g|png|heic)$/i.test(f)).length;
  const p = Bun.spawn(["bun", join(ROOT, "tools/upload-dir.ts"), DIR, "--origin", srv.origin, "--token", dev.token], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  expect(await p.exited).toBe(0);
  expect(out).toContain(`${files} uploaded`);

  const st = await j(await srv.fetch("/api/status", { cookie }));
  expect(st.items).toBe(files);
  expect(st.stages.thumbs).toEqual({ done: files, total: files });

  const items = srv.db().query("SELECT id, orig_name, taken_at, taken_src, lat, place_id, sha256 FROM item").all() as any[];
  for (const it of items) {
    for (const s of ["s", "m", "l"]) expect((await srv.fetch(`/media/${it.id}/${s}`, { cookie })).status).toBe(200);
    expect(it.taken_at).toBeGreaterThan(Date.UTC(2015, 0, 1)); expect(it.taken_at).toBeLessThan(Date.now());
  }
  const heic = items.find(i => /\.heic$/i.test(i.orig_name));
  const d = await j(await srv.fetch(`/api/items/${heic.id}`, { cookie }));
  expect(d.exif.lat).toBeCloseTo(48.13, 1); expect(d.place.name).toBe("München"); expect(d.takenSrc).toBe("exif");

  // uploading the folder again changes nothing
  const again = Bun.spawn(["bun", join(ROOT, "tools/upload-dir.ts"), DIR, "--origin", srv.origin, "--token", dev.token], { stdout: "pipe" });
  expect(await new Response(again.stdout).text()).toContain("0 uploaded");

  const tl = await j(await srv.fetch("/api/timeline?limit=60", { cookie }));
  expect(tl.days.flatMap((x: any) => x.items).length).toBe(files);
  expect(tl.days.every((x: any) => /^(Heute|Gestern|\p{L}+, \d+\. \p{L}+( \d{4})?)$/u.test(x.title))).toBe(true);
  expect((await j(await srv.fetch("/api/band", { cookie }))).months.length).toBeGreaterThan(5);
  expect((await j(await srv.fetch("/api/places", { cookie }))).map((x: any) => x.name)).toContain("München");
}, 180_000);
