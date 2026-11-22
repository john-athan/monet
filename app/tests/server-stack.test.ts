// Stacks of variations: similar takes of one shot, joined once their image vectors arrive.
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MONET_DB = ":memory:";
process.env.MONET_DATA = mkdtempSync(join(tmpdir(), "monet-stack-"));
const { db } = await import("../server/db");
const { updateBurst } = await import("../server/ingest");
const stack = await import("../server/stack");
const { CLIP_MODEL, DIM, requeueOtherModels } = await import("../server/search");

let n = 0;
const T = 1_700_000_000_000;
function item(at: number, camera: string | null = "Flip6", bytes = 100) {
  return (db.query(`INSERT INTO item (owner_id, sha256, kind, mime, ext, bytes, width, height, taken_at, taken_src, day, camera, source, uploaded_at, orig_path, thumbs_ok, color)
    VALUES (1, ?, 'photo', 'image/jpeg', 'jpg', ?, 10, 10, ?, 'exif', '2026-11-04', ?, 'web', 1, 'x', 1, '#808080') RETURNING id`)
    .get(`k${++n}`, bytes, at, camera) as { id: number }).id;
}
/** A unit vector at `deg` degrees in plane `p`: the cosine between two of them is cos(difference). */
function vec(deg: number, p = 0) { const v = new Float32Array(DIM); v[2 * p] = Math.cos(deg * Math.PI / 180); v[2 * p + 1] = Math.sin(deg * Math.PI / 180); return v; }
function clip(id: number, v: Float32Array) {
  db.query("INSERT INTO clip (item_id, model, vec) VALUES (?, ?, ?)").run(id, CLIP_MODEL, new Uint8Array(v.buffer));
  return stack.stackSimilar(id);
}
const stackOf = (id: number) => (db.query("SELECT burst_id FROM item WHERE id = ?").get(id) as { burst_id: number | null }).burst_id;
beforeAll(() => { db.query("INSERT OR IGNORE INTO owner (id, name, created_at) VALUES (1, 'T', 1)").run(); }); // the db module is shared between test files

describe("variations", () => {
  test("two takes 5 s apart at cosine 0.92 become one stack; the bigger file is shown", () => {
    const a = item(T, "Flip6", 100), b = item(T + 5000, "Flip6", 300);
    clip(a, vec(0, 1)); clip(b, vec(23, 1));          // cos 23 deg = 0.92
    expect(stackOf(a)).not.toBeNull();
    expect(stackOf(a)).toBe(stackOf(b));
    expect((db.query("SELECT burst_rank FROM item WHERE id = ?").get(b) as any).burst_rank).toBe(1);
  });
  test("the car pair stays apart: 0.877 is below the line", () => {
    const a = item(T + 100_000), b = item(T + 105_000);
    clip(a, vec(0, 2)); clip(b, vec(28.7, 2));        // cos 28.7 deg = 0.877
    expect(stackOf(a)).toBeNull(); expect(stackOf(b)).toBeNull();
  });
  test("alike but 2 minutes apart, another camera, or no camera at all: no stack", () => {
    const a = item(T + 200_000), late = item(T + 320_000);
    const other = item(T + 200_004, "Pixel");
    const w1 = item(T + 400_000, null), w2 = item(T + 400_003, null);
    for (const [i, d] of [[a, 0], [late, 1], [other, 2], [w1, 0], [w2, 1]] as const) clip(i, vec(d, 3));
    for (const i of [a, late, other, w1, w2]) expect(stackOf(i)).toBeNull();
  });
  test("a chain of takes 20 s apart joins one stack, and an existing burst is merged in", () => {
    const b1 = item(T + 500_000), b2 = item(T + 501_000);   // a 2 s burst from upload time
    updateBurst(b1); updateBurst(b2);
    const c = item(T + 520_000), d = item(T + 540_000);
    clip(b1, vec(0, 4)); clip(b2, vec(1, 4)); clip(c, vec(10, 4)); clip(d, vec(20, 4));
    expect(new Set([b1, b2, c, d].map(stackOf)).size).toBe(1);
    expect(stack.stackSimilar(d)).toBe(false);              // running again changes nothing
  });
  test("taking a photo out keeps it out; a stack of one dissolves", () => {
    const a = item(T + 700_000), b = item(T + 703_000), c = item(T + 706_000);
    clip(a, vec(0, 5)); clip(b, vec(5, 5)); clip(c, vec(10, 5));
    expect(new Set([a, b, c].map(stackOf)).size).toBe(1);
    expect(stack.unstack(1, a)).toBe(true);
    expect(stackOf(a)).toBeNull();
    expect(stackOf(b)).toBe(stackOf(c)); expect(stackOf(b)).not.toBeNull();
    expect(stack.stackSimilar(a)).toBe(false);              // the vectors still match, the owner's word wins
    expect(stackOf(a)).toBeNull();
    stack.unstack(1, b);
    expect(stackOf(c)).toBeNull();                          // one photo left: no stack any more
  });
  test("another owner cannot take a photo out of a stack", () => {
    const a = item(T + 800_000);
    expect(stack.unstack(2, a)).toBe(false);
  });
  test("restackAll runs once per rule", () => {
    const a = item(T + 900_000), b = item(T + 904_000);
    for (const [i, d] of [[a, 0], [b, 8]] as const) db.query("INSERT INTO clip (item_id, model, vec) VALUES (?, ?, ?)").run(i, CLIP_MODEL, new Uint8Array(vec(d, 6).buffer));
    expect(stack.restackAll()).toBeGreaterThan(0);
    expect(stackOf(a)).toBe(stackOf(b));
    expect(stack.restackAll()).toBe(0);
  });
});

describe("a new image model", () => {
  test("vectors of an older model are not compared, and their items are analysed again", () => {
    const old = item(T + 1_000_000), fresh = item(T + 1_003_000);
    // the old model's 512 floats, identical direction: would stack if it were read
    db.query("UPDATE item SET clip_ok = 1 WHERE id = ?").run(old);
    db.query("INSERT INTO clip (item_id, model, vec) VALUES (?, 'clip-vit-b32', ?)").run(old, new Uint8Array(new Float32Array(512).fill(0.04).buffer));
    expect(clip(fresh, vec(0, 7))).toBe(false);
    expect(stackOf(fresh)).toBeNull();
    expect(requeueOtherModels()).toBeGreaterThanOrEqual(1);
    expect((db.query("SELECT clip_ok FROM item WHERE id = ?").get(old) as { clip_ok: number }).clip_ok).toBe(0);
    expect(requeueOtherModels()).toBe(0);
  });
});
