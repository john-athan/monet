// Faces and the people they belong to. Faces arrive from an indexer (POST /api/index/:id); each one joins the person
// whose centroid it matches best, or starts a new unnamed person. Centroids live in memory, rebuilt from the faces at boot.
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db";
import { addTo, bestMatch, centroid, cosine, MIN_QUALITY, removeFrom, SUGGEST, WEAK, WEAK_JOIN, type Group } from "./cluster";
import { reindexFts } from "./fts";
import { DATA, thumbPath } from "./ingest";
import { blobVec, decodeVec, dot, HttpError, now, run, runText, vecBlob } from "./util";
import type { IndexFace, PeopleOut } from "../shared/types";

type PG = Group & { owner: number };
const groups = new Map<number, PG>();

/** The rule of WEAK applied to the groups without a name that formed before it: an unsure face stays only if it clearly
 *  resembles the sure faces of its group, and a group with no sure face at all dissolves. Named people are left alone,
 *  the owner has looked at them. Idempotent, so it runs at every boot before the centroids are built. */
export function releaseWeak(): number {
  const rows = db.query(`SELECT f.id, f.vec, f.score, f.person_id FROM face f JOIN person p ON p.id = f.person_id WHERE p.name IS NULL`).all() as { id: number; vec: Uint8Array; score: number; person_id: number }[];
  const by = new Map<number, typeof rows>();
  for (const r of rows) (by.get(r.person_id) ?? by.set(r.person_id, []).get(r.person_id)!).push(r);
  const out: number[] = [], gone: number[] = [];
  for (const [pid, list] of by) {
    const sure = list.filter(r => r.score >= WEAK);
    if (!sure.length) { out.push(...list.map(r => r.id)); gone.push(pid); continue; }
    const g: Group = { id: pid, sum: new Float32Array(128), n: 0 };
    for (const r of sure) addTo(g, blobVec(r.vec));
    const c = centroid(g);
    for (const r of list) if (r.score < WEAK && cosine(blobVec(r.vec), c) < WEAK_JOIN) out.push(r.id);
  }
  if (!out.length) return 0;
  db.transaction(() => {
    const free = db.query("UPDATE face SET person_id = NULL WHERE id = ?"), cover = db.query("UPDATE person SET cover_face_id = NULL WHERE cover_face_id = ?");
    for (const id of out) { free.run(id); cover.run(id); }
    const del = db.query("DELETE FROM person WHERE id = ?");
    for (const pid of gone) del.run(pid);
  })();
  return out.length;
}

export function loadCentroids() {
  groups.clear();
  const rows = db.query(`SELECT f.vec, f.person_id, p.owner_id FROM face f JOIN person p ON p.id = f.person_id`).all() as { vec: Uint8Array; person_id: number; owner_id: number }[];
  for (const r of rows) {
    const g = groups.get(r.person_id) ?? groups.set(r.person_id, { id: r.person_id, owner: r.owner_id, sum: new Float32Array(128), n: 0 }).get(r.person_id)!;
    addTo(g, blobVec(r.vec));
  }
}
const groupOf = (person: number, owner: number) => groups.get(person) ?? groups.set(person, { id: person, owner, sum: new Float32Array(128), n: 0 }).get(person)!;

