// The map: /api/map and the places' position and colours. Shape, owner isolation, device tokens.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { pairDevice, seedSession, startServer, type Srv } from "./helpers";

let srv: Srv, cookie: string, other: string;
const j = async (r: Response) => r.json() as Promise<any>;
let n = 0;
function item(owner: number, o: { lat?: number | null; lon?: number | null; color?: string; place?: number | null; burst?: [number, number]; thumbs?: number; deleted?: boolean } = {}) {
  const k = ++n;
  return srv.db().query(`INSERT INTO item (owner_id, sha256, kind, mime, ext, bytes, width, height, taken_at, taken_src, day, lat, lon, place_id, source, uploaded_at, color, colors, burst_id, burst_rank, thumbs_ok, deleted_at, orig_path)
    VALUES (?, ?, 'photo', 'image/jpeg', 'jpg', 1, 100, 100, ?, 'exif', '2026-01-01', ?, ?, ?, 'test', 1, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(owner, "sha" + k, 1_700_000_000_000 + k, o.lat === undefined ? 35.9 : o.lat, o.lon === undefined ? 14.5 : o.lon, o.place ?? null, o.color ?? "#336699", JSON.stringify([o.color ?? "#336699"]),
      o.burst?.[0] ?? null, o.burst?.[1] ?? null, o.thumbs ?? 1, o.deleted ? 1 : null, "o/" + k) as { id: number };
}

beforeAll(async () => {
  srv = await startServer(); cookie = await seedSession(srv);
  const db = srv.db();
  const me = (db.query("SELECT id FROM owner LIMIT 1").get() as any).id;
  const you = (db.query("INSERT INTO owner (name, created_at) VALUES ('Du', 1) RETURNING id").get() as any).id;
  other = String(you);
  db.query("INSERT INTO place (id, name, country, lat, lon) VALUES (1, 'Valletta', 'MT', 35.8989, 14.5146)").run();
  item(me, { place: 1, color: "#d08030" }); item(me, { place: 1, color: "#3060c0" });
  item(me, { lat: null, lon: null });                                  // no position
  item(me, { thumbs: 0 });                                             // not finished
  item(me, { deleted: true });                                         // in the trash
  item(me, { burst: [7, 1], color: "#00aa00" }); item(me, { burst: [7, 2] }); // a stack counts once
  item(you, { lat: 48.1, lon: 11.5, color: "#ff0000" });               // someone else's
});
afterAll(async () => { await srv.stop(); });

describe("map", () => {
  test("GET /api/map: parallel arrays of the shown geotagged photos of this owner only", async () => {
    const m = await j(await srv.fetch("/api/map", { cookie }));
    expect(Object.keys(m).sort()).toEqual(["color", "ids", "lat", "lon"]);
    expect(m.ids.length).toBe(3);
    expect([m.lat.length, m.lon.length, m.color.length]).toEqual([3, 3, 3]);
    expect(m.color).toContain("#d08030"); expect(m.color).toContain("#00aa00");
    expect(m.color).not.toContain("#ff0000");
    expect(m.lat.every((x: number) => x === 35.9)).toBe(true);
  });
  test("a photo's dab is its most saturated colour, the mean colour only as the fallback", async () => {
    const me = (srv.db().query("SELECT id FROM owner LIMIT 1").get() as any).id;
    const a = item(me, { color: "#808080", lat: 10, lon: 10 }), b = item(me, { color: "#404040", lat: 11, lon: 11 });
    srv.db().query("UPDATE item SET colors = ? WHERE id = ?").run(JSON.stringify(["#808080", "#e02020", "#707070"]), a.id);
    srv.db().query("UPDATE item SET colors = NULL WHERE id = ?").run(b.id);
    const m = await j(await srv.fetch("/api/map", { cookie }));
    expect(m.color[m.ids.indexOf(a.id)]).toBe("#e02020"); expect(m.color[m.ids.indexOf(b.id)]).toBe("#404040");
    srv.db().query("DELETE FROM item WHERE id IN (?, ?)").run(a.id, b.id);
  });
  test("a device token is refused", async () => {
    const dev = await pairDevice(srv, cookie);
    expect((await srv.fetch("/api/map", { token: dev.token })).status).toBe(403);
    expect((await srv.fetch("/api/map/items", { method: "POST", token: dev.token, json: { ids: [1] } })).status).toBe(403);
    expect((await srv.fetch("/api/map")).status).toBe(401);
  });
  test("/api/places carries position and up to four colours", async () => {
    const p = (await j(await srv.fetch("/api/places", { cookie }))).find((x: any) => x.name === "Valletta");
    expect(p.lat).toBeCloseTo(35.8989, 3); expect(p.lon).toBeCloseTo(14.5146, 3);
    expect(p.count).toBe(2);
    expect(p.colors.length).toBeGreaterThan(0); expect(p.colors.length).toBeLessThanOrEqual(4);
    expect(p.colors.every((c: string) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
  });
  test("/api/map/items returns summaries of shown own items, never another owner's", async () => {
    const m = await j(await srv.fetch("/api/map", { cookie }));
    const foreign = (srv.db().query("SELECT id FROM item WHERE owner_id = ?").get(Number(other)) as any).id;
    const r = await j(await srv.fetch("/api/map/items", { method: "POST", cookie, json: { ids: [...m.ids, foreign, "x"] } }));
    expect(r.map((x: any) => x.id)).toEqual(m.ids);
    expect(r[0]).toHaveProperty("color");
  });
});
