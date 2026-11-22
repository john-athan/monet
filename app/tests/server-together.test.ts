// Everything together (docs/together.md): dates of files, stacks, text pieces, transcripts, moments, and the
// server end to end: files on the timeline, stacks, the Mac's transcripts, vectors from the darkroom, links and search.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chunkText, CHUNK_HEAD, CHUNK_SPREAD } from "../server/chunks";
import { chooseDocDate, isoDate, pdfInfoDate, textDate } from "../server/docdate";
import { findMoments, span } from "../server/moments";
import { cleanSegments, overlap, planStacks, stem, wordSet } from "../server/together";
import { pairDevice, seedSession, startServer, type Srv } from "./helpers";
import { findOnPage, fromOcr, parseBbox } from "../server/doctext";

const UP = Date.UTC(2026, 10, 22, 12);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

describe("dates of files", () => {
  test("ISO dates: with a zone that instant, without one Berlin wall time", () => {
    expect(isoDate("2021-03-12T10:22:01Z")).toBe(Date.UTC(2021, 2, 12, 10, 22, 1));
    expect(isoDate("2021-03-12T10:22:01+01:00")).toBe(Date.UTC(2021, 2, 12, 9, 22, 1));
    expect(isoDate("2021-07-12T10:00:00")).toBe(Date.UTC(2021, 6, 12, 8));
    expect(isoDate("nonsense")).toBeNull();
    expect(pdfInfoDate("Producer: x\nCreationDate:    2019-11-14T15:00:57+01\nModDate: 2020-01-01")).toBe(Date.UTC(2019, 10, 14, 14, 0, 57));
  });
  test("the first date written in the text, in any of the usual forms", () => {
    expect(day(textDate("Rechnung Nr. 12\nMünchen, den 12.03.2021\nfällig 01.04.2021", UP)!)).toBe("2021-03-12");
    expect(day(textDate("Berlin, 3. März 2020", UP)!)).toBe("2020-03-03");
    expect(day(textDate("Date: 2019-08-06", UP)!)).toBe("2019-08-06");
    expect(day(textDate("Published March 12, 2021 by", UP)!)).toBe("2021-03-12");
    // in the future, before 1990, or impossible: no date
    expect(textDate("am 31.02.2021 und 12.03.2099 und 01.01.1970", UP)).toBeNull();
  });
  test("metadata first, then the name, then the text (letters only), then the mtime, then the upload", () => {
    const base = { meta: null, name: null, text: null, modifiedAt: UP, uploadedAt: UP, kind: "doc" };
    expect(chooseDocDate({ ...base, meta: Date.UTC(2020, 0, 1) }).src).toBe("meta");
    expect(chooseDocDate({ ...base, meta: Date.UTC(1980, 0, 1), name: "Lohnabrechnung_20240630.pdf" })).toMatchObject({ src: "name" });
    expect(chooseDocDate({ ...base, text: "Datum: 05.06.2018" })).toMatchObject({ src: "text" });
    expect(chooseDocDate({ ...base, kind: "book", text: "Datum: 05.06.2018" }).src).toBe("upload");
    expect(chooseDocDate({ ...base, modifiedAt: Date.UTC(2022, 1, 2) })).toEqual({ takenAt: Date.UTC(2022, 1, 2), src: "mtime" });
    expect(chooseDocDate(base)).toEqual({ takenAt: UP, src: "upload" });
  });
});

describe("text pieces", () => {
  test("the title alone, then pieces of 32 words from the start and spread over the rest", () => {
    const words = Array.from({ length: 32 * 40 }, (_, i) => `wort${i}`).join(" ");
    const c = chunkText("Vertrag_v2-final", words);
    expect(c[0]).toBe("Vertrag v2 final");
    expect(c.length).toBe(1 + CHUNK_HEAD + CHUNK_SPREAD);
    expect(c[1].split(" ").length).toBe(32);
    expect(c[1].startsWith("wort0 ")).toBe(true);
    expect(c[CHUNK_HEAD + 1].startsWith(`wort${32 * CHUNK_HEAD}`)).toBe(false); // spread, not the next one
  });
  test("numbers say nothing: a sheet of figures gives only its title", () => {
    expect(chunkText("Zahlen", "1 2 3 4,50 € 12.03.2021 99 100")).toEqual(["Zahlen"]);
  });
});

