// Deep zoom against a real server: the pyramid is cut on first request, its tiles are served, a video has none.
// HDR detection and the DeepZoom descriptor as units. The server part needs libvips (skipped otherwise).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHdr, parseDzi } from "../server/zoom";
import { seedSession, startServer, type Srv } from "./helpers";

const enc = (s: string) => new TextEncoder().encode(s);
test("HDR is read from gain-map markers and PQ/HLG colour boxes", () => {
  expect(isHdr(enc("\xff\xd8\xff\xe1 ... xmlns:hdrgm=\"http://ns.adobe.com/hdr-gain-map/1.0/\" hdrgm:Version=\"1.0\""))).toBe(true); // Ultra HDR JPEG
  expect(isHdr(enc("....ftypheic....urn:com:apple:photo:2020:aux:hdrgainmap"))).toBe(true); // iPhone HEIC
  expect(isHdr(enc("....ftypavif........tmap"))).toBe(true); // AVIF with a gain-map item
  expect(isHdr(enc("\xff\xd8\xff\xe0 tmap is just text in a JPEG"))).toBe(false);
  const nclx = (transfer: number) => { const b = enc("....ftypavif....colrnclx\0\x09\0\0\0\x09\0"); b[27] = transfer; return b; }; // primaries at 24-25, transfer at 26-27
  expect(isHdr(nclx(16))).toBe(true); // PQ
  expect(isHdr(nclx(18))).toBe(true); // HLG
  expect(isHdr(nclx(13))).toBe(false); // sRGB
  expect(isHdr(enc("\xff\xd8\xff\xe0 plain JPEG"))).toBe(false);
});
test("the DeepZoom descriptor gives the size and the number of levels", () => {
  expect(parseDzi(`<Image TileSize="510" Overlap="1" Format="webp"><Size Height="3000" Width="4000"/></Image>`)).toEqual({ w: 4000, h: 3000, maxLevel: 12 });
  expect(parseDzi("<Image/>")).toBeNull();
});

const haveVips = !!Bun.which("vips") && !!Bun.which("vipsthumbnail") && !!Bun.which("vipsheader");
const suite = haveVips ? describe : describe.skip;
let srv: Srv, cookie: string, dir: string;
const j = (r: Response) => r.json() as Promise<any>;
beforeAll(async () => { if (!haveVips) return; srv = await startServer(); cookie = await seedSession(srv); dir = mkdtempSync(join(tmpdir(), "monet-zoom-")); });
afterAll(() => haveVips && srv.stop());

suite("zoom", () => {
  test("first ask starts the pyramid, then its tiles are there at every level", async () => {
    const f = join(dir, "big.jpg");
    await Bun.spawn(["vips", "gaussnoise", f, "1500", "1000"]).exited;
    const img = new Uint8Array(await Bun.file(f).arrayBuffer());
    const sha = new Bun.CryptoHasher("sha256").update(img).digest("hex");
    const up = await j(await srv.fetch(`/api/upload/${sha}?offset=0&total=${img.length}&name=big.jpg`, { method: "PUT", cookie, body: img }));
    const id = up.item.id;
    let z = await j(await srv.fetch(`/api/items/${id}/zoom`, { cookie }));
    expect(z).toMatchObject({ tile: 510, overlap: 1, hdr: false, mime: "image/jpeg" });
    for (let i = 0; i < 60 && !z.ready; i++) { await Bun.sleep(100); z = await j(await srv.fetch(`/api/items/${id}/zoom`, { cookie })); }
    expect(z).toMatchObject({ ready: true, w: 1500, h: 1000, maxLevel: 11 });
    const top = await srv.fetch(`/media/${id}/z/11/2_1`, { cookie });
    expect(top.status).toBe(200); expect(top.headers.get("content-type")).toBe("image/webp");
    expect((await srv.fetch(`/media/${id}/z/0/0_0`, { cookie })).status).toBe(200);
    expect((await srv.fetch(`/media/${id}/z/11/9_9`, { cookie })).status).toBe(404); // outside the picture
    expect((await srv.fetch(`/media/${id}/z/11/0_0`)).status).toBe(401); // not without a session
  });
});
