// Chunked upload against a real server: resume, 409 with the real size, sha mismatch, duplicates, unsupported files,
// dates from file names, thumbnails, media headers, soft delete. Needs libvips on the machine (skipped otherwise).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairDevice, seedSession, startServer, type Srv } from "./helpers";

const haveVips = !!Bun.which("vips") && !!Bun.which("vipsthumbnail") && !!Bun.which("vipsheader");
const suite = haveVips ? describe : describe.skip;

let srv: Srv, cookie: string, dir: string;
const sha = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const j = (r: Response) => r.json() as Promise<any>;
async function makeImage(name: string, gain: number): Promise<Uint8Array> {
  const out = join(dir, name);
  const p = Bun.spawn(["vips", "black", `${out}`, "320", "240"]); await p.exited;
  const q = Bun.spawn(["vips", "linear", out, join(dir, "g_" + name), String(1), String(gain)]); await q.exited;
  return new Uint8Array(await Bun.file(join(dir, "g_" + name)).arrayBuffer());
}
const put = (s: string, bytes: Uint8Array, offset: number, end: number, extra = "", token = cookie) =>
  srv.fetch(`/api/upload/${s}?offset=${offset}&total=${bytes.length}${extra}`, { method: "PUT", cookie: token, body: bytes.slice(offset, end) });

beforeAll(async () => { if (!haveVips) return; srv = await startServer(); cookie = await seedSession(srv); dir = mkdtempSync(join(tmpdir(), "monet-img-")); });
afterAll(() => haveVips && srv.stop());

