// Files end to end (docs/files.md): a real server, real libvips and poppler, and soffice where it is installed. Uploads of a
// CSV, text, PDFs and an office file, pages, sheets, search, folders, rename, delete and owner scoping.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSession, startServer, type Srv } from "./helpers";

const haveVips = !!Bun.which("vips") && !!Bun.which("vipsthumbnail") && !!Bun.which("vipsheader") && !!Bun.which("pdftotext");
const haveSoffice = !!Bun.which("soffice");
const suite = haveVips ? describe : describe.skip;
const T = 180_000;

let srv: Srv, cookie: string, other: string, dir: string;
const enc = new TextEncoder();
const sha = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const j = (r: Response) => r.json() as Promise<any>;
const q = (s: string) => encodeURIComponent(s);

/** One chunk, the whole file. */
async function up(bytes: Uint8Array | string, name: string, extra = "", token = cookie): Promise<Response> {
  const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  return srv.fetch(`/api/upload/${sha(b)}?offset=0&total=${b.length}&name=${q(name)}${extra}`, { method: "PUT", cookie: token, body: b });
}
async function upDoc(bytes: Uint8Array | string, name: string, extra = "", token = cookie): Promise<any> {
  const r = await up(bytes, name, extra, token);
  expect(r.status).toBe(200);
  const b = await j(r);
  expect(b.doc).toBeTruthy();
  return b;
}
/** Waits until the file is no longer pending. */
async function done(id: number): Promise<any> {
  for (let i = 0; i < 900; i++) {
    const d = await j(await srv.fetch(`/api/docs/${id}`, { cookie }));
    if (d.state !== "pending") return d;
    await Bun.sleep(200);
  }
  throw new Error("still pending");
}
/** A hand-written PDF: one page per entry (width, height, text). No xref table: poppler rebuilds it. */
function pdf(pages: [number, number, string][]): Uint8Array {
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  let o = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>endobj\n3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n`;
  pages.forEach(([w, h, t], i) => {
    const s = `BT /F1 36 Tf 72 ${h - 100} Td (${t}) Tj ET`;
    o += `${4 + i * 2} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${h}]/Contents ${5 + i * 2} 0 R/Resources<</Font<</F1 3 0 R>>>>>>endobj\n`;
    o += `${5 + i * 2} 0 obj<</Length ${s.length}>>stream\n${s}\nendstream endobj\n`;
  });
  return enc.encode(o + `trailer<</Root 1 0 R/Size ${4 + pages.length * 2}>>\n%%EOF\n`);
}
async function makeImage(name: string, gain: number): Promise<Uint8Array> {
  const out = join(dir, name);
  await Bun.spawn(["vips", "black", out, "320", "240"]).exited;
  await Bun.spawn(["vips", "linear", out, join(dir, "g_" + name), "1", String(gain)]).exited;
  return new Uint8Array(await Bun.file(join(dir, "g_" + name)).arrayBuffer());
}

beforeAll(async () => {
  if (!haveVips) return;
  srv = await startServer(); cookie = await seedSession(srv); dir = mkdtempSync(join(tmpdir(), "monet-docs-"));
  // a second member of the household, with a session of their own
  const o = srv.db().query("INSERT INTO owner (name, role, created_at) VALUES ('Zwei', 'member', ?) RETURNING id").get(Date.now()) as { id: number };
  other = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  srv.db().query("INSERT INTO auth_session (hash, account_id, kind, created_at, expires_at, last_seen_at) VALUES (?, ?, 'browser', ?, ?, ?)")
    .run(new Bun.CryptoHasher("sha256").update(other).digest("hex"), o.id, Date.now(), Date.now() + 86400_000, Date.now());
});
afterAll(async () => { if (haveVips) { await srv.stop(); rmSync(dir, { recursive: true, force: true }); } });

suite("sheets: CSV", () => {
  let id: number;
  const csv = 'Name;Notiz;Betrag\nAnna;"Zeile eins\nZeile zwei, mit Komma";12,5\n"Bob ""B""";Zahnarzt;7\n\n';
  test("a CSV with semicolons and a multi-line quoted cell becomes a sheet", async () => {
    const r = await upDoc(csv, "Haushalt 2026.csv", "&mtime=1700000000000");
    expect(r.duplicate).toBe(false);
    expect(r.doc).toMatchObject({ kind: "sheet", format: "csv", title: "Haushalt 2026", pages: null, modifiedAt: 1700000000000, folderId: null, bytes: csv.length });
    id = r.doc.id;
    const d = await done(id);
    expect(d).toMatchObject({ state: "ok", kind: "sheet", w: 4, h: 3, error: null, path: [], origName: "Haushalt 2026.csv", mime: "text/csv", sheets: [{ name: "Tabelle 1", rows: 3, cols: 3, truncated: false }] });
  }, T);
  test("rows come in windows, padded, with the line break inside the cell", async () => {
    const w = await j(await srv.fetch(`/api/docs/${id}/sheet/0?from=1&n=1`, { cookie }));
    expect(w).toEqual({ from: 1, rows: [["Anna", "Zeile eins\nZeile zwei, mit Komma", "12,5"]] });
    const all = await j(await srv.fetch(`/api/docs/${id}/sheet/0?n=99999`, { cookie }));
    expect(all.rows.length).toBe(3);
    expect(all.rows[2]).toEqual(['Bob "B"', "Zahnarzt", "7"]);
    expect((await srv.fetch(`/api/docs/${id}/sheet/1`, { cookie })).status).toBe(404);
    expect((await srv.fetch(`/api/docs/${id}/sheet/0`)).status).toBe(401);
  });
  test("cover and decoded text are served with the immutable headers; the cover is a webp", async () => {
    const c = await srv.fetch(`/media/doc/${id}/c`, { cookie });
    expect(c.status).toBe(200); expect(c.headers.get("content-type")).toBe("image/webp");
    expect(c.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const etag = c.headers.get("etag")!;
    expect((await srv.fetch(`/media/doc/${id}/c`, { cookie, headers: { "if-none-match": etag } })).status).toBe(304);
    const t = await srv.fetch(`/media/doc/${id}/text`, { cookie });
    expect(t.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await t.text()).toBe(csv);
    expect((await srv.fetch(`/media/doc/${id}/p/1`, { cookie })).status).toBe(404); // a sheet has no pages
  });
  test("windows-1252 text is decoded, and the cells are searchable", async () => {
    const bytes = new Uint8Array([...enc.encode("Stra"), 0xdf, ...enc.encode("e;Gr"), 0xfc, 0xdf, ...enc.encode("e\nA;B\n")]);
    const r = await upDoc(bytes, "alt.csv");
    expect((await done(r.doc.id)).state).toBe("ok");
    expect(await (await srv.fetch(`/media/doc/${r.doc.id}/text`, { cookie })).text()).toBe("Straße;Grüße\nA;B\n");
    expect((await j(await srv.fetch(`/api/docs/${r.doc.id}/sheet/0`, { cookie }))).rows[0]).toEqual(["Straße", "Grüße"]);
    const hit = await j(await srv.fetch(`/api/docs?q=${q("zahn")}`, { cookie })); // prefix of a cell of the first sheet
    expect(hit.docs.map((d: any) => d.id)).toEqual([id]);
  }, T);
  test("a file is not a sheet only because of its name: text with a NUL, an unknown extension and a plain zip are kept as other files", async () => {
    for (const [bytes, name, format, text] of [[new Uint8Array([65, 0, 66]), "x.txt", "txt", false], ["%PDF-1.4 hallo", "x.exe", "pdf", false], ["hallo", "x.html", "html", true],
      [new Uint8Array([0x50, 0x4b, 3, 4, ...new Uint8Array(100)]), "x.docx", "docx", false]] as const) {
      const r = await up(bytes, name);
      expect(r.status).toBe(200);
      const d = (await j(r)).doc;
      if (name === "x.exe") expect(d).toMatchObject({ kind: "doc", format: "pdf" }); // the bytes decide
      else expect(d).toMatchObject({ kind: "other", format, state: "ok" });
      if (d.kind === "other") expect(d.text === true).toBe(text);
    }
  });
});

suite("documents: PDF", () => {
  let doc: any, slides: any;
  test("a portrait PDF: two pages, a cover, size from the first page, text for search", async () => {
    const r = await upDoc(pdf([[612, 792, "Hello Monet Rechnung"], [612, 792, "Seite zwei Strom"]]), "Bericht Ü.pdf", "&mtime=1600000000000");
    expect(r.doc).toMatchObject({ kind: "doc", format: "pdf", title: "Bericht Ü", state: "pending" });
    doc = await done(r.doc.id);
    expect(doc).toMatchObject({ state: "ok", kind: "doc", pages: 2, w: 612, h: 792, modifiedAt: 1600000000000 });
    expect((await srv.fetch(`/media/doc/${doc.id}/c`, { cookie })).headers.get("content-type")).toBe("image/webp");
  }, T);
  test("pages are made when asked for, once: two requests for the same page render it once; a page that is not there is a 404", async () => {
    const [a, b, c] = await Promise.all([1, 1, 1].map(() => srv.fetch(`/media/doc/${doc.id}/p/1`, { cookie })));
    for (const r of [a, b, c]) { expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe("image/webp"); expect(r.headers.get("etag")).toBe(`"${doc.sha256}-p1"`); }
    const [x, y] = [await a.arrayBuffer(), await b.arrayBuffer()];
    expect(x.byteLength).toBeGreaterThan(500); expect(x.byteLength).toBe(y.byteLength);
    writeFileSync(join(dir, "page.webp"), new Uint8Array(x));
    expect(Number((await new Response(Bun.spawn(["vipsheader", "-f", "width", join(dir, "page.webp")], { stdout: "pipe" }).stdout).text()).trim())).toBe(1600);
    expect((await srv.fetch(`/media/doc/${doc.id}/t/2`, { cookie })).status).toBe(200);
    expect((await srv.fetch(`/media/doc/${doc.id}/p/3`, { cookie })).status).toBe(404);
    expect((await srv.fetch(`/media/doc/${doc.id}/p/0`, { cookie })).status).toBe(404);
    expect((await srv.fetch(`/media/doc/${doc.id}/p/1`)).status).toBe(401);
    expect((await srv.fetch(`/media/doc/${doc.id}/text`, { cookie })).status).toBe(404); // not a text format
  }, T);
  test("the original is a download under its own name, in ASCII and in RFC 5987 form, and Range works", async () => {
    const o = await srv.fetch(`/media/doc/${doc.id}/o`, { cookie });
    expect(o.status).toBe(200); expect(o.headers.get("content-type")).toBe("application/pdf");
    expect(o.headers.get("content-disposition")).toBe(`attachment; filename="Bericht _.pdf"; filename*=UTF-8''Bericht%20%C3%9C.pdf`);
    expect(sha(new Uint8Array(await o.arrayBuffer()))).toBe(doc.sha256);
    const part = await srv.fetch(`/media/doc/${doc.id}/o`, { cookie, headers: { range: "bytes=0-4" } });
    expect(part.status).toBe(206); expect(await part.text()).toBe("%PDF-");
  });
  test("a landscape PDF is a presentation", async () => {
    const r = await upDoc(pdf([[792, 612, "Folie eins"], [792, 612, "Folie zwei"], [792, 612, "Folie drei"]]), "Vortrag.pdf");
    slides = await done(r.doc.id);
    expect(slides).toMatchObject({ state: "ok", kind: "slides", pages: 3, w: 792, h: 612 });
    expect((await j(await srv.fetch("/api/docs?kind=slides", { cookie }))).docs.map((d: any) => d.id)).toEqual([slides.id]);
  }, T);
  test("a PDF that cannot be rendered is marked failed with a German sentence, and the original stays", async () => {
    const r = await upDoc(enc.encode("%PDF-1.4 this is not a pdf"), "kaputt.pdf");
    const d = await done(r.doc.id);
    expect(d).toMatchObject({ state: "failed", error: "Diese Datei konnte nicht aufbereitet werden." });
    expect((await srv.fetch(`/media/doc/${d.id}/o`, { cookie })).status).toBe(200);
    expect((await srv.fetch(`/media/doc/${d.id}/c`, { cookie })).status).toBe(404);
  }, T);
  test("search over title and text: /api/docs?q= and the docs of /api/search; none without words", async () => {
    const ids = async (qs: string) => (await j(await srv.fetch(`/api/docs?q=${q(qs)}`, { cookie }))).docs.map((d: any) => d.id);
    expect(await ids("Rechnung")).toEqual([doc.id]);
    expect(await ids("strom")).toEqual([doc.id]);
    expect(await ids("Bericht")).toEqual([doc.id]); // the title
    expect(await ids("hello mon")).toEqual([doc.id]); // every word, the last one a prefix
    expect(await ids('"; DROP TABLE doc; --')).toEqual([]);
    const s = await j(await srv.fetch("/api/search", { method: "POST", cookie, json: { chips: [{ kind: "content", label: "Rechnung", value: "Rechnung" }] } }));
    expect(s.docs.map((d: any) => d.id)).toEqual([doc.id]);
    expect(s.docs[0].owner).toBeUndefined();
    const none = await j(await srv.fetch("/api/search", { method: "POST", cookie, json: { chips: [] } }));
    expect(none.docs).toEqual([]);
  });
  test("the same file again is a duplicate; /api/upload/check and /api/status know files", async () => {
    const again = await upDoc(pdf([[612, 792, "Hello Monet Rechnung"], [612, 792, "Seite zwei Strom"]]), "Kopie.pdf");
    expect(again).toMatchObject({ duplicate: true, doc: { id: doc.id, title: "Bericht Ü" } });
    const known = await j(await srv.fetch("/api/upload/check", { method: "POST", cookie, json: { hashes: [doc.sha256, "c".repeat(64)] } }));
    expect(known.missing).toEqual(["c".repeat(64)]);
    const st = await j(await srv.fetch("/api/status", { cookie }));
    expect(st.docs.n).toBeGreaterThanOrEqual(4); expect(st.docs.pending).toBe(0);
  });
  test("the list is paged newest first by cursor", async () => {
    const all = (await j(await srv.fetch("/api/docs", { cookie }))).docs;
    expect(all.map((d: any) => d.modifiedAt)).toEqual([...all.map((d: any) => d.modifiedAt)].sort((a, b) => b - a));
    const seen: number[] = [];
    let cursor: string | null = "";
    for (let k = 0; k < 20 && cursor !== null; k++) {
      const p: any = await j(await srv.fetch(`/api/docs?limit=2${cursor ? `&cursor=${q(cursor)}` : ""}`, { cookie }));
      expect(p.docs.length).toBeLessThanOrEqual(2);
      seen.push(...p.docs.map((d: any) => d.id)); cursor = p.next;
    }
    expect(seen).toEqual(all.map((d: any) => d.id));
    expect((await srv.fetch("/api/docs?cursor=zzz", { cookie })).status).toBe(400);
    expect((await srv.fetch("/api/docs?kind=video", { cookie })).status).toBe(400);
  });
});

suite("the Ablage", () => {
  let photo: number, a: number, b: number, d1: any;
  test("folders: create, a clash is a 409, names are checked", async () => {
    const mk = (name: string, parentId: number | null = null, token = cookie) => srv.fetch("/api/folders", { method: "POST", cookie: token, json: { name, parentId } });
    const r = await mk("  Uni "); expect(r.status).toBe(200);
    const f = await j(r); a = f.id;
    expect(f).toEqual({ id: a, name: "Uni", count: 0, peek: [] });
    expect((await mk("Uni")).status).toBe(409);
    expect((await mk("Uni", a)).status).toBe(200); // the same name one level down is fine
    expect((await mk("")).status).toBe(400);
    expect((await mk("a/b")).status).toBe(400);
    expect((await mk("x".repeat(121))).status).toBe(400);
    expect((await mk("Fremd", 99999)).status).toBe(404);
    expect((await mk("Fremd", a, other)).status).toBe(404); // another member's folder is not theirs to fill
  });
  test("uploading with folder= makes the missing folders; in= is the folder it was dropped on, in=0 the top; a duplicate keeps its folder", async () => {
    d1 = (await upDoc("Name\nSeminar eins\n", "Notiz.csv", "&folder=" + q("Kurs/Seminar") + `&in=${a}`)).doc;
    const top = await j(await srv.fetch("/api/folders/0", { cookie }));
    expect(top).toMatchObject({ id: null, name: "Ablage", path: [], items: [] });
    const uni = await j(await srv.fetch(`/api/folders/${a}`, { cookie }));
    expect(uni.folders.map((f: any) => f.name)).toEqual(["Kurs", "Uni"]); // Uni/Uni from before, Uni/Kurs made now
    const kurs = uni.folders.find((f: any) => f.name === "Kurs");
    expect(kurs.count).toBe(1);
    const sem = (await j(await srv.fetch(`/api/folders/${kurs.id}`, { cookie }))).folders[0];
    expect(sem.name).toBe("Seminar"); expect(sem.count).toBe(1);
    expect(d1.folderId).toBe(sem.id); b = sem.id;
    expect(await j(await srv.fetch(`/api/folders/${b}`, { cookie }))).toMatchObject({ id: b, name: "Seminar", path: [{ id: a, name: "Uni" }, { id: kurs.id, name: "Kurs" }, { id: b, name: "Seminar" }], docs: [{ id: d1.id }] });
    expect((await j(await srv.fetch(`/api/docs/${d1.id}`, { cookie }))).path.map((f: any) => f.name)).toEqual(["Uni", "Kurs", "Seminar"]);
    // the same file again, dropped elsewhere: it keeps its folder, and no folder is made for it
    const again = await upDoc("Name\nSeminar eins\n", "Notiz.csv", "&folder=Anderswo");
    expect(again).toMatchObject({ duplicate: true, doc: { id: d1.id, folderId: b } });
    // a path that exists below the top is found again, not made twice
    const two = await upDoc("Name\nSeminar zwei\n", "Zwei.csv", "&folder=" + q("Uni/Kurs/Seminar") + "&in=0");
    expect(two.doc.folderId).toBe(b);
    expect((await j(await srv.fetch("/api/folders/0", { cookie }))).folders.map((f: any) => f.name)).toEqual(["Uni"]);
    expect((await up("x\n", "n.csv", "&in=99999")).status).toBe(404);
  }, T);
  test("a duplicate without a folder is moved into the one named; photos go into folders like files", async () => {
    const free = await upDoc("Name\nFrei\n", "Frei.csv");
    expect(free.doc.folderId).toBeNull();
    const moved = await upDoc("Name\nFrei\n", "Frei.csv", `&in=${b}`);
    expect(moved).toMatchObject({ duplicate: true, doc: { id: free.doc.id, folderId: b } });
    const img = await makeImage("p.jpg", 50);
    photo = (await j(await up(img, "IMG_20200101_100000.jpg", `&in=${a}`))).item.id;
    expect(srv.db().query("SELECT folder_id FROM item WHERE id = ?").get(photo)).toEqual({ folder_id: a });
    const uni = await j(await srv.fetch(`/api/folders/${a}`, { cookie }));
    expect(uni.items.map((i: any) => i.id)).toEqual([photo]);
    const sem = (await j(await srv.fetch(`/api/folders/${uni.folders.find((f: any) => f.name === "Kurs").id}`, { cookie }))).folders.find((f: any) => f.id === b);
    expect(sem.count).toBe(3);
    expect(sem.peek.length).toBe(3); expect(sem.peek.every((p: any) => typeof p.doc === "number")).toBe(true);
    // the photo is still in the feed: folders change nothing there
    expect((await j(await srv.fetch("/api/timeline", { cookie }))).days.flatMap((d: any) => d.items).map((i: any) => i.id)).toContain(photo);
  }, T);
  test("move: photos, files and folders; into itself or below is a 400; a clash is a 409; the top is null", async () => {
    const mv = (body: unknown, token = cookie) => srv.fetch("/api/move", { method: "POST", cookie: token, json: body });
    const c = (await j(await srv.fetch("/api/folders", { method: "POST", cookie, json: { name: "Archiv", parentId: null } }))).id;
    expect((await mv({ into: c, docs: [d1.id], items: [photo] })).status).toBe(200);
    expect(srv.db().query("SELECT folder_id FROM doc WHERE id = ?").get(d1.id)).toEqual({ folder_id: c });
    expect(srv.db().query("SELECT folder_id FROM item WHERE id = ?").get(photo)).toEqual({ folder_id: c });
    // Uni holds Seminar: into its own subfolder and into itself are cycles
    expect((await mv({ into: b, folders: [a] })).status).toBe(400);
    expect((await mv({ into: a, folders: [a] })).status).toBe(400);
    expect((await mv({ into: c, folders: [a] })).status).toBe(200);
    expect(srv.db().query("SELECT parent_id FROM folder WHERE id = ?").get(a)).toEqual({ parent_id: c });
    // a new Uni at the top: the old one cannot come back next to it
    await srv.fetch("/api/folders", { method: "POST", cookie, json: { name: "Uni", parentId: null } });
    expect((await mv({ into: null, folders: [a] })).status).toBe(409);
    expect((await mv({ into: null, docs: [d1.id], items: [photo] })).status).toBe(200);
    expect(srv.db().query("SELECT folder_id FROM item WHERE id = ?").get(photo)).toEqual({ folder_id: null });
    expect((await mv({ into: 99999, docs: [d1.id] })).status).toBe(404);
    expect((await mv({ into: c, docs: [99999] })).status).toBe(404);
    expect((await mv({ into: c, docs: [d1.id] }, other)).status).toBe(404); // someone else's folder and file
  });
  test("rename a folder (a clash is a 409) and delete: only an empty one", async () => {
    const top = (await j(await srv.fetch("/api/folders/0", { cookie }))).folders;
    const arch = top.find((f: any) => f.name === "Archiv");
    expect(arch.count).toBeGreaterThan(0);
    expect((await srv.fetch(`/api/folders/${arch.id}`, { method: "DELETE", cookie })).status).toBe(409);
    expect((await srv.fetch(`/api/folders/${arch.id}`, { method: "PATCH", cookie, json: { name: "Uni" } })).status).toBe(409);
    expect(await j(await srv.fetch(`/api/folders/${arch.id}`, { method: "PATCH", cookie, json: { name: "Altes" } }))).toMatchObject({ id: arch.id, name: "Altes" });
    expect((await srv.fetch(`/api/folders/${arch.id}`, { method: "PATCH", cookie: other, json: { name: "Mein" } })).status).toBe(404);
    const e = (await j(await srv.fetch("/api/folders", { method: "POST", cookie, json: { name: "Leer", parentId: null } }))).id;
    expect((await srv.fetch(`/api/folders/${e}`, { method: "DELETE", cookie: other })).status).toBe(404);
    expect((await srv.fetch(`/api/folders/${e}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await srv.fetch(`/api/folders/${e}`, { cookie })).status).toBe(404);
  });
});