describe("stacks", () => {
  test("a stem without digits and version words", () => {
    expect(stem("Vertrag_v2 (1)")).toBe("vertrag");
    expect(stem("Vertrag final")).toBe("vertrag");
    expect(stem("Girokonto_5426468360_Kontoauszug_20240630")).toBe("girokonto # kontoauszug #");
    expect(stem("2024-11-02")).toBe("");
  });
  test("word overlap of two texts", () => {
    const a = wordSet(Array.from({ length: 40 }, (_, i) => `wort${String.fromCharCode(97 + (i % 26))}`).join(" "))!;
    expect(overlap(a, a)).toBe(1);
    expect(wordSet("zu kurz")).toBeNull();
  });
  test("same stem within a few days stacks, newest first; a month later is a new stack; another kind never", () => {
    const D = 86400_000, t0 = Date.UTC(2024, 5, 1);
    const r = (id: number, title: string, d: number, kind = "doc") => ({ id, kind, title, text: null, taken_at: t0 + d * D });
    const s = planStacks([r(1, "Scan_001", 0), r(2, "Scan_002", 0.1), r(3, "Scan_003", 1), r(4, "Brief Oma", 1.2), r(5, "Scan_004", 30), r(6, "Scan_005", 30.5, "slides"), r(7, "Scan_006", 31)]);
    expect(s).toEqual([[3, 2, 1], [7, 5]]);
  });
  test("near-identical texts stack under different names", () => {
    const L = (i: number) => String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26));
    const text = Array.from({ length: 60 }, (_, i) => `klausel${L(i)}`).join(" ");
    const s = planStacks([{ id: 1, kind: "doc", title: "Mietvertrag", text, taken_at: 0 }, { id: 2, kind: "doc", title: "Endfassung Wohnung", text: text + " zusatz", taken_at: 3600_000 }]);
    expect(s).toEqual([[2, 1]]);
  });
});

describe("transcripts and moments", () => {
  test("segments are cleaned, sorted and capped", () => {
    expect(cleanSegments([{ s: 3000, e: 4000, t: " zwei " }, { s: 0, e: 1000, t: "eins" }, { s: 5, e: 1, t: "kaputt" }, { s: 1, e: 2, t: "" }, null]))
      .toEqual([{ s: 0, e: 1000, t: "eins" }, { s: 3000, e: 4000, t: "zwei" }]);
    expect(() => cleanSegments("nein")).toThrow();
  });
  test("German spans of days", () => {
    expect(span("2025-05-03", "2025-05-03")).toBe("3. Mai 2025");
    expect(span("2025-05-03", "2025-05-09")).toBe("3. bis 9. Mai 2025");
    expect(span("2025-04-28", "2025-05-03")).toBe("28. April bis 3. Mai 2025");
    expect(span("2024-12-30", "2025-01-02")).toBe("30. Dezember 2024 bis 2. Januar 2025");
  });
  test("days away from home form a moment; a big day at home needs a label that names it", () => {
    const home = { place_id: 1, name: "München", lat: 48.14, lon: 11.58 }, lis = { place_id: 2, name: "Lissabon", lat: 38.72, lon: -9.14 }, por = { place_id: 3, name: "Porto", lat: 41.15, lon: -8.61 };
    let id = 0;
    const rows: any[] = [];
    const shoot = (d: string, at: any, n: number) => { for (let k = 0; k < n; k++) rows.push({ id: ++id, day: d, ...at }); };
    for (const d of ["2025-01-05", "2025-02-07", "2025-03-01", "2025-04-02", "2025-06-01"]) shoot(d, home, 3);
    shoot("2025-05-03", lis, 8); shoot("2025-05-05", lis, 6); shoot("2025-05-06", por, 5); // a gap of one day stays one trip
    shoot("2025-05-20", lis, 3); // too few
    shoot("2025-12-24", home, 40);
    const xmas = new Set(rows.filter(r => r.day === "2025-12-24").slice(0, 12).map(r => r.id));
    const m = findMoments(rows, ids => new Map([["Weihnachten", ids.filter(i => xmas.has(i)).length]]));
    expect(m.map(x => [x.start, x.end, x.title])).toEqual([["2025-05-03", "2025-05-06", "Lissabon und Porto"], ["2025-12-24", "2025-12-24", "Weihnachten 2025"]]);
    expect(m[0].ids.length).toBe(19);
  });
});

