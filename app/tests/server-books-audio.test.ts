// Books, audio, every other file and big sheets end to end (docs/files.md): a real server, libvips, ffmpeg. An EPUB built here
// (stored mimetype first, deflated chapters), audio made by ffmpeg, random bytes, and a CSV with 150 000 rows.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSession, startServer, type Srv } from "./helpers";

const haveVips = !!Bun.which("vips") && !!Bun.which("vipsthumbnail") && !!Bun.which("vipsheader") && !!Bun.which("pdftotext");
const haveFfmpeg = !!Bun.which("ffmpeg") && !!Bun.which("ffprobe");
const suite = haveVips ? describe : describe.skip;
const audioSuite = haveVips && haveFfmpeg ? describe : describe.skip;
const T = 120_000;

let srv: Srv, cookie: string, dir: string;
const enc = new TextEncoder();
const sha = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const j = (r: Response) => r.json() as Promise<any>;
const q = (s: string) => encodeURIComponent(s);

async function up(bytes: Uint8Array | string, name: string): Promise<any> {
  const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  const r = await srv.fetch(`/api/upload/${sha(b)}?offset=0&total=${b.length}&name=${q(name)}`, { method: "PUT", cookie, body: b });
  expect(r.status).toBe(200);
  return j(r);
}
async function done(id: number): Promise<any> {
  for (let i = 0; i < 600; i++) {
    const d = await j(await srv.fetch(`/api/docs/${id}`, { cookie }));
    if (d.state !== "pending") return d;
    await Bun.sleep(200);
  }
  throw new Error("still pending");
}

