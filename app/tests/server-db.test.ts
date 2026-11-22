// Burst grouping and face clustering against an in-memory database, calling the modules directly.
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MONET_DB = ":memory:";
process.env.MONET_DATA = mkdtempSync(join(tmpdir(), "monet-db-"));
const { db } = await import("../server/db");
const { updateBurst } = await import("../server/ingest");
const lib = await import("../server/library");
const ppl = await import("../server/people");
const { vecBlob, decodeVec } = await import("../server/util");

let n = 0;
function item(o: { camera?: string | null; at: number; bytes?: number; kind?: string }) {
  return (db.query(`INSERT INTO item (owner_id, sha256, kind, mime, ext, bytes, width, height, taken_at, taken_src, day, camera, source, uploaded_at, orig_path, thumbs_ok, color)
    VALUES (1, ?, ?, 'image/jpeg', 'jpg', ?, 10, 10, ?, 'exif', '2020-01-01', ?, 'web', 1, 'x', 1, '#808080') RETURNING id`)
    .get(`s${++n}`, o.kind ?? "photo", o.bytes ?? 100, o.at, o.camera === undefined ? "Cam" : o.camera) as { id: number }).id;
}
beforeAll(() => { db.query("INSERT OR IGNORE INTO owner (id, name, created_at) VALUES (1, 'T', 1)").run(); }); // the db module is shared between test files

describe("bursts", () => {
  const T = 1_600_000_000_000;
  test("items of one camera within 2 s share a burst; the biggest file is rank 1; the timeline shows one with a count", () => {
    const a = item({ at: T, bytes: 100 }), b = item({ at: T + 1500, bytes: 300 }), c = item({ at: T + 3000, bytes: 200 });
    for (const i of [a, b, c]) updateBurst(i);
    const rows = db.query("SELECT id, burst_id, burst_rank FROM item WHERE id IN (?, ?, ?) ORDER BY id").all(a, b, c) as any[];
    expect(new Set(rows.map(r => r.burst_id)).size).toBe(1); // c is 1.5 s after b: chained
    expect(rows.map(r => r.burst_rank)).toEqual([3, 1, 2]);
    const shown = lib.summariesByIds(1, [a, b, c]).filter(s => s.burst);
    expect(shown).toHaveLength(1); expect(shown[0]).toMatchObject({ id: b, burst: { count: 3 } });
  });
  test("another camera, a video, a missing camera or a 5 s gap is no burst", () => {
    const T2 = T + 100_000;
    const a = item({ at: T2 }), other = item({ at: T2 + 500, camera: "Other" }), none1 = item({ at: T2 + 800, camera: null }), none2 = item({ at: T2 + 900, camera: null }), far = item({ at: T2 + 5000 });
    for (const i of [a, other, none1, none2, far]) updateBurst(i);
    expect(db.query("SELECT count(*) AS n FROM item WHERE id IN (?,?,?,?,?) AND burst_id IS NOT NULL").get(a, other, none1, none2, far)).toEqual({ n: 0 });
  });
  test("an item that bridges two bursts merges them; deleting rank 1 promotes the next", () => {
    const T3 = T + 200_000;
    const a = item({ at: T3, bytes: 10 }), b = item({ at: T3 + 1900, bytes: 20 }), c = item({ at: T3 + 3800, bytes: 30 }), d = item({ at: T3 + 5700, bytes: 40 });
    for (const i of [a, b, c, d]) updateBurst(i);
    const ids = [a, b, c, d];
    expect(new Set((db.query(`SELECT burst_id FROM item WHERE id IN (${ids.join(",")})`).all() as any[]).map(r => r.burst_id)).size).toBe(1);
    expect((db.query("SELECT burst_rank FROM item WHERE id = ?").get(d) as any).burst_rank).toBe(1);
    lib.softDelete(1, d);
    expect((db.query("SELECT burst_rank FROM item WHERE id = ?").get(c) as any).burst_rank).toBe(1);
    expect(lib.summariesByIds(1, [c])[0].burst?.count).toBe(3);
  });
});