/** Stores the faces of one item and assigns them. Idempotent: an item whose faces were stored is left alone. */
export function storeFaces(owner: number, itemId: number, faces: IndexFace[]): number {
  if ((db.query("SELECT faces_ok FROM item WHERE id = ?").get(itemId) as any)?.faces_ok) return 0;
  let n = 0;
  // two faces in one photo are two people: a person already in this photo is never a candidate again
  const inPhoto = new Set<number>();
  db.transaction(() => {
    for (const f of faces.slice(0, 50)) {
      const vec = decodeVec(f.vec, 128);
      const ok = [f.x, f.y, f.w, f.h].every(v => Number.isFinite(v) && v >= -0.01 && v <= 1.01) && f.w > 0 && f.h > 0;
      if (!vec || !ok) continue;
      const lm = Array.isArray(f.landmarks) && f.landmarks.length === 10 && f.landmarks.every(Number.isFinite) ? JSON.stringify(f.landmarks) : null;
      const row = db.query("INSERT INTO face (item_id, x, y, w, h, landmarks, score, quality, vec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
        .get(itemId, f.x, f.y, f.w, f.h, lm, Number(f.score) || 0, Number(f.quality) || 0, vecBlob(vec)) as { id: number };
      if ((Number(f.quality) || 0) < MIN_QUALITY) continue; // stored, not grouped
      const weak = (Number(f.score) || 0) < WEAK;
      const m = bestMatch(vec, [...groups.values()].filter(g => g.owner === owner), weak ? WEAK_JOIN : undefined, inPhoto);
      let pid = m?.id;
      if (pid == null && weak) continue; // an unsure face joins someone, it never starts someone
      if (pid == null) {
        pid = (db.query("INSERT INTO person (owner_id, cover_face_id, created_at) VALUES (?, ?, ?) RETURNING id").get(owner, row.id, now()) as { id: number }).id;
      }
      addTo(groupOf(pid, owner), vec);
      inPhoto.add(pid);
      db.query("UPDATE face SET person_id = ? WHERE id = ?").run(pid, row.id);
      n++;
    }
    db.query("UPDATE item SET faces_ok = 1 WHERE id = ?").run(itemId);
  })();
  reindexFts(itemId);
  return n;
}

function owned(owner: number, id: number) {
  const p = db.query("SELECT * FROM person WHERE id = ? AND owner_id = ?").get(id, owner) as any;
  if (!p) throw new HttpError(404, "Die Person gibt es nicht.");
  return p;
}
const reindexPerson = (person: number) => { for (const r of db.query("SELECT DISTINCT item_id FROM face WHERE person_id = ?").all(person) as { item_id: number }[]) reindexFts(r.item_id); };

export function editPerson(owner: number, id: number, b: { name?: unknown; hidden?: unknown }) {
  owned(owner, id);
  if ("name" in b) {
    const n = b.name == null ? null : String(b.name).trim().slice(0, 80) || null;
    db.query("UPDATE person SET name = ? WHERE id = ?").run(n, id);
    reindexPerson(id);
  }
  if ("hidden" in b) db.query("UPDATE person SET hidden = ? WHERE id = ?").run(b.hidden ? 1 : 0, id);
}

/** All faces of `from` move to `into`. A name is kept: if only `from` has one, `into` takes it. */
export function mergePeople(owner: number, from: number, into: number) {
  if (from === into) throw new HttpError(400, "Das ist dieselbe Person.");
  const a = owned(owner, from), b = owned(owner, into);
  const ids = (db.query("SELECT DISTINCT item_id FROM face WHERE person_id = ?").all(from) as { item_id: number }[]).map(r => r.item_id);
  db.transaction(() => {
    db.query("UPDATE face SET person_id = ? WHERE person_id = ?").run(into, from);
    if (!b.name && a.name) db.query("UPDATE person SET name = ? WHERE id = ?").run(a.name, into);
    if (b.hidden && !a.hidden) db.query("UPDATE person SET hidden = 0 WHERE id = ?").run(into);
    db.query("DELETE FROM person WHERE id = ?").run(from);
  })();
  const gf = groups.get(from), gi = groupOf(into, owner);
  if (gf) { for (let i = 0; i < 128; i++) gi.sum[i] += gf.sum[i]; gi.n += gf.n; groups.delete(from); }
  for (const i of ids) reindexFts(i);
}

/** Moves one face to another person, or (null) takes it out of any person: "this is not them". */
export function moveFace(owner: number, faceId: number, personId: number | null) {
  const f = db.query("SELECT f.id, f.vec, f.person_id, f.item_id FROM face f JOIN item i ON i.id = f.item_id WHERE f.id = ? AND i.owner_id = ?").get(faceId, owner) as any;
  if (!f) throw new HttpError(404, "Das Gesicht gibt es nicht.");
  if (personId != null) owned(owner, personId);
  const vec = blobVec(f.vec);
  db.transaction(() => {
    if (f.person_id != null) {
      const g = groups.get(f.person_id);
      if (g) removeFrom(g, vec);
      if (g && g.n <= 0) {
        // an emptied person disappears, unless it carries a name the owner chose
        const p = db.query("SELECT name FROM person WHERE id = ?").get(f.person_id) as any;
        if (!p?.name) { db.query("DELETE FROM person WHERE id = ?").run(f.person_id); groups.delete(f.person_id); }
      }
    }
    db.query("UPDATE face SET person_id = ? WHERE id = ?").run(personId, faceId);
    if (personId != null) addTo(groupOf(personId, owner), vec);
    // a cover that left its person is replaced by the person's best face
    db.query("UPDATE person SET cover_face_id = NULL WHERE cover_face_id = ? AND id != coalesce(?, -1)").run(faceId, personId);
  })();
  reindexFts(f.item_id);
}

/* ---------- read model ---------- */
const MIN_UNNAMED = 2; // one stray face in the background is not a person worth asking about

export function people(owner: number): PeopleOut {
  const rows = db.query(`SELECT f.id, f.person_id, f.quality, f.w * f.h AS area, i.day, i.taken_at, pl.name AS place, p.name, p.cover_face_id
    FROM face f JOIN person p ON p.id = f.person_id JOIN item i ON i.id = f.item_id LEFT JOIN place pl ON pl.id = i.place_id
    WHERE p.owner_id = ? AND p.hidden = 0 AND i.deleted_at IS NULL`).all(owner) as any[];
  const by = new Map<number, any[]>();
  for (const r of rows) (by.get(r.person_id) ?? by.set(r.person_id, []).get(r.person_id)!).push(r);
  const best = (list: any[]) => [...list].sort((a, b) => (b.quality * b.area) - (a.quality * a.area) || a.id - b.id);
  const named: PeopleOut["named"] = [], unnamed: PeopleOut["unnamed"] = [];
  for (const [id, list] of by) {
    const name = list[0].name as string | null;
    if (name) {
      const cover = list.find(r => r.id === list[0].cover_face_id)?.id ?? best(list)[0].id;
      named.push({ id, name, count: list.length, face: cover });
    } else if (list.length >= MIN_UNNAMED) {
      const last = [...list].sort((a, b) => b.taken_at - a.taken_at)[0];
      unnamed.push({ id, count: list.length, faces: best(list).slice(0, 6).map(r => r.id), last: { date: last.day, place: last.place } });
    }
  }
  named.sort((a, b) => a.name.localeCompare(b.name, "de"));
  unnamed.sort((a, b) => b.count - a.count || a.id - b.id);
  const suggestions: PeopleOut["suggestions"] = [];
  for (const u of unnamed) {
    const gu = groups.get(u.id);
    if (!gu) continue;
    const cu = centroid(gu);
    let top: { id: number; c: number } | null = null;
    for (const n of named) { const gn = groups.get(n.id); if (!gn) continue; const c = dot(cu, centroid(gn)); if (c >= SUGGEST && (!top || c > top.c)) top = { id: n.id, c }; }
    if (top) suggestions.push({ named: top.id, unnamed: u.id, count: u.count });
  }
  suggestions.sort((a, b) => b.count - a.count);
  return { named, unnamed, suggestions };
}

/* ---------- face crops ---------- */
const crops = new Map<number, Promise<string>>();
/** A 256 px square around the face with a margin, cut from the l thumbnail and cached on disk. Returns the file path. */
export function faceCrop(owner: number, faceId: number): Promise<string> {
  const out = join(DATA, "faces", `${faceId}.webp`);
  if (existsSync(out)) return Promise.resolve(out);
  const f = db.query("SELECT f.x, f.y, f.w, f.h, i.sha256 FROM face f JOIN item i ON i.id = f.item_id WHERE f.id = ? AND i.owner_id = ?").get(faceId, owner) as any;
  if (!f) return Promise.reject(new HttpError(404, "Das gibt es nicht (mehr)."));
  const pending = crops.get(faceId);
  if (pending) return pending;
  const job = (async () => {
    const src = thumbPath(f.sha256, "l");
    const W = +(await runText(["vipsheader", "-f", "width", src], 10_000)), H = +(await runText(["vipsheader", "-f", "height", src], 10_000));
    const cx = (f.x + f.w / 2) * W, cy = (f.y + f.h / 2) * H;
    // a square 1.9 times the face, so hair and shoulders show; never larger than the picture
    const side = Math.max(16, Math.min(Math.min(W, H), Math.max(f.w * W, f.h * H) * 1.9));
    const x = Math.round(Math.max(0, Math.min(W - side, cx - side / 2))), y = Math.round(Math.max(0, Math.min(H - side, cy - side / 2)));
    mkdirSync(join(DATA, "faces"), { recursive: true });
    const tmpCrop = join(DATA, "faces", `${faceId}.crop.png`), tmp = join(DATA, "faces", `${faceId}.part.webp`);
    await run(["vips", "crop", src, tmpCrop + "[compression=1]", String(x), String(y), String(Math.round(side)), String(Math.round(side))], 30_000, { VIPS_CONCURRENCY: "1" });
    await run(["vipsthumbnail", tmpCrop, "-s", "256x256", "-o", `${tmp}[Q=82,strip]`], 30_000, { VIPS_CONCURRENCY: "1" });
    rmSync(tmpCrop, { force: true });
    renameSync(tmp, out);
    return out;
  })().finally(() => crops.delete(faceId));
  crops.set(faceId, job);
  return job;
}