/* ---------- a small zip writer: entries deflated unless stored ---------- */
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const u16 = (n: number) => [n & 255, (n >> 8) & 255];
function zip(entries: [string, Uint8Array | string, boolean?][]): Uint8Array {
  const out: number[] = [], cd: number[] = [];
  for (const [name, data, stored] of entries) {
    const n = enc.encode(name), d = typeof data === "string" ? enc.encode(data) : data, c = stored ? d : Bun.deflateSync(d), m = stored ? 0 : 8, off = out.length;
    out.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(m), ...u16(0), ...u16(0), ...u32(0), ...u32(c.length), ...u32(d.length), ...u16(n.length), ...u16(0), ...n, ...c);
    cd.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(m), ...u16(0), ...u16(0), ...u32(0), ...u32(c.length), ...u32(d.length), ...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...n);
  }
  const cdOff = out.length;
  out.push(...cd, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cd.length), ...u32(cdOff), ...u16(0));
  return new Uint8Array(out);
}
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
const xhtml = (title: string, body: string, head = true) => `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml">${head ? `<head><title>${title}</title><script>alert(1)</script></head>` : ""}<body>${body}</body></html>`;
function epub(): Uint8Array {
  return zip([
    ["mimetype", "application/epub+zip", true],
    ["META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
    ["OEBPS/content.opf", `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Das Testbuch</dc:title><dc:creator opf:role="aut">Anna &amp; Autorin</dc:creator></metadata>
      <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/Kapitel%202.xhtml" media-type="application/xhtml+xml"/>
      <item id="cov" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="css" href="style.css" media-type="text/css"/></manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`],
    ["OEBPS/nav.xhtml", `<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">Der Anfang</a><ol><li><a href="ch1.xhtml#abschnitt">Ein Abschnitt</a></li></ol></li><li><a href="text/Kapitel%202.xhtml">Das Ende</a></li></ol></nav></body></html>`],
    ["OEBPS/ch1.xhtml", xhtml("Eins", "<h1>Der Anfang</h1><p>Es war einmal ein Zebrastreifen.</p>")],
    ["OEBPS/text/Kapitel 2.xhtml", xhtml("Zwei", "<h1>Das Ende</h1><p>Und dann kam der Quokka.</p>", false)],
    ["OEBPS/style.css", "p { color: red }"],
    ["OEBPS/images/cover.png", PNG],
  ]);
}

beforeAll(async () => {
  if (!haveVips) return;
  srv = await startServer(); cookie = await seedSession(srv); dir = mkdtempSync(join(tmpdir(), "monet-books-"));
});
afterAll(async () => { if (haveVips) { await srv.stop(); rmSync(dir, { recursive: true, force: true }); } });

/** A second server on the same data: its startup sweep renders what is pending. Runs until `ready()` or 60 s. */
async function secondServer(ready: () => boolean) {
  const port = 20000 + Math.floor(Math.random() * 30000);
  const p = Bun.spawn(["bun", join(import.meta.dir, "../server/main.ts")], { stdout: "ignore", stderr: "ignore", env: { ...srv.env, PORT: String(port), MONET_ORIGIN: `http://127.0.0.1:${port}` } });
  try { for (let i = 0; i < 300 && !ready(); i++) await Bun.sleep(200); } finally { p.kill(); await p.exited; }
}

const CSP = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

suite("books: EPUB", () => {
  let id: number;
  test("an EPUB becomes a book: author, spine length, cover and text for search", async () => {
    const r = await up(epub(), "Das Testbuch.epub");
    expect(r.doc).toMatchObject({ kind: "book", format: "epub", title: "Das Testbuch" });
    id = r.doc.id;
    const d = await done(id);
    expect(d).toMatchObject({ state: "ok", kind: "book", pages: 2, by: "Anna & Autorin", mime: "application/epub+zip", w: 1, h: 1 });
    expect((await srv.fetch(`/media/doc/${id}/c`, { cookie })).headers.get("content-type")).toBe("image/webp");
    const hit = await j(await srv.fetch(`/api/docs?q=${q("quokk")}&kind=book`, { cookie }));
    expect(hit.docs.map((x: any) => x.id)).toEqual([id]);
    expect((await j(await srv.fetch(`/api/docs?kind=book`, { cookie }))).docs[0].by).toBe("Anna & Autorin");
    expect((await j(await srv.fetch(`/api/docs?kind=doc`, { cookie }))).docs.some((x: any) => x.id === id)).toBe(false);
  }, T);
  test("BookOut: the spine in reading order with its titles, the table of contents with depth, hrefs resolved and decoded", async () => {
    const b = await j(await srv.fetch(`/api/docs/${id}/book`, { cookie }));
    expect(b.spine).toEqual([{ href: "OEBPS/ch1.xhtml", title: "Der Anfang" }, { href: "OEBPS/text/Kapitel 2.xhtml", title: "Das Ende" }]);
    expect(b.toc).toEqual([
      { title: "Der Anfang", href: "OEBPS/ch1.xhtml", depth: 0 }, { title: "Ein Abschnitt", href: "OEBPS/ch1.xhtml#abschnitt", depth: 1 }, { title: "Das Ende", href: "OEBPS/text/Kapitel 2.xhtml", depth: 0 }]);
    expect((await srv.fetch(`/api/docs/${id}/book`)).status).toBe(401);
  });
  test("a chapter goes out with the book CSP instead of the global one, the style before </head>, and immutable caching", async () => {
    const r = await srv.fetch(`/media/doc/${id}/book/OEBPS/ch1.xhtml`, { cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/xhtml+xml; charset=utf-8");
    expect(r.headers.get("content-security-policy")).toBe(CSP);
    expect(r.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const t = await r.text();
    expect(t).toContain("Zebrastreifen");
    expect(t.indexOf("color-scheme:light dark")).toBeGreaterThan(0);
    expect(t.indexOf("<style>")).toBeLessThan(t.indexOf("</head>"));
    expect(t.indexOf("<style>")).toBeGreaterThan(t.indexOf("<script>")); // injected before </head>, the page itself untouched
    const again = await srv.fetch(`/media/doc/${id}/book/OEBPS/ch1.xhtml`, { cookie, headers: { "if-none-match": r.headers.get("etag")! } });
    expect(again.status).toBe(304);
    expect(again.headers.get("content-security-policy")).toBe(CSP);
    // everything else keeps the global policy
    expect((await srv.fetch(`/api/docs/${id}`, { cookie })).headers.get("content-security-policy")).toContain("script-src 'self'");
  });
  test("percent-escapes are decoded; a page without </head> gets the style after <body>; css and images have their types", async () => {
    const r = await srv.fetch(`/media/doc/${id}/book/OEBPS/text/Kapitel%202.xhtml`, { cookie });
    expect(r.status).toBe(200);
    const t = await r.text();
    expect(t).toContain("Quokka");
    expect(t).toMatch(/<body>\s*<style>/);
    expect((await srv.fetch(`/media/doc/${id}/book/OEBPS/text/Kapitel 2.xhtml`, { cookie })).status).toBe(200);
    const css = await srv.fetch(`/media/doc/${id}/book/OEBPS/style.css`, { cookie });
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(css.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await css.text()).toBe("p { color: red }");
    const png = await srv.fetch(`/media/doc/${id}/book/OEBPS/images/cover.png`, { cookie });
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(PNG);
  });
  test("a path that climbs out, is absolute, is no entry, or asks without a session is refused", async () => {
    for (const p of ["..%2F..%2Fetc%2Fpasswd", "OEBPS%2F..%2F..%2Fx", "%2Fetc%2Fpasswd", "OEBPS/nope.xhtml", "OEBPS", "%00", "%E0%A4%A"])
      expect((await srv.fetch(`/media/doc/${id}/book/${p}`, { cookie })).status).toBe(404);
    expect((await srv.fetch(`/media/doc/${id}/book/OEBPS/ch1.xhtml`)).status).toBe(401);
    expect((await srv.fetch(`/media/doc/999999/book/OEBPS/ch1.xhtml`, { cookie })).status).toBe(404);
    // not a book: another kind of file has no entries
    const csv = (await up("a,b\n1,2\n", "x.csv")).doc.id;
    expect((await srv.fetch(`/media/doc/${csv}/book/a`, { cookie })).status).toBe(404);
    expect((await srv.fetch(`/api/docs/${csv}/book`, { cookie })).status).toBe(404);
  });
  test("an SVG inside the book gets the same restrictive CSP; a book without a cover has none", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>`;
    const b = zip([
      ["mimetype", "application/epub+zip", true],
      ["META-INF/container.xml", `<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>`],
      ["book.opf", `<package><metadata/><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="n" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="n"><itemref idref="a"/></spine></package>`],
      ["toc.ncx", `<ncx><navMap><navPoint id="p1"><navLabel><text>Alles</text></navLabel><content src="a.xhtml"/><navPoint id="p2"><navLabel><text>Unten</text></navLabel><content src="a.xhtml#u"/></navPoint></navPoint></navMap></ncx>`],
      ["a.xhtml", xhtml("a", "<p>Hallo</p>")], ["pic.svg", svg],
    ]);
    const r = await up(b, "ohne.epub"), d = await done(r.doc.id);
    expect(d).toMatchObject({ state: "ok", kind: "book", pages: 1 });
    expect(d.by).toBeUndefined();
    expect((await srv.fetch(`/media/doc/${d.id}/c`, { cookie })).status).toBe(404);
    expect((await j(await srv.fetch(`/api/docs/${d.id}/book`, { cookie }))).toc).toEqual([{ title: "Alles", href: "a.xhtml", depth: 0 }, { title: "Unten", href: "a.xhtml#u", depth: 1 }]);
    const s = await srv.fetch(`/media/doc/${d.id}/book/pic.svg`, { cookie });
    expect(s.headers.get("content-type")).toBe("image/svg+xml");
    expect(s.headers.get("content-security-policy")).toBe(CSP);
  }, T);
  test("a zip named .epub without a container is kept as an other file; a broken EPUB fails but stays downloadable", async () => {
    const z = zip([["hello.txt", "x"]]);
    expect((await up(z, "nichts.epub")).doc).toMatchObject({ kind: "other", format: "epub" });
    const bad = zip([["mimetype", "application/epub+zip", true], ["META-INF/container.xml", "<container/>"]]);
    const r = await up(bad, "kaputt.epub");
    expect(r.doc.kind).toBe("book");
    const d = await done(r.doc.id);
    expect(d).toMatchObject({ state: "failed", error: "Diese Datei konnte nicht aufbereitet werden." });
    expect((await srv.fetch(`/media/doc/${d.id}/o`, { cookie })).status).toBe(200);
    expect((await srv.fetch(`/media/doc/${d.id}/book/META-INF/container.xml`, { cookie })).status).toBe(404);
  }, T);
});

audioSuite("audio", () => {
  async function make(name: string, args: string[]): Promise<Uint8Array> {
    const cover = join(dir, "cover.jpg");
    if (!existsSync(cover)) { await Bun.spawn(["vips", "black", join(dir, "c0.jpg"), "320", "240"]).exited; await Bun.spawn(["vips", "linear", join(dir, "c0.jpg"), cover, "1", "90"]).exited; }
    const out = join(dir, name);
    const p = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-i", cover, ...args, out], { stderr: "pipe" });
    expect(await p.exited, await new Response(p.stderr).text()).toBe(0);
    return new Uint8Array(await Bun.file(out).arrayBuffer());
  }
  let mp3: any, m4a: any;
  test("an mp3 with ID3 tags and cover art: title, artist, album, track '3/12', duration, cover", async () => {
    const b = await make("t.mp3", ["-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "copy", "-id3v2_version", "3", "-metadata", "title=Ein Titel", "-metadata", "artist=Die Band", "-metadata", "album=Das Album", "-metadata", "track=3/12"]);
    const r = await up(b, "01 - rohdatei.mp3");
    expect(r.doc).toMatchObject({ kind: "audio", format: "mp3", title: "01 - rohdatei" });
    mp3 = await done(r.doc.id);
    expect(mp3).toMatchObject({ state: "ok", kind: "audio", title: "Ein Titel", by: "Die Band", album: "Das Album", track: 3, mime: "audio/mpeg", pages: null });
    expect(Math.abs(mp3.durationMs - 2000)).toBeLessThan(150);
    expect(mp3.w / mp3.h).toBeCloseTo(4 / 3, 1);
    const c = await srv.fetch(`/media/doc/${mp3.id}/c`, { cookie });
    expect(c.status).toBe(200); expect(c.headers.get("content-type")).toBe("image/webp");
    // the tags are searchable, and the list takes kind=audio
    expect((await j(await srv.fetch(`/api/docs?q=${q("das alb")}`, { cookie }))).docs.map((x: any) => x.id)).toContain(mp3.id);
    expect((await j(await srv.fetch(`/api/docs?kind=audio`, { cookie }))).docs.map((x: any) => x.id)).toContain(mp3.id);
  }, T);
  test("an m4a (brand M4A, taken before the video rule): tags, duration, cover", async () => {
    const b = await make("t.m4a", ["-map", "0:a", "-map", "1:v", "-c:a", "aac", "-c:v", "mjpeg", "-disposition:v", "attached_pic", "-metadata", "title=M4A Titel", "-metadata", "artist=Band Zwei", "-metadata", "album=Alb", "-metadata", "track=2"]);
    expect(String.fromCharCode(...b.slice(8, 12))).toBe("M4A ");
    const r = await up(b, "stück.m4a");
    expect(r.doc).toMatchObject({ kind: "audio", format: "m4a" });
    m4a = await done(r.doc.id);
    expect(m4a).toMatchObject({ state: "ok", title: "M4A Titel", by: "Band Zwei", album: "Alb", track: 2, mime: "audio/mp4" });
    expect(Math.abs(m4a.durationMs - 2000)).toBeLessThan(200);
    expect((await srv.fetch(`/media/doc/${m4a.id}/c`, { cookie })).status).toBe(200);
  }, T);
  test("a file without tags keeps the title of its name and has no artist, album or track; a wav and an ogg work too", async () => {
    const wav = await make("plain.wav", ["-map", "0:a", "-c:a", "pcm_s16le"]);
    const r = await up(wav, "Aufnahme 1.wav");
    const d = await done(r.doc.id);
    expect(d).toMatchObject({ state: "ok", kind: "audio", format: "wav", title: "Aufnahme 1", mime: "audio/wav" });
    expect(d.by).toBeUndefined(); expect(d.album).toBeUndefined(); expect(d.track).toBeUndefined();
    expect(d.durationMs).toBeGreaterThan(1800);
    expect((await srv.fetch(`/media/doc/${d.id}/c`, { cookie })).status).toBe(404);
    const ogg = await make("t.ogg", ["-map", "0:a", "-c:a", "libopus", "-metadata", "TITLE=Vorbis Titel", "-metadata", "ARTIST=Uppercase Artist", "-metadata", "TRACKNUMBER=7"]);
    const o = await done((await up(ogg, "v.ogg")).doc.id);
    expect(o).toMatchObject({ state: "ok", format: "ogg", title: "Vorbis Titel", by: "Uppercase Artist", track: 7, mime: "audio/ogg" });
  }, T);
  test("play: inline with the audio type, Range answers 206, a file that is not audio is a 404", async () => {
    const full = await srv.fetch(`/media/doc/${mp3.id}/play`, { cookie });
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/mpeg");
    expect(full.headers.get("content-disposition")).toBe("inline");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    const all = new Uint8Array(await full.arrayBuffer());
    expect(all.length).toBe(mp3.bytes);
    const part = await srv.fetch(`/media/doc/${mp3.id}/play`, { cookie, headers: { range: "bytes=100-199" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 100-199/${mp3.bytes}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(all.slice(100, 200));
    const tail = await srv.fetch(`/media/doc/${mp3.id}/play`, { cookie, headers: { range: "bytes=-50" } });
    expect(tail.status).toBe(206); expect((await tail.arrayBuffer()).byteLength).toBe(50);
    expect((await srv.fetch(`/media/doc/${m4a.id}/play`, { cookie })).headers.get("content-type")).toBe("audio/mp4");
    expect((await srv.fetch(`/media/doc/${mp3.id}/play`)).status).toBe(401);
    const csv = (await up("a,b\n", "p.csv")).doc.id;
    expect((await srv.fetch(`/media/doc/${csv}/play`, { cookie })).status).toBe(404);
  });
  test("rendering again keeps a title the person changed: the tag only replaces the title a file got from its name", async () => {
    srv.db().query("UPDATE doc SET title = 'Mein Name', state = 'pending' WHERE id = ?").run(mp3.id);
    srv.db().query("UPDATE doc SET state = 'pending' WHERE id = ?").run(m4a.id); // its title is still the one the tag gave it: not the name's, so it stays too
    await secondServer(() => (srv.db().query("SELECT count(*) AS n FROM doc WHERE state = 'pending'").get() as any).n === 0);
    expect((await j(await srv.fetch(`/api/docs/${mp3.id}`, { cookie }))).title).toBe("Mein Name");
    expect((await j(await srv.fetch(`/api/docs/${m4a.id}`, { cookie }))).title).toBe("M4A Titel");
    srv.db().query("UPDATE doc SET title = '01 - rohdatei', state = 'pending' WHERE id = ?").run(mp3.id); // as the name made it: the tag wins
    await secondServer(() => (srv.db().query("SELECT count(*) AS n FROM doc WHERE state = 'pending'").get() as any).n === 0);
    expect((await j(await srv.fetch(`/api/docs/${mp3.id}`, { cookie }))).title).toBe("Ein Titel");
  }, T);
  test("a file named .mp3 that is no audio fails to render, stays downloadable", async () => {
    const r = await up(new Uint8Array([0xff, 0xfb, 0x90, 0, ...new Uint8Array(200)]), "kaputt.mp3");
    expect(r.doc.kind).toBe("audio");
    expect((await done(r.doc.id)).state).toBe("failed");
  }, T);
});

suite("other files", () => {
  test("random bytes: kept, ok at once, downloadable, no text", async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(5000)); bytes[0] = 0;
    const r = await up(bytes, "Daten.BIN");
    expect(r.doc).toMatchObject({ kind: "other", format: "bin", title: "Daten", state: "ok", bytes: 5000 });
    expect(r.doc.text).toBeUndefined();
    const o = await srv.fetch(`/media/doc/${r.doc.id}/o`, { cookie });
    expect(o.headers.get("content-disposition")).toStartWith("attachment;");
    expect(new Uint8Array(await o.arrayBuffer())).toEqual(bytes);
    expect((await srv.fetch(`/media/doc/${r.doc.id}/text`, { cookie })).status).toBe(404);
    expect((await srv.fetch(`/media/doc/${r.doc.id}/c`, { cookie })).status).toBe(404);
    expect((await j(await srv.fetch(`/api/docs/${r.doc.id}`, { cookie }))).format).toBe("bin");
  });
  test("a name without extension is 'bin'; an extension, any extension, is the format", async () => {
    const r = await up(new Uint8Array([1, 0, 2]), "LIESMICH");
    expect(r.doc).toMatchObject({ kind: "other", format: "bin", title: "LIESMICH" });
    expect((await up(new Uint8Array([9, 0, 9]), "x.Weird")).doc).toMatchObject({ format: "weird", title: "x" });
  });
  test("a yaml file reads as text: text flag, /text, search; a text file with a NUL does not", async () => {
    const yaml = "name: Zeppelin\nliste:\n  - eins\n  - zwei\nkey: Größe\n";
    const r = await up(yaml, "config.yaml");
    expect(r.doc).toMatchObject({ kind: "other", format: "yaml", state: "ok", text: true });
    const t = await srv.fetch(`/media/doc/${r.doc.id}/text`, { cookie });
    expect(t.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await t.text()).toBe(yaml);
    expect((await j(await srv.fetch(`/api/docs?q=zeppel`, { cookie }))).docs.map((x: any) => x.id)).toEqual([r.doc.id]);
    expect((await j(await srv.fetch(`/api/docs/${r.doc.id}`, { cookie }))).text).toBe(true);
    const nul = (await up(new Uint8Array([65, 0, 66]), "n.txt")).doc;
    expect(nul).toMatchObject({ kind: "other", format: "txt" });
    expect(nul.text).toBeUndefined();
    expect((await srv.fetch(`/media/doc/${nul.id}/text`, { cookie })).status).toBe(404);
  });
  test("an empty file is still refused", async () => {
    const r = await srv.fetch(`/api/upload/${"a".repeat(64)}?offset=0&total=0&name=x.bin`, { method: "PUT", cookie, body: new Uint8Array(0) });
    expect(r.status).toBe(400);
  });
});

suite("sheets: NDJSON with an index", () => {
  const N = 150_000;
  let id: number;
  test("150 000 rows are not cut; windows are read from the end, across index blocks and past the end", async () => {
    let csv = "Nr;Name;Wert\n";
    for (let i = 1; i <= N; i++) csv += `${i};"Zeile ${i}, mit Komma";${i * 2}\n`;
    csv += "\n\n;;\n"; // trailing empty rows are dropped
    const r = await up(csv, "gross.csv");
    expect(r.doc.kind).toBe("sheet");
    const d = await done(r.doc.id);
    id = d.id;
    expect(d.sheets).toEqual([{ name: "Tabelle 1", rows: N + 1, cols: 3, truncated: false }]);
    const end = await j(await srv.fetch(`/api/docs/${id}/sheet/0?from=${N - 4}&n=1000`, { cookie }));
    expect(end.from).toBe(N - 4);
    expect(end.rows.length).toBe(5);
    expect(end.rows[4]).toEqual([String(N), `Zeile ${N}, mit Komma`, String(N * 2)]);
    // a window that starts inside an index block (256 rows) and crosses into the next
    const mid = await j(await srv.fetch(`/api/docs/${id}/sheet/0?from=250&n=10`, { cookie }));
    expect(mid.rows.map((x: string[]) => x[0])).toEqual(["250", "251", "252", "253", "254", "255", "256", "257", "258", "259"]);
    const first = await j(await srv.fetch(`/api/docs/${id}/sheet/0?from=0&n=2`, { cookie }));
    expect(first.rows).toEqual([["Nr", "Name", "Wert"], ["1", "Zeile 1, mit Komma", "2"]]);
    const deep = await j(await srv.fetch(`/api/docs/${id}/sheet/0?from=100000&n=3`, { cookie }));
    expect(deep.rows.map((x: string[]) => x[0])).toEqual(["100000", "100001", "100002"]);
    expect((await j(await srv.fetch(`/api/docs/${id}/sheet/0?from=${N + 1}&n=5`, { cookie }))).rows).toEqual([]);
    expect((await j(await srv.fetch(`/api/docs/${id}/sheet/0?from=${N + 50}&n=5`, { cookie }))).rows).toEqual([]);
  }, T);
  test("on disk: -s0.ndjson and -s0.idx (one float64 per 256 rows), no .json; the cover is there", async () => {
    const row = srv.db().query("SELECT sha256 FROM doc WHERE id = ?").get(id) as { sha256: string };
    const d = join(srv.env.MONET_DATA, "d", row.sha256.slice(0, 2)), names = readdirSync(d).filter(f => f.startsWith(row.sha256));
    expect(names).toContain(`${row.sha256}-s0.ndjson`);
    expect(names).toContain(`${row.sha256}-s0.idx`);
    expect(names.some(f => f.endsWith(".json") || f.endsWith(".part"))).toBe(false);
    expect(Bun.file(join(d, `${row.sha256}-s0.idx`)).size).toBe(Math.ceil((N + 1) / 256) * 8);
    expect((await srv.fetch(`/media/doc/${id}/c`, { cookie })).status).toBe(200);
  });
  test("a sheet made with the old JSON storage is rendered again when the server starts, and the old file goes", async () => {
    const row = srv.db().query("SELECT sha256 FROM doc WHERE id = ?").get(id) as { sha256: string };
    const d = join(srv.env.MONET_DATA, "d", row.sha256.slice(0, 2));
    rmSync(join(d, `${row.sha256}-s0.ndjson`)); rmSync(join(d, `${row.sha256}-s0.idx`));
    writeFileSync(join(d, `${row.sha256}-s0.json`), "[[\"alt\"]]");
    // a second server on the same data: its startup sweep does the work
    await secondServer(() => existsSync(join(d, `${row.sha256}-s0.idx`)) && (srv.db().query("SELECT state FROM doc WHERE id = ?").get(id) as any).state === "ok");
    expect(existsSync(join(d, `${row.sha256}-s0.ndjson`))).toBe(true);
    expect(existsSync(join(d, `${row.sha256}-s0.json`))).toBe(false);
    const w = await j(await srv.fetch(`/api/docs/${id}/sheet/0?from=${N}&n=1`, { cookie }));
    expect(w.rows[0][0]).toBe(String(N));
  }, T);
});