describe("face clustering", () => {
  // vectors on a circle in the plane of two axes; `plane` keeps each test's people apart from the others
  const vec = (deg: number, plane = 0) => { const v = new Float32Array(128); v[plane * 2] = Math.cos(deg * Math.PI / 180); v[plane * 2 + 1] = Math.sin(deg * Math.PI / 180); return Buffer.from(v.buffer).toString("base64"); };
  const face = (deg: number, plane = 0) => ({ x: 0.2, y: 0.2, w: 0.2, h: 0.2, landmarks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], score: 0.9, quality: 0.8, vec: vec(deg, plane) });
  const personOf = (itemId: number) => (db.query("SELECT person_id FROM face WHERE item_id = ?").get(itemId) as any).person_id as number;
  const add = (deg: number, plane = 0) => { const i = item({ at: ++n }); ppl.storeFaces(1, i, [face(deg, plane)]); return i; };
  beforeAll(() => ppl.loadCentroids());

  test("a face joins the person above 0.42 and starts a new one below it", () => {
    const i1 = add(0), i2 = add(30), i3 = add(100), i4 = add(45);
    expect(personOf(i2)).toBe(personOf(i1));
    expect(personOf(i3)).not.toBe(personOf(i1)); // 85 degrees from the centroid at 15: cos 0.09
    expect(personOf(i4)).toBe(personOf(i1));     // 30 degrees from the centroid at 15 (and 55 from the other group): joins the first
  });
  test("just under the threshold is a new person, just over joins (plane 1: 64 and 70 degrees from a single face)", () => {
    const base = add(0, 1), over = add(64, 1), under = add(-70, 1);
    expect(personOf(over)).toBe(personOf(base));   // cos 0.438
    // the group's centroid has moved to 32 degrees: -70 is 102 away
    expect(personOf(under)).not.toBe(personOf(base));
    const solo = add(0, 2), near = add(70, 2);     // cos 0.342
    expect(personOf(near)).not.toBe(personOf(solo));
  });
  test("two faces in one photo are never one person, even when they look alike", () => {
    const i = item({ at: ++n });
    ppl.storeFaces(1, i, [face(0, 9), face(1, 9)]);
    const ps = (db.query("SELECT person_id FROM face WHERE item_id = ? ORDER BY id").all(i) as any[]).map(r => r.person_id);
    expect(ps[0]).not.toBe(ps[1]);
  });
  test("an unsure face joins a person it clearly resembles, but never starts one", () => {
    const sure = add(0, 11);
    const weak = (deg: number, plane: number) => { const i = item({ at: ++n }); ppl.storeFaces(1, i, [{ ...face(deg, plane), score: 0.7 }]); return i; };
    expect(personOf(weak(40, 11))).toBe(personOf(sure));  // cos 0.77
    expect(personOf(weak(0, 12))).toBeNull();             // nobody there: no new person
    const lone = add(0, 13);
    expect(personOf(weak(62, 13))).toBeNull();            // cos 0.47: enough for a sure face, not for an unsure one
    expect(personOf(lone)).not.toBeNull();
  });
  test("releaseWeak empties groups without a name of unsure faces that do not resemble them; named people stay", () => {
    const put = (deg: number, plane: number, score: number, person: number) => {
      const i = item({ at: ++n });
      db.query("INSERT INTO face (item_id, x, y, w, h, score, quality, vec, person_id) VALUES (?, .2, .2, .2, .2, ?, .8, ?, ?)").run(i, score, vecBlob(decodeVec(face(deg, plane).vec, 128)!), person);
      return (db.query("SELECT id FROM face WHERE item_id = ?").get(i) as any).id as number;
    };
    const mk = (name: string | null) => (db.query("INSERT INTO person (owner_id, name, created_at) VALUES (1, ?, 0) RETURNING id").get(name) as any).id as number;
    const junk = mk(null), mixed = mk(null), named = mk("Vroni");
    const j1 = put(0, 14, 0.65, junk); put(5, 14, 0.7, junk);
    put(0, 15, 0.95, mixed); const close = put(30, 15, 0.7, mixed), far = put(80, 15, 0.7, mixed);
    const keep = put(80, 16, 0.6, named); put(0, 16, 0.95, named);
    expect(ppl.releaseWeak()).toBe(3);
    expect(db.query("SELECT count(*) AS n FROM person WHERE id = ?").get(junk)).toEqual({ n: 0 });
    expect(db.query("SELECT person_id FROM face WHERE id = ?").get(j1)).toEqual({ person_id: null });
    expect(db.query("SELECT person_id FROM face WHERE id = ?").get(close)).toEqual({ person_id: mixed });
    expect(db.query("SELECT person_id FROM face WHERE id = ?").get(far)).toEqual({ person_id: null });
    expect(db.query("SELECT person_id FROM face WHERE id = ?").get(keep)).toEqual({ person_id: named });
    expect(ppl.releaseWeak()).toBe(0);
    db.query("UPDATE face SET person_id = NULL WHERE person_id IN (?, ?)").run(mixed, named); // the next tests expect no named person
    db.query("DELETE FROM person WHERE id IN (?, ?)").run(mixed, named);
    ppl.loadCentroids();
  });
  test("a face below the quality floor is stored but not grouped", () => {
    const i = item({ at: ++n });
    expect(ppl.storeFaces(1, i, [{ ...face(0, 10), quality: 0.3 }])).toBe(0);
    expect(db.query("SELECT person_id FROM face WHERE item_id = ?").get(i)).toEqual({ person_id: null });
  });
  test("storing the faces of an item twice changes nothing", () => {
    const i = item({ at: ++n });
    expect(ppl.storeFaces(1, i, [face(0, 3)])).toBe(1);
    expect(ppl.storeFaces(1, i, [face(0, 3), face(50, 3)])).toBe(0);
    expect(db.query("SELECT count(*) AS n FROM face WHERE item_id = ?").get(i)).toEqual({ n: 1 });
  });
  test("people: unnamed groups need two faces; naming moves a person to the named list", () => {
    const a = personOf(add(0, 4)); add(2, 4); add(300, 5); // one stray face elsewhere
    const out = ppl.people(1);
    expect(out.named).toEqual([]);
    expect(out.unnamed.every(u => u.count >= 2)).toBe(true);
    expect(out.unnamed.find(u => u.id === a)!.faces.length).toBe(2);
    ppl.editPerson(1, a, { name: "Oma" });
    const after = ppl.people(1);
    expect(after.named).toEqual([{ id: a, name: "Oma", count: 2, face: expect.any(Number) }]);
    expect(after.unnamed.some(u => u.id === a)).toBe(false);
  });
  test("a suggestion appears for an unnamed group between 0.30 and 0.42 of a named person, not for a farther one", () => {
    const named = personOf(add(0, 6)); add(1, 6); ppl.editPerson(1, named, { name: "Opa" });
    const close = personOf(add(70.5, 6)); add(71, 6);   // cos about 0.34 to the centroid of Opa
    const far = personOf(add(0, 8)); add(1, 8);          // another plane: cos 0
    expect(close).not.toBe(named); expect(far).not.toBe(named);
    const s = ppl.people(1).suggestions;
    expect(s.find(g => g.unnamed === close)).toEqual({ named, unnamed: close, count: 2 });
    expect(s.find(g => g.unnamed === far)).toBeUndefined();
  });
  test("merge moves faces and keeps the name; moving a face out leaves it without a person; hidden people drop out of the list", () => {
    const x = personOf(add(0, 7)); add(1, 7);
    const y = personOf(add(120, 7)); add(121, 7);
    expect(x).not.toBe(y);
    ppl.editPerson(1, y, { name: "Gerda" });
    ppl.mergePeople(1, y, x); // y has the name, x has none: the name survives
    expect(db.query("SELECT name FROM person WHERE id = ?").get(x)).toEqual({ name: "Gerda" });
    expect(db.query("SELECT count(*) AS n FROM person WHERE id = ?").get(y)).toEqual({ n: 0 });
    expect(db.query("SELECT count(*) AS n FROM face WHERE person_id = ?").get(x)).toEqual({ n: 4 });
    const f = (db.query("SELECT id FROM face WHERE person_id = ? LIMIT 1").get(x) as any).id;
    ppl.moveFace(1, f, null);
    expect(db.query("SELECT person_id FROM face WHERE id = ?").get(f)).toEqual({ person_id: null });
    ppl.editPerson(1, x, { hidden: true });
    expect(ppl.people(1).named.some(p => p.id === x)).toBe(false);
  });
});