suite("upload", () => {
  let jpg: Uint8Array, jpgSha: string, itemId: number;
  test("check lists unknown hashes as missing", async () => {
    jpg = await makeImage("a.jpg", 40); jpgSha = sha(jpg);
    const r = await j(await srv.fetch("/api/upload/check", { method: "POST", cookie, json: { hashes: [jpgSha, "nothex", "c".repeat(64)] } }));
    expect(r.missing).toEqual([jpgSha, "c".repeat(64)]); // malformed hashes are dropped
  });
  test("resume: a chunk at the wrong offset is a 409 with the real size; the file completes from there", async () => {
    const half = Math.floor(jpg.length / 2);
    const name = "&name=" + encodeURIComponent("IMG_20190806_180121.jpg") + "&mtime=1700000000000&source=web";
    const a = await put(jpgSha, jpg, 0, half, name);
    expect(a.status).toBe(200); expect(await j(a)).toEqual({ received: half });
    const again = await put(jpgSha, jpg, 0, half, name);
    expect(again.status).toBe(409); expect(await j(again)).toMatchObject({ received: half });
    const skip = await put(jpgSha, jpg, half + 5, jpg.length, name);
    expect(skip.status).toBe(409); expect((await j(skip)).received).toBe(half);
    const done = await put(jpgSha, jpg, half, jpg.length, name);
    expect(done.status).toBe(200);
    const body = await j(done);
    expect(body.duplicate).toBe(false);
    expect(body.item).toMatchObject({ kind: "photo", w: 320, h: 240, favorite: false });
    itemId = body.item.id;
    // no EXIF, so the date comes from the file name: 18:01:21 in Berlin summer time is 16:01:21 UTC
    expect(new Date(body.item.takenAt).toISOString()).toBe("2019-08-06T16:01:21.000Z");
  });
  test("the original is stored by date and hash, never renamed, and the item says where the date came from", async () => {
    const d = await j(await srv.fetch(`/api/items/${itemId}`, { cookie }));
    expect(d).toMatchObject({ takenSrc: "name", origName: "IMG_20190806_180121.jpg", mime: "image/jpeg", sha256: jpgSha, source: "web" });
    expect(srv.db().query("SELECT orig_path FROM item WHERE id = ?").get(itemId)).toEqual({ orig_path: `2019/08/${jpgSha}.jpg` });
    const o = await srv.fetch(`/media/${itemId}/o`, { cookie });
    expect(sha(new Uint8Array(await o.arrayBuffer()))).toBe(jpgSha);
  });
  test("thumbnails exist in three sizes, with ETag and an immutable private cache; Range works on the original", async () => {
    for (const [size, max] of [["s", 256], ["m", 720], ["l", 2048]] as const) {
      const r = await srv.fetch(`/media/${itemId}/${size}`, { cookie });
      expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe("image/webp");
      expect(r.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      expect(r.headers.get("etag")).toBe(`"${jpgSha}-${size}"`);
      expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(50);
      const again = await srv.fetch(`/media/${itemId}/${size}`, { cookie, headers: { "if-none-match": `"${jpgSha}-${size}"` } });
      expect(again.status).toBe(304); void max;
    }
    const part = await srv.fetch(`/media/${itemId}/o`, { cookie, headers: { range: "bytes=0-9" } });
    expect(part.status).toBe(206); expect(part.headers.get("content-range")).toBe(`bytes 0-9/${jpg.length}`);
    expect((await srv.fetch(`/media/${itemId}/s`)).status).toBe(401); // no public media URL
  });
  test("the same file again is a duplicate, and the check no longer lists it", async () => {
    const r = await put(jpgSha, jpg, 0, jpg.length, "&name=copy.jpg");
    expect(await j(r)).toMatchObject({ duplicate: true, item: { id: itemId } });
    expect((await j(await srv.fetch("/api/upload/check", { method: "POST", cookie, json: { hashes: [jpgSha] } }))).missing).toEqual([]);
    expect(srv.db().query("SELECT count(*) AS n FROM item").get()).toEqual({ n: 1 });
  });
  test("a wrong hash is refused at the last chunk and leaves nothing behind", async () => {
    const png = await makeImage("b.jpg", 90), real = sha(png), fake = "d".repeat(64);
    const bad = await put(fake, png, 0, png.length);
    expect(bad.status).toBe(422);
    // the part file is gone, so the same hash starts over at offset 0
    expect((await put(fake, png, 0, 10)).status).toBe(200);
    expect((await put(fake, png, 0, 10)).status).toBe(409);
    const good = await put(real, png, 0, png.length, "&name=b.jpg&mtime=1500000000000");
    expect(good.status).toBe(200);
    const item = (await j(good)).item;
    // no EXIF and no date in the name: the client's file mtime
    expect(item.takenAt).toBe(1500000000000);
    expect(srv.db().query("SELECT taken_src FROM item WHERE id = ?").get(item.id)).toEqual({ taken_src: "mtime" });
  });
  test("a part that already holds the whole file (a restart before ingest) is finished, not answered with 409", async () => {
    const img = await makeImage("c.jpg", 140), h = sha(img);
    mkdirSync(join(srv.dir, "data", "up"), { recursive: true });
    writeFileSync(join(srv.dir, "data", "up", `${h}.part`), img);
    expect((await j(await srv.fetch("/api/upload/check", { method: "POST", cookie, json: { hashes: [h] } }))).missing).toEqual([h]);
    // the client starts over at offset 0 with a full first chunk; the server finishes from what it already holds
    const r = await put(h, img, 0, img.length, "&name=c.jpg");
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ duplicate: false, item: { kind: "photo" } });
    expect((await j(await srv.fetch("/api/upload/check", { method: "POST", cookie, json: { hashes: [h] } }))).missing).toEqual([]);
  });
  test("without a name and without mtime the upload time is used", async () => {
    const img = await makeImage("c.jpg", 140);
    const r = await j(await put(sha(img), img, 0, img.length));
    expect(srv.db().query("SELECT taken_src FROM item WHERE id = ?").get(r.item.id)).toEqual({ taken_src: "upload" });
    expect(Math.abs(r.item.takenAt - Date.now())).toBeLessThan(60_000);
  });
  test("files that are not photos or videos are kept as files (no 415); empty files and oversized chunks are refused", async () => {
    const txt = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const r = await j(await put(sha(txt), txt, 0, txt.length, "&name=x.html"));
    expect(r.doc).toMatchObject({ kind: "other", format: "html", state: "ok", text: true });
    expect((await srv.fetch(`/api/upload/${"e".repeat(64)}?offset=0&total=0`, { method: "PUT", cookie, body: new Uint8Array(0) })).status).toBe(400);
    const big = new Uint8Array(33 * 1024 * 1024); big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    expect((await srv.fetch(`/api/upload/${"f".repeat(64)}?offset=0&total=${big.length}`, { method: "PUT", cookie, body: big })).status).toBe(413);
    expect((await srv.fetch(`/api/upload/${jpgSha}?offset=0&total=5`, { method: "PUT", body: new Uint8Array(5) })).status).toBe(401);
  });
  test("a QuickTime video without ftyp (iPhones of 2022) and a JPEG 2000 named .jpg are stored, with thumbnails", async () => {
    const haveFfmpeg = !!Bun.which("ffmpeg");
    if (haveFfmpeg) {
      const mov = join(dir, "q.mov");
      await Bun.spawn(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=2", "-pix_fmt", "yuv420p", "-f", "mov", mov]).exited;
      const v = new Uint8Array(await Bun.file(mov).arrayBuffer());
      expect(String.fromCharCode(...v.slice(4, 8))).toBe("ftyp");
      v.set([0x66, 0x72, 0x65, 0x65], 4); // the ftyp atom becomes "free": same layout, no ftyp, as those iPhones write
      const r = await put(sha(v), v, 0, v.length, "&name=IMG_0009.MP4");
      expect(r.status).toBe(200);
      const item = (await j(r)).item;
      expect(srv.db().query("SELECT kind, ext, thumbs_ok FROM item WHERE id = ?").get(item.id)).toEqual({ kind: "video", ext: "mov", thumbs_ok: 1 });
    }
    const jp2 = join(dir, "d.jp2");
    await Bun.spawn(["vips", "copy", join(dir, "a.jpg"), jp2]).exited;
    const b = new Uint8Array(await Bun.file(jp2).arrayBuffer());
    const r = await put(sha(b), b, 0, b.length, "&name=DALL%C2%B7E.jpg");
    expect(r.status).toBe(200);
    expect(srv.db().query("SELECT kind, ext, thumbs_ok FROM item WHERE id = ?").get((await j(r)).item.id)).toEqual({ kind: "photo", ext: "jp2", thumbs_ok: 1 });
  });
  test("a file libvips cannot read is refused with 422 and does not become an item", async () => {
    const broken = new Uint8Array(2000); broken.set([0xff, 0xd8, 0xff, 0xe0]);
    const before = (srv.db().query("SELECT count(*) AS n FROM item").get() as any).n;
    expect((await put(sha(broken), broken, 0, broken.length)).status).toBe(422);
    expect((srv.db().query("SELECT count(*) AS n FROM item").get() as any).n).toBe(before);
  });
  test("favourite, soft delete and restore; deleted items leave the timeline but stay known to the check", async () => {
    expect((await srv.fetch(`/api/items/${itemId}`, { method: "PATCH", cookie, json: { favorite: true } })).status).toBe(200);
    expect((await j(await srv.fetch("/api/timeline?favorite=1", { cookie }))).days.flatMap((d: any) => d.items).map((i: any) => i.id)).toEqual([itemId]);
    expect((await srv.fetch(`/api/items/${itemId}`, { method: "DELETE", cookie })).status).toBe(200);
    const tl = await j(await srv.fetch("/api/timeline", { cookie }));
    expect(tl.days.flatMap((d: any) => d.items).some((i: any) => i.id === itemId)).toBe(false);
    expect((await j(await srv.fetch("/api/trash", { cookie }))).map((i: any) => i.id)).toEqual([itemId]);
    expect((await j(await srv.fetch("/api/upload/check", { method: "POST", cookie, json: { hashes: [jpgSha] } }))).missing).toEqual([]); // not re-uploaded by the next sync
    expect((await srv.fetch(`/api/items/${itemId}/restore`, { method: "POST", cookie })).status).toBe(200);
    expect((await j(await srv.fetch("/api/timeline", { cookie }))).days.flatMap((d: any) => d.items).some((i: any) => i.id === itemId)).toBe(true);
  });
  test("the timeline groups by local day with German titles and a colour that is readable on both backgrounds", async () => {
    const tl = await j(await srv.fetch("/api/timeline", { cookie }));
    expect(tl.days.map((d: any) => d.title)).toContain("Dienstag, 6. August 2019");
    expect(tl.days.some((d: any) => d.title === "Heute")).toBe(true); // the item with no date at all, uploaded now
    for (const d of tl.days) { expect(d.sign).toMatch(/^#[0-9a-f]{6}$/); expect(d.signNight).toMatch(/^#[0-9a-f]{6}$/); }
  });
  test("timeline ?from=YYYY-MM starts at the newest day on or before that month; album detail lists every item", async () => {
    const days = async (q: string) => (await j(await srv.fetch("/api/timeline" + q, { cookie }))).days.map((d: any) => d.date);
    const all = await days("");
    expect(all).toContain("2019-08-06");
    const from = await days("?from=2019-08");
    expect(from[0]).toBe("2019-08-06");
    expect(from.every((d: string) => d <= "2019-08-31")).toBe(true);
    expect((await days("?from=2019-07"))[0] <= "2019-07-31").toBe(true);
    expect(await days("?from=1999-01")).toEqual([]);
    expect(await days("?from=bogus")).toEqual(all);
    const a = await j(await srv.fetch("/api/albums", { method: "POST", cookie, json: { name: "Alle" } }));
    const ids = srv.db().query("SELECT id FROM item").all().map((r: any) => r.id);
    await srv.fetch(`/api/albums/${a.id}/items`, { method: "POST", cookie, json: { ids } });
    const d = await j(await srv.fetch(`/api/albums/${a.id}`, { cookie }));
    expect(d.items.length).toBe(ids.length); expect(d).toMatchObject({ id: a.id, name: "Alle" });
  });
  test("a sidecar fills in a date and a place only where the file had none; albums by name", async () => {
    const img = await makeImage("d.jpg", 200);
    const r = await j(await put(sha(img), img, 0, img.length, "&name=zzz.jpg"));
    expect((await srv.fetch(`/api/items/${r.item.id}/sidecar`, { method: "POST", cookie, json: { takenAt: Date.UTC(2015, 4, 5, 10), lat: 48.137, lon: 11.575, albums: ["Urlaub", "Urlaub"] } })).status).toBe(200);
    const d = await j(await srv.fetch(`/api/items/${r.item.id}`, { cookie }));
    expect(d.takenSrc).toBe("sidecar"); expect(d.takenAt).toBe(Date.UTC(2015, 4, 5, 10)); expect(d.place.name).toBe("München");
    const albums = await j(await srv.fetch("/api/albums", { cookie }));
    expect(albums.filter((a: any) => a.name === "Urlaub")).toMatchObject([{ count: 1, cover: r.item.id }]);
    // the file name had the date already for the first image: a sidecar must not override it
    expect((await srv.fetch(`/api/items/${itemId}/sidecar`, { method: "POST", cookie, json: { takenAt: Date.UTC(2001, 0, 1) } })).status).toBe(200);
    expect((await j(await srv.fetch(`/api/items/${itemId}`, { cookie }))).takenSrc).toBe("name");
  });
  test("devices: thumbnails s and m, OCR-only posts with model vision-ocr, and the second-copy acknowledgement", async () => {
    const mac = await pairDevice(srv, cookie, "mac"), android = await pairDevice(srv, cookie, "android");
    for (const t of [mac.token, android.token]) {
      expect((await srv.fetch(`/media/${itemId}/s`, { token: t })).status).toBe(200);
      expect((await srv.fetch(`/media/${itemId}/m`, { token: t })).status).toBe(200);
    }
    expect((await srv.fetch(`/media/${itemId}/l`, { token: android.token })).status).toBe(200); // index scope
    expect((await srv.fetch(`/media/${itemId}/o`, { token: android.token })).status).toBe(403);
    const post = (body: unknown) => srv.fetch(`/api/index/${itemId}`, { method: "POST", token: mac.token, json: body });
    expect((await post({ model: "vision-ocr", ocr: "Hallo Welt" })).status).toBe(200);
    expect((await post({ model: "vision-ocr", clip: "AAAA" })).status).toBe(400);
    expect((await post({ model: "vision-ocr", ocr: "x", faces: [] })).status).toBe(400);
    expect((await post({ model: "nonsense", ocr: "x" })).status).toBe(400);
    expect(srv.db().query("SELECT ocr_text, ocr_ok FROM item WHERE id = ?").get(itemId)).toEqual({ ocr_text: "Hallo Welt", ocr_ok: 1 });
    expect((await j(await srv.fetch("/api/status", { cookie }))).secondCopy).toEqual({ n: 0, last: null });
    expect((await srv.fetch("/api/export/ack", { method: "POST", token: android.token, json: { ids: [itemId] } })).status).toBe(200); // any device or session
    const st = await j(await srv.fetch("/api/status", { cookie }));
    expect(st.secondCopy.n).toBe(1); expect(st.secondCopy.last).toBeGreaterThan(0);
    expect((await j(await srv.fetch(`/api/items/${itemId}`, { cookie }))).backup.secondCopyAt).toBe(st.secondCopy.last);
  });
});

const haveFfmpeg = haveVips && !!Bun.which("ffmpeg") && !!Bun.which("ffprobe");
(haveFfmpeg ? describe : describe.skip)("a video without GPS", () => {
  /** A two second clip with the Samsung tags: creation time in UTC, location 0°/0° (no fix yet). */
  async function makeVideo(name: string, at: number, colour: string): Promise<Uint8Array> {
    const out = join(dir, name);
    const p = Bun.spawn(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", `color=c=${colour}:s=160x120:d=2`, "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-metadata", `creation_time=${new Date(at).toISOString()}`, "-metadata", "location=+00.0000+000.0000/", "-y", out]);
    await p.exited;
    return new Uint8Array(await Bun.file(out).arrayBuffer());
  }
  const at = Date.UTC(2026, 4, 30, 10, 7, 44);
  const geo = (id: number) => srv.db().query("SELECT lat, lon, place_id IS NOT NULL AS placed FROM item WHERE id = ?").get(id);

  test("takes the place of the photo next to it; 0°/0° is never a place", async () => {
    const img = await makeImage("athens.jpg", 60);
    const photo = (await j(await put(sha(img), img, 0, img.length, "&name=athens.jpg"))).item;
    srv.db().query("UPDATE item SET lat = 37.9718, lon = 23.728, taken_at = ? WHERE id = ?").run(at, photo.id);
    const near = await makeVideo("near.mp4", at + 3 * 60_000, "red");
    const v = (await j(await put(sha(near), near, 0, near.length, "&name=near.mp4"))).item;
    expect(geo(v.id)).toEqual({ lat: 37.9718, lon: 23.728, placed: 1 });
    // half an hour away is another place, as far as anyone knows
    const far = await makeVideo("far.mp4", at + 30 * 60_000, "blue");
    const w = (await j(await put(sha(far), far, 0, far.length, "&name=far.mp4"))).item;
    expect(geo(w.id)).toEqual({ lat: null, lon: null, placed: 0 });
  });
});