describe("text on the page", () => {
  const html = `<doc><page width="200.000000" height="100.000000"><flow><block><line xMin="10" yMin="20" xMax="110" yMax="30">
    <word xMin="10" yMin="20" xMax="50" yMax="30">Straße</word><word xMin="60" yMin="20" xMax="110" yMax="30">&amp;Co</word></line>
    <line xMin="10" yMin="40" xMax="90" yMax="50"><word xMin="10" yMin="40" xMax="90" yMax="50">Fußmatte</word></line></block></flow></page>
    <page width="200.000000" height="100.000000"></page></doc>`;
  test("pdftotext's boxes become fractions of the page, lines carry their words' text", () => {
    const p = parseBbox(html);
    expect(p.length).toBe(2);
    expect(p[0].l).toEqual([[0.05, 0.2, 0.5, 0.1, "Straße &Co"], [0.05, 0.4, 0.4, 0.1, "Fußmatte"]]);
    expect(p[0].w[1]).toEqual([0.3, 0.2, 0.25, 0.1, "&Co"]);
    expect(p[1]).toEqual({ l: [], w: [] });
  });
  test("find ignores case, accents and ß, spans words and lines, and returns the boxes of the words it touches", () => {
    const w = parseBbox(html)[0].w;
    expect(findOnPage(w, "STRASSE")).toEqual([[[0.05, 0.2, 0.2, 0.1]]]);
    expect(findOnPage(w, "co fuss")).toEqual([[[0.3, 0.2, 0.25, 0.1], [0.05, 0.4, 0.4, 0.1]]]);
    expect(findOnPage(w, "matte")).toEqual([[[0.05, 0.4, 0.4, 0.1]]]);
    expect(findOnPage(w, "nirgends")).toEqual([]);
  });
  test("an OCR line shares its box among its words by their letters", () => {
    const p = fromOcr([{ x: 0.1, y: 0.2, w: 0.5, h: 0.05, t: "ab  cdef" }]);
    expect(p.l).toEqual([[0.1, 0.2, 0.5, 0.05, "ab cdef"]]);
    expect(p.w.map(x => [x[0], x[2], x[4]])).toEqual([[0.1, 0.1429, "ab"], [0.3143, 0.2857, "cdef"]]);
  });
});