suite("rename, delete and owners", () => {
  let id: number;
  const text = "Name\nDas Gutachten\n";
  test("rename changes the title and the search; delete hides from lists and search, restore brings it back", async () => {
    id = (await upDoc(text, "Zettel.csv")).doc.id;
    const r = await srv.fetch(`/api/docs/${id}`, { method: "PATCH", cookie, json: { title: "  Neuer Titel " } });
    expect(await j(r)).toMatchObject({ id, title: "Neuer Titel" });
    expect((await srv.fetch(`/api/docs/${id}`, { method: "PATCH", cookie, json: { title: "  " } })).status).toBe(400);
    const find = async (w: string) => (await j(await srv.fetch(`/api/docs?q=${q(w)}`, { cookie }))).docs.map((d: any) => d.id);
    await done(id);
    expect(await find("neuer")).toEqual([id]); expect(await find("zettel")).toEqual([]); expect(await find("gutachten")).toEqual([id]); // the text survives a rename
    expect((await srv.fetch(`/api/docs/${id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await j(await srv.fetch("/api/docs", { cookie }))).docs.map((d: any) => d.id)).not.toContain(id);
    expect(await find("neuer")).toEqual([]);
    expect((await j(await srv.fetch(`/api/docs/${id}`, { cookie }))).deletedAt).toBeGreaterThan(0);
    expect((await srv.fetch(`/api/docs/${id}/restore`, { method: "POST", cookie })).status).toBe(200);
    expect(await find("neuer")).toEqual([id]);
  }, T);
  test("another member reads the household's files but changes none of them", async () => {
    const asOther = (path: string, init: any = {}) => srv.fetch(path, { cookie: other, ...init });
    const first = srv.db().query("SELECT owner_id FROM doc WHERE id = ?").get(id) as { owner_id: number };
    expect((await j(await asOther(`/api/docs/${id}`))).owner).toBe(first.owner_id);
    expect((await asOther(`/media/doc/${id}/o`)).status).toBe(200);
    expect((await asOther(`/api/docs/${id}`, { method: "PATCH", json: { title: "Gekapert" } })).status).toBe(404);
    expect((await asOther(`/api/docs/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await asOther(`/api/docs/${id}/restore`, { method: "POST" })).status).toBe(404);
    expect((await asOther("/api/move", { method: "POST", json: { into: null, docs: [id] } })).status).toBe(404);
    expect(srv.db().query("SELECT title, deleted_at FROM doc WHERE id = ?").get(id)).toEqual({ title: "Neuer Titel", deleted_at: null });
    // their own library has none of it; X-Monet-Of shows the first one's, a search over the household marks the owner
    expect((await j(await asOther("/api/docs"))).docs).toEqual([]);
    expect((await j(await asOther("/api/docs", { headers: { "x-monet-of": String(first.owner_id) } }))).docs.length).toBeGreaterThan(3);
    const chip = { chips: [{ kind: "content", label: "Titel", value: "Titel" }] };
    expect((await j(await asOther("/api/search", { method: "POST", json: { everyone: true, ...chip } }))).docs).toMatchObject([{ id, owner: first.owner_id }]);
    expect((await j(await asOther("/api/search", { method: "POST", json: chip }))).docs).toEqual([]);
    // the other member can keep the same file in their own library
    expect((await upDoc(text, "Zettel.csv", "", other)).duplicate).toBe(false);
  }, T);
  test("purge: a file deleted long ago goes with its original and everything made from it", async () => {
    const d = await done((await upDoc(pdf([[612, 792, "Zum Loeschen"]]), "weg.pdf")).doc.id);
    expect((await srv.fetch(`/media/doc/${d.id}/p/1`, { cookie })).status).toBe(200);
    const row = srv.db().query("SELECT orig_path FROM doc WHERE id = ?").get(d.id) as { orig_path: string };
    const derivedDir = join(srv.dir, "data", "d", d.sha256.slice(0, 2));
    const mine = () => readdirSync(derivedDir).filter(f => f.startsWith(d.sha256));
    expect(existsSync(join(srv.dir, "originals", row.orig_path))).toBe(true);
    expect(mine().sort()).toEqual([`${d.sha256}-c.webp`, `${d.sha256}-p1.webp`]);
    // a file deleted a week ago stays; one deleted 31 days ago goes (library.purge from a second process on the same files)
    await srv.fetch(`/api/docs/${d.id}`, { method: "DELETE", cookie });
    srv.db().query("UPDATE doc SET deleted_at = ? WHERE id = ?").run(Date.now() - 7 * 86400_000, d.id);
    await purgeIn();
    expect(srv.db().query("SELECT count(*) AS n FROM doc WHERE id = ?").get(d.id)).toEqual({ n: 1 });
    srv.db().query("UPDATE doc SET deleted_at = ? WHERE id = ?").run(Date.now() - 31 * 86400_000, d.id);
    await purgeIn();
    expect(srv.db().query("SELECT count(*) AS n FROM doc WHERE id = ?").get(d.id)).toEqual({ n: 0 });
    expect(srv.db().query("SELECT count(*) AS n FROM doc_fts WHERE rowid = ?").get(d.id)).toEqual({ n: 0 });
    expect(existsSync(join(srv.dir, "originals", row.orig_path))).toBe(false);
    expect(mine()).toEqual([]);
  }, T);
});

/** Runs library.purge against the server's files and database, from a second process. */
async function purgeIn() {
  const p = Bun.spawn(["bun", "-e", `import { purge } from "./server/library"; purge();`], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", env: srv.env });
  const [code, err] = [await p.exited, await new Response(p.stderr).text()];
  if (code !== 0) throw new Error(err);
}

(haveVips && haveSoffice ? describe : describe.skip)("office files through soffice", () => {
  test("a text file and a real docx become pages with a cover; the docx is made by soffice itself", async () => {
    const txt = "Quartalsbericht\n\nDie Umsaetze stiegen im dritten Quartal.\n";
    const r = await upDoc(txt, "Quartal.txt");
    const t = await done(r.doc.id);
    expect(t).toMatchObject({ state: "ok", kind: "doc", format: "txt", title: "Quartal" });
    expect(t.pages).toBeGreaterThanOrEqual(1);
    expect((await srv.fetch(`/media/doc/${t.id}/c`, { cookie })).status).toBe(200);
    expect(await (await srv.fetch(`/media/doc/${t.id}/text`, { cookie })).text()).toBe(txt);
    expect((await j(await srv.fetch(`/api/docs?q=${q("umsaetze")}`, { cookie }))).docs.map((d: any) => d.id)).toContain(t.id);

    const work = mkdtempSync(join(dir, "lo-"));
    writeFileSync(join(work, "Bilanz.txt"), "Bilanz des Jahres\n\nEin zweiter Absatz zum Lesen.\n");
    const conv = Bun.spawn(["soffice", `-env:UserInstallation=${Bun.pathToFileURL(join(work, "profile")).href}`, "--headless", "--norestore", "--convert-to", "docx", "--outdir", work, join(work, "Bilanz.txt")],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: process.env.HOME ?? work } });
    await conv.exited;
    const docx = new Uint8Array(await Bun.file(join(work, "Bilanz.docx")).arrayBuffer());
    const d = await upDoc(docx, "Bilanz.docx");
    expect(d.doc).toMatchObject({ kind: "doc", format: "docx", title: "Bilanz" });
    const ok = await done(d.doc.id);
    expect(ok.state).toBe("ok"); expect(ok.pages).toBeGreaterThanOrEqual(1);
    expect((await j(await srv.fetch(`/api/docs?q=${q("zweiter absatz")}`, { cookie }))).docs.map((x: any) => x.id)).toEqual([d.doc.id]);
    expect((await srv.fetch(`/media/doc/${d.doc.id}/p/1`, { cookie })).status).toBe(200);

    // a workbook: soffice writes one CSV per sheet and the server reads them back
    writeFileSync(join(work, "Kasse.csv"), "Posten,Betrag\nMiete,\"1.200,50\"\nStrom,80\n");
    const toXlsx = Bun.spawn(["soffice", `-env:UserInstallation=${Bun.pathToFileURL(join(work, "profile")).href}`, "--headless", "--norestore", "--convert-to", "xlsx", "--outdir", work, join(work, "Kasse.csv")],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: process.env.HOME ?? work } });
    await toXlsx.exited;
    const x = await upDoc(new Uint8Array(await Bun.file(join(work, "Kasse.xlsx")).arrayBuffer()), "Kasse.xlsx");
    expect(x.doc).toMatchObject({ kind: "sheet", format: "xlsx" });
    const xd = await done(x.doc.id);
    expect(xd.state).toBe("ok"); expect(xd.sheets).toHaveLength(1); expect(xd.sheets[0]).toMatchObject({ rows: 3, cols: 2, truncated: false });
    const rows = (await j(await srv.fetch(`/api/docs/${x.doc.id}/sheet/0`, { cookie }))).rows;
    expect(rows[0]).toEqual(["Posten", "Betrag"]); expect(rows[2][0]).toBe("Strom");
    expect((await srv.fetch(`/media/doc/${x.doc.id}/c`, { cookie })).status).toBe(200);
  }, 300_000);
});
