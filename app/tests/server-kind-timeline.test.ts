// The timeline of one kind of file and search results as days (docs/together.md, "Timeline" and "Search").
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedSession, startServer, type Srv } from "./helpers";

const haveVips = !!Bun.which("vips") && !!Bun.which("vipsheader") && !!Bun.which("pdftotext") && !!Bun.which("pdfinfo");
const suite = haveVips ? describe : describe.skip;
let srv: Srv, cookie: string;
const enc = new TextEncoder();
const sha = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const j = (r: Response) => r.json() as Promise<any>;
function pdf(text: string): Uint8Array {
  const s = `BT /F1 18 Tf 40 700 Td (${text}) Tj ET`;
  return enc.encode(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[4 0 R]/Count 1>>endobj\n3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n` +
    `4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 5 0 R/Resources<</Font<</F1 3 0 R>>>>>>endobj\n5 0 obj<</Length ${s.length}>>stream\n${s}\nendstream endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n`);
}
async function upDoc(bytes: Uint8Array, name: string): Promise<number> {
  const r = await srv.fetch(`/api/upload/${sha(bytes)}?offset=0&total=${bytes.length}&name=${encodeURIComponent(name)}`, { method: "PUT", cookie, body: bytes });
  expect(r.status).toBe(200);
  const id = (await j(r)).doc.id;
  for (let i = 0; i < 300; i++) { const d = await j(await srv.fetch(`/api/docs/${id}`, { cookie })); if (d.state !== "pending") break; await Bun.sleep(100); }
  for (let i = 0; i < 100; i++) { if ((srv.db().query("SELECT day FROM doc WHERE id = ?").get(id) as any)?.day) break; await Bun.sleep(50); }
  return id;
}

suite("the timeline of one kind", () => {
  let a = 0, b = 0;
  beforeAll(async () => {
    srv = await startServer(); cookie = await seedSession(srv);
    a = await upDoc(pdf("Berlin, den 04.02.2019 Quittung Fahrrad"), "Quittung.pdf");
    b = await upDoc(pdf("Hamburg, den 20.08.2022 Mietvertrag Wohnung"), "Mietvertrag.pdf");
  }, 60_000);
  afterAll(async () => { await srv?.stop(); });

  test("only files of that kind, on their days, newest first, with a band of their months", async () => {
    const tl = await j(await srv.fetch("/api/timeline?limit=60&kind=doc", { cookie }));
    expect(tl.days.map((d: any) => d.date)).toEqual(["2022-08-20", "2019-02-04"]);
    expect(tl.days.every((d: any) => d.items.length === 0)).toBe(true);
    expect(tl.days[0].docs.map((x: any) => x.id)).toEqual([b]);
    expect((await j(await srv.fetch("/api/timeline?limit=60&kind=book", { cookie }))).days).toEqual([]);
    const band = await j(await srv.fetch("/api/band?kind=doc", { cookie }));
    expect(band.months.map((m: any) => [m.ym, m.n])).toEqual([["2022-08", 1], ["2019-02", 1]]);
    expect((await srv.fetch("/api/timeline?kind=nonsense", { cookie })).status).toBe(400);
  }, 30_000);

  test("a search keeps the timeline, of its hits", async () => {
    const tl = await j(await srv.fetch("/api/timeline?limit=60&kind=doc&q=Quittung", { cookie }));
    expect(tl.days.map((d: any) => [d.date, d.docs.map((x: any) => x.id)])).toEqual([["2019-02-04", [a]]]);
    const band = await j(await srv.fetch("/api/band?kind=doc&q=Quittung", { cookie }));
    expect(band.months.map((m: any) => m.ym)).toEqual(["2019-02"]);
  }, 30_000);

  test("the search page lays its hits out as days, with the band", async () => {
    const chips = [{ kind: "text", value: "Mietvertrag", label: "Mietvertrag" }];
    const r = await j(await srv.fetch("/api/search", { method: "POST", cookie, json: { chips, sort: "date", days: true, limit: 50 } }));
    expect(r.days.map((d: any) => [d.date, d.docs.map((x: any) => x.id)])).toEqual([["2022-08-20", [b]]]);
    expect(r.band.map((m: any) => m.ym)).toEqual(["2022-08"]);
    const plain = await j(await srv.fetch("/api/search", { method: "POST", cookie, json: { chips, sort: "best" } }));
    expect(plain.days).toBeUndefined();
  }, 30_000);
});