/* ---------- end to end ---------- */
const haveVips = !!Bun.which("vips") && !!Bun.which("vipsheader") && !!Bun.which("pdftotext") && !!Bun.which("pdfinfo");
const suite = haveVips ? describe : describe.skip;
let srv: Srv, cookie: string;
const enc = new TextEncoder();
const sha = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const j = (r: Response) => r.json() as Promise<any>;
/** A one page PDF with the given text and no CreationDate. */
function pdf(text: string): Uint8Array {
  const s = `BT /F1 18 Tf 40 700 Td (${text}) Tj ET`;
  return enc.encode(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[4 0 R]/Count 1>>endobj\n3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n` +
    `4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 5 0 R/Resources<</Font<</F1 3 0 R>>>>>>endobj\n5 0 obj<</Length ${s.length}>>stream\n${s}\nendstream endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n`);
}
async function upDoc(bytes: Uint8Array, name: string, mtime?: number): Promise<number> {
  const r = await srv.fetch(`/api/upload/${sha(bytes)}?offset=0&total=${bytes.length}&name=${encodeURIComponent(name)}${mtime ? `&mtime=${mtime}` : ""}`, { method: "PUT", cookie, body: bytes });
  expect(r.status).toBe(200);
  const id = (await j(r)).doc.id;
  for (let i = 0; i < 300; i++) { const d = await j(await srv.fetch(`/api/docs/${id}`, { cookie })); if (d.state !== "pending") break; await Bun.sleep(100); }
  return id;
}
/** Waits until the file has its day (dating runs right after the render). */
async function dated(id: number) { for (let i = 0; i < 100; i++) { if ((srv.db().query("SELECT day FROM doc WHERE id = ?").get(id) as any)?.day) return; await Bun.sleep(50); } }

suite("together end to end", () => {
  beforeAll(async () => { srv = await startServer(); cookie = await seedSession(srv); }, 60_000);
  afterAll(async () => { await srv?.stop(); });

  test("a file stands on the timeline on the day its text names", async () => {
    const id = await upDoc(pdf("Muenchen, den 12.03.2021 Rechnung Nummer 7"), "Rechnung.pdf");
    await dated(id);
    const row = srv.db().query("SELECT day, taken_src FROM doc WHERE id = ?").get(id) as any;
    expect(row).toEqual({ day: "2021-03-12", taken_src: "text" });
    const tl = await j(await srv.fetch("/api/timeline?limit=60", { cookie }));
    const d = tl.days.find((x: any) => x.date === "2021-03-12");
    expect(d.items).toEqual([]);
    expect(d.docs.map((x: any) => x.id)).toEqual([id]);
    const none = await j(await srv.fetch("/api/timeline?limit=60&files=0", { cookie }));
    expect(none.days.find((x: any) => x.date === "2021-03-12")).toBeUndefined();
  }, 60_000);

  test("scans of one day stack: the timeline and the list show the top, the stack shows all", async () => {
    const t = Date.UTC(2023, 4, 10, 9);
    const a = await upDoc(pdf("Seite eins"), "Scan_0001.pdf", t), b = await upDoc(pdf("Seite zwei"), "Scan_0002.pdf", t + 60_000);
    await dated(a); await dated(b);
    await Bun.sleep(2500); // the restack waits for uploads to settle
    const tl = await j(await srv.fetch("/api/timeline?limit=60", { cookie }));
    const d = tl.days.find((x: any) => x.date === "2023-05-10");
    expect(d.docs.length).toBe(1);
    expect(d.docs[0]).toMatchObject({ id: b, stack: { count: 2 } });
    const st = await j(await srv.fetch(`/api/docs/${b}/stack`, { cookie }));
    expect(st.map((x: any) => x.id)).toEqual([b, a]);
    expect((await srv.fetch(`/api/docs/${a}/unstack`, { method: "POST", cookie })).status).toBe(200);
    const after = await j(await srv.fetch(`/api/docs/${b}/stack`, { cookie }));
    expect(after.map((x: any) => x.id)).toEqual([b]);
  }, 60_000);

  test("the Mac transcribes a recording: pending, post, search, detail", async () => {
    const mac = await pairDevice(srv, cookie, "mac");
    // a recording without album: one row is enough, the transcript does not need the file
    const owner = (srv.db().query("SELECT id FROM owner LIMIT 1").get() as any).id;
    const rid = (srv.db().query(`INSERT INTO doc (owner_id, sha256, kind, format, mime, bytes, title, modified_at, uploaded_at, source, orig_path, state, duration_ms)
      VALUES (?, 'f00d', 'audio', 'm4a', 'audio/mp4', 10, 'Sprachmemo', 1, 1, 'web', 'docs/x.m4a', 'ok', 5000) RETURNING id`).get(owner) as any).id;
    const pend = await j(await srv.fetch("/api/index/speech/pending", { token: mac.token }));
    expect(pend).toContainEqual({ ref: "doc", id: rid, durationMs: 5000, ext: "m4a" });
    const r = await srv.fetch(`/api/index/speech/doc/${rid}`, { method: "POST", token: mac.token, origin: null, json: { model: "apple-speech", lang: "de-DE", segments: [{ s: 0, e: 1500, t: "Der Schlüssel liegt unter der Fußmatte" }] } });
    expect(r.status).toBe(200);
    const pend2 = await j(await srv.fetch("/api/index/speech/pending", { token: mac.token }));
    expect(pend2.some((p: any) => p.id === rid && p.ref === "doc")).toBe(false);
    const det = await j(await srv.fetch(`/api/docs/${rid}`, { cookie }));
    expect(det.transcript.segments[0].t).toBe("Der Schlüssel liegt unter der Fußmatte");
    const s = await j(await srv.fetch("/api/search", { method: "POST", cookie, json: { chips: [{ kind: "content", label: "fußmatte", value: "fußmatte" }] } }));
    expect(s.docs.map((x: any) => x.id)).toContain(rid);
    // the browser cannot post transcripts for another library, and a device never for another owner
    const failed = await srv.fetch(`/api/index/speech/doc/${rid}`, { method: "POST", token: mac.token, origin: null, json: { model: "apple-speech", failed: true } });
    expect(failed.status).toBe(200);
  }, 60_000);

  test("a PDF's text stands on its pages: the text layer and find say where; a scan waits for OCR", async () => {
    const id = await upDoc(pdf("Der Schluessel liegt unter der Fussmatte"), "Notiz.pdf");
    for (let i = 0; i < 100 && (srv.db().query("SELECT words_ok FROM doc WHERE id = ?").get(id) as any).words_ok === 0; i++) await Bun.sleep(50);
    expect((srv.db().query("SELECT words_ok FROM doc WHERE id = ?").get(id) as any).words_ok).toBe(1);
    const lines = await j(await srv.fetch(`/api/docs/${id}/words/1`, { cookie }));
    expect(lines[0][4]).toBe("Der Schluessel liegt unter der Fussmatte");
    expect((await srv.fetch(`/api/docs/${id}/words/2`, { cookie })).status).toBe(404);
    const f = await j(await srv.fetch(`/api/docs/${id}/find?q=${encodeURIComponent("unter der fuss")}`, { cookie }));
    expect(f.hits.length).toBe(1);
    expect(f.hits[0].page).toBe(1);
    expect(f.hits[0].boxes.length).toBe(3);
    // a page with no text at all is a scan
    const blank = enc.encode(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj\n4 0 obj<</Length 21>>stream\n10 10 200 200 re f\nendstream endobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF\n`);
    const sid = await upDoc(blank, "Scan.pdf");
    for (let i = 0; i < 100 && (srv.db().query("SELECT words_ok FROM doc WHERE id = ?").get(sid) as any).words_ok === 0; i++) await Bun.sleep(50);
    expect((srv.db().query("SELECT words_ok FROM doc WHERE id = ?").get(sid) as any).words_ok).toBe(4);
  }, 60_000);

  test("the darkroom gets a file's plan and posts vectors of exactly that length", async () => {
    const id = await upDoc(pdf("Ein Brief an die Hausverwaltung wegen der Heizung im Treppenhaus"), "Brief Hausverwaltung.pdf");
    const pend = await j(await srv.fetch("/api/index/docs/pending?limit=50", { cookie }));
    const p = pend.find((x: any) => x.id === id);
    expect(p.images).toEqual([`/media/doc/${id}/c`]);
    expect(p.texts[0]).toBe("Brief Hausverwaltung");
    const v = () => { const f = new Float32Array(768); f[Math.floor(Math.random() * 768)] = 1; return Buffer.from(f.buffer).toString("base64"); };
    const bad = await srv.fetch(`/api/index/doc/${id}`, { method: "POST", cookie, json: { model: "siglip2-b32-256", images: [], texts: p.texts.map(v) } });
    expect(bad.status).toBe(409);
    const ok = await srv.fetch(`/api/index/doc/${id}`, { method: "POST", cookie, json: { model: "siglip2-b32-256", images: p.images.map(v), texts: p.texts.map(v) } });
    expect(ok.status).toBe(200);
    expect((srv.db().query("SELECT vec_ok FROM doc WHERE id = ?").get(id) as any).vec_ok).toBe(1);
    expect((srv.db().query("SELECT count(*) AS n FROM doc_vec WHERE doc_id = ?").get(id) as any).n).toBe(p.images.length + p.texts.length);
  }, 60_000);
});
