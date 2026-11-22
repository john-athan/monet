// tools/import-drive.ts and POST /api/items/:id/supersede against a real server: only formats Monet can show are sent,
// photos below Pictures/<name> go into that album, other files into the Ablage under their Drive path, and an original
// takes the place of the smaller Takeout copy (album, favourite, place move over, the copy goes to the trash), while a
// different picture of the same name stays a picture of its own. Needs libvips (skipped otherwise).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, seedSession, startServer, type Srv } from "./helpers";

const haveVips = !!Bun.which("vips");
const suite = haveVips ? describe : describe.skip;
let srv: Srv, cookie: string, dir: string;

/** A noisy picture of w x h, saved at quality q: the same picture at a higher q is the bigger file. */
async function image(path: string, w: number, h: number, q: number, seed = 1) {
  const raw = path + ".v";
  await Bun.spawn(["vips", "gaussnoise", raw + ".v", String(w), String(h), "--seed", String(seed)]).exited;
  await Bun.spawn(["vips", "copy", raw + ".v", `${path}[Q=${q}]`]).exited;
  await Bun.spawn(["rm", raw + ".v"]).exited;
}
const shaOf = async (p: string) => new Bun.CryptoHasher("sha256").update(new Uint8Array(await Bun.file(p).arrayBuffer())).digest("hex");
async function seed(path: string, name: string) {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const r = await srv.fetch(`/api/upload/${await shaOf(path)}?offset=0&total=${bytes.length}&name=${name}&source=takeout`, { method: "PUT", cookie, body: bytes });
  return (await r.json() as any).item.id as number;
}
const run = async (...more: string[]) => {
  const p = Bun.spawn(["bun", join(ROOT, "tools/import-drive.ts"), join(dir, "My Drive"), "--origin", srv.origin, "--session", cookie, ...more], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text() + await new Response(p.stderr).text(); await p.exited;
  return { out, code: p.exitCode };
};
let copy = 0, other = 0;

beforeAll(async () => {
  if (!haveVips) return;
  srv = await startServer(); cookie = await seedSession(srv);
  dir = mkdtempSync(join(tmpdir(), "monet-drive-"));
  const pics = join(dir, "My Drive/Pictures/2019 Vietnam"), uni = join(dir, "My Drive/Uni/MA"), seeds = join(dir, "seeds");
  for (const d of [pics, uni, seeds]) mkdirSync(d, { recursive: true });
  // the Takeout copies: IMG_1 recompressed, IMG_2 a different picture (other shape) under the same name as a Drive file
  await image(join(seeds, "IMG_1.jpg"), 160, 120, 20); copy = await seed(join(seeds, "IMG_1.jpg"), "IMG_1.jpg");
  await image(join(seeds, "IMG_2.jpg"), 120, 120, 20, 7); other = await seed(join(seeds, "IMG_2.jpg"), "IMG_2.jpg");
  const db = srv.db();
  db.query("UPDATE item SET favorite = 1, lat = 21.0, lon = 105.8 WHERE id = ?").run(copy);
  const album = (db.query("INSERT INTO album (owner_id, name, cover_item_id, created_at) VALUES (1, 'Urlaub', ?, 1) RETURNING id").get(copy) as any).id;
  db.query("INSERT INTO album_item (album_id, item_id, added_at) VALUES (?, ?, 1)").run(album, copy);
  // the Drive
  await image(join(pics, "IMG_1.jpg"), 160, 120, 95);
  await image(join(pics, "IMG_2.jpg"), 160, 120, 95, 9);
  await image(join(pics, "new.jpg"), 80, 60, 90, 3);
  writeFileSync(join(pics, "readme.txt"), "a text among the pictures stays out\n");
  writeFileSync(join(uni, "notes.txt"), "Notizen zur Masterarbeit\n");
  writeFileSync(join(uni, "cert.p12"), new Uint8Array([0x30, 0x82, 1, 2, 0, 0, 0xff]));
  writeFileSync(join(dir, "My Drive/Ausgaben.gsheet"), '{"doc_id":"x"}');
  writeFileSync(join(uni, "._notes.txt"), new Uint8Array(64));
});
afterAll(() => haveVips && srv.stop());

suite("import-drive", () => {
  test("a dry run counts only what Monet can show and sends nothing", async () => {
    const { out, code } = await run("--dry-run");
    expect(code).toBe(0);
    expect(out).toContain("4 files Monet can show");
    expect(out).toContain("the server lacks 4 of them");
    expect((srv.db().query("SELECT count(*) AS n FROM item").get() as any).n).toBe(2);
  });
  test("a run replaces the copy, keeps the other picture, files photos into the album and the text into the Ablage", async () => {
    const { out, code } = await run();
    expect(out).toContain("done: 3 new, 1 replaced a smaller copy, 0 known, 0 failed");
    expect(code).toBe(0);
    const db = srv.db();
    const orig = db.query("SELECT id, favorite, lat, deleted_at FROM item WHERE orig_name = 'IMG_1.jpg' AND id != ?").get(copy) as any;
    expect(orig).toMatchObject({ favorite: 1, lat: 21.0, deleted_at: null });
    expect((db.query("SELECT deleted_at FROM item WHERE id = ?").get(copy) as any).deleted_at).not.toBeNull();
    expect((db.query("SELECT deleted_at FROM item WHERE id = ?").get(other) as any).deleted_at).toBeNull();
    const albums = db.query(`SELECT a.name, group_concat(i.orig_name, ',') AS names, a.cover_item_id AS cover FROM album a JOIN album_item ai ON ai.album_id = a.id
      JOIN item i ON i.id = ai.item_id GROUP BY a.id ORDER BY a.name`).all() as any[];
    expect(albums.map(a => [a.name, a.names.split(",").sort().join(",")])).toEqual([["2019 Vietnam", "IMG_1.jpg,IMG_2.jpg,new.jpg"], ["Urlaub", "IMG_1.jpg"]]);
    expect(albums.find(a => a.name === "Urlaub").cover).toBe(orig.id);
    const docs = db.query("SELECT d.orig_name, f.name AS folder, p.name AS parent FROM doc d JOIN folder f ON f.id = d.folder_id JOIN folder p ON p.id = f.parent_id").all();
    expect(docs).toEqual([{ orig_name: "notes.txt", folder: "MA", parent: "Uni" }]);
  });
  test("a file on the skip list is not sent", async () => {
    const pics = join(dir, "My Drive/Pictures/2019 Vietnam");
    await image(join(pics, "kept.jpg"), 80, 60, 90, 11);
    writeFileSync(join(dir, "skip.txt"), "Pictures/2019 Vietnam/kept.jpg\n");
    const { out, code } = await run("--skip", join(dir, "skip.txt"), "--dry-run");
    expect(code).toBe(0);
    expect(out).toContain("the server lacks 0 of them");
    Bun.spawnSync(["rm", join(pics, "kept.jpg")]);
  });
  test("a second run sends nothing and replaces nothing", async () => {
    const { out, code } = await run();
    expect(code).toBe(0);
    expect(out).toContain("the server lacks 0 of them");
    expect(out).toContain("done: 0 new, 0 replaced a smaller copy, 4 known, 0 failed");
  });
});
