// Dinge: /api/things lists the labels of the owner's shown photos with a count and a cover.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { pairDevice, seedSession, startServer, type Srv } from "./helpers";

let srv: Srv, cookie: string;
const j = async (r: Response) => r.json() as Promise<any>;
let n = 0;
function item(owner: number, o: { burst?: [number, number]; deleted?: boolean; thumbs?: number } = {}) {
  const k = ++n;
  return (srv.db().query(`INSERT INTO item (owner_id, sha256, kind, mime, ext, bytes, width, height, taken_at, taken_src, day, source, uploaded_at, color, burst_id, burst_rank, thumbs_ok, deleted_at, orig_path)
    VALUES (?, ?, 'photo', 'image/jpeg', 'jpg', 1, 100, 100, ?, 'exif', '2026-01-01', 'test', 1, '#336699', ?, ?, ?, ?, ?) RETURNING id`)
    .get(owner, "sha" + k, 1_700_000_000_000 + k, o.burst?.[0] ?? null, o.burst?.[1] ?? null, o.thumbs ?? 1, o.deleted ? 1 : null, "o/" + k) as { id: number }).id;
}
const label = (id: number, l: string, score: number) => srv.db().query("INSERT INTO item_label (item_id, label, score) VALUES (?, ?, ?)").run(id, l, score);
let a = 0, b = 0;

beforeAll(async () => {
  srv = await startServer(); cookie = await seedSession(srv);
  const db = srv.db();
  const me = (db.query("SELECT id FROM owner LIMIT 1").get() as any).id;
  const you = (db.query("INSERT INTO owner (name, created_at) VALUES ('Du', 1) RETURNING id").get() as any).id;
  a = item(me); b = item(me);
  label(a, "Hafen", 0.4); label(b, "Hafen", 0.8); label(a, "Kaffee", 0.6);
  const top = item(me, { burst: [9, 1] }), under = item(me, { burst: [9, 2] });   // a stack counts once
  label(top, "Höhle", 0.3); label(under, "Höhle", 0.9);
  label(item(me, { deleted: true }), "Kerzen", 0.9);                             // in the trash
  label(item(me, { thumbs: 0 }), "Kerzen", 0.9);                                 // not finished
  label(item(you), "Hund", 0.9); label(item(you), "Hafen", 0.9);                 // someone else's
});
afterAll(async () => { await srv.stop(); });

describe("things", () => {
  test("GET /api/things: labels of shown photos of this owner, most common first, cover is the best share", async () => {
    const t = await j(await srv.fetch("/api/things", { cookie }));
    expect(t.map((x: any) => x.label)).toEqual(["Hafen", "Höhle", "Kaffee"]);
    expect(t[0]).toEqual({ label: "Hafen", count: 2, item: b });
    expect(t[1].count).toBe(1);
    expect(t[2]).toEqual({ label: "Kaffee", count: 1, item: a });
  });
  test("a device token is refused, no session is 401", async () => {
    const dev = await pairDevice(srv, cookie);
    expect((await srv.fetch("/api/things", { token: dev.token })).status).toBe(403);
    expect((await srv.fetch("/api/things")).status).toBe(401);
  });
});
