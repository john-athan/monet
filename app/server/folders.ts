// Folders: the one tree (the Ablage) that holds photos and files (docs/files.md). Scoped by owner_id; no HTTP in here.
import { db } from "./db";
import { COLS_DOC_SUMMARY, summary as docSummary } from "./docs";
import { SUM_COLS, summary as itemSummary } from "./library";
import { HttpError, now } from "./util";
import type { FolderOut, FolderSummary, MoveIn } from "../shared/types";

const CLASH = "Hier gibt es schon einen Ordner mit diesem Namen.";
const NOT_FOUND = "Den Ordner gibt es nicht.";
const LIVE_ITEM = "i.deleted_at IS NULL AND i.thumbs_ok = 1";

/** Trimmed, 1 to 120 characters, no slash. */
export function cleanName(v: unknown): string {
  const n = typeof v === "string" ? v.trim() : "";
  if (!n) throw new HttpError(400, "Der Ordnername fehlt.");
  if (n.length > 120) throw new HttpError(400, "Der Ordnername ist zu lang (höchstens 120 Zeichen).");
  if (n.includes("/")) throw new HttpError(400, "Der Ordnername darf keinen Schrägstrich enthalten.");
  return n;
}
const mine = (owner: number, id: number) => !!db.query("SELECT 1 FROM folder WHERE id = ? AND owner_id = ?").get(id, owner);
const need = (owner: number, id: number) => { if (!mine(owner, id)) throw new HttpError(404, NOT_FOUND); };
const clash = (owner: number, parent: number | null, name: string, except = 0) =>
  !!db.query("SELECT 1 FROM folder WHERE owner_id = ? AND coalesce(parent_id, 0) = ? AND name = ? AND id != ?").get(owner, parent ?? 0, name, except);

function summaryOf(r: { id: number; name: string }, owner: number): FolderSummary {
  const n = (db.query(`SELECT
      (SELECT count(*) FROM folder WHERE parent_id = ?1 AND owner_id = ?2)
      + (SELECT count(*) FROM doc WHERE folder_id = ?1 AND owner_id = ?2 AND deleted_at IS NULL)
      + (SELECT count(*) FROM item i WHERE folder_id = ?1 AND owner_id = ?2 AND ${LIVE_ITEM}) AS n`).get(r.id, owner) as { n: number }).n;
  // up to 4 covers: files first (newest), then photos, from the folder and everything below it, so a folder that only
  // holds folders is not painted empty
  const tree = `WITH RECURSIVE t(id) AS (SELECT ?1 UNION ALL SELECT f.id FROM folder f JOIN t ON f.parent_id = t.id) `;
  const docs = db.query(`${tree}SELECT id FROM doc WHERE folder_id IN (SELECT id FROM t) AND owner_id = ?2 AND deleted_at IS NULL AND state = 'ok' ORDER BY folder_id != ?1, modified_at DESC, id DESC LIMIT 4`).all(r.id, owner) as { id: number }[];
  const peek: FolderSummary["peek"] = docs.map(d => ({ doc: d.id }));
  if (peek.length < 4) for (const it of db.query(`${tree}SELECT i.id FROM item i WHERE i.folder_id IN (SELECT id FROM t) AND i.owner_id = ?2 AND ${LIVE_ITEM} ORDER BY i.folder_id != ?1, i.taken_at DESC LIMIT ?3`).all(r.id, owner, 4 - peek.length) as { id: number }[]) peek.push({ item: it.id });
  return { id: r.id, name: r.name, count: n, peek };
}

/** What lies in one folder of `owner` (0: the top). Photos are listed only inside a folder: at the top they belong to the feed. */
export function folderOut(owner: number, id: number): FolderOut {
  let name = "Ablage", path: { id: number; name: string }[] = [];
  if (id > 0) {
    const f = db.query("SELECT id, name FROM folder WHERE id = ? AND owner_id = ?").get(id, owner) as { id: number; name: string } | null;
    if (!f) throw new HttpError(404, NOT_FOUND);
    name = f.name;
    for (let at: number | null = id, k = 0; at != null && k < 64; k++) {
      const r = db.query("SELECT id, name, parent_id FROM folder WHERE id = ? AND owner_id = ?").get(at, owner) as { id: number; name: string; parent_id: number | null } | null;
      if (!r) break;
      path.unshift({ id: r.id, name: r.name }); at = r.parent_id;
    }
  }
  const parent = id > 0 ? id : null;
  const folders = (db.query("SELECT id, name FROM folder WHERE owner_id = ? AND coalesce(parent_id, 0) = ? ORDER BY name").all(owner, parent ?? 0) as { id: number; name: string }[])
    .sort((a, b) => a.name.localeCompare(b.name, "de")).map(f => summaryOf(f, owner));
  const docs = db.query(`SELECT ${COLS_DOC_SUMMARY} FROM doc d WHERE d.owner_id = ? AND coalesce(d.folder_id, 0) = ? AND d.deleted_at IS NULL ORDER BY d.modified_at DESC, d.id DESC`).all(owner, id) as any[];
  const items = id > 0 ? db.query(`SELECT ${SUM_COLS} FROM item i WHERE i.owner_id = ? AND i.folder_id = ? AND ${LIVE_ITEM} ORDER BY i.taken_at DESC, i.id DESC`).all(owner, id) as any[] : [];
  return { id: id > 0 ? id : null, name, path, folders, docs: docs.map(r => docSummary(r)), items: items.map(itemSummary) };
}

export function createFolder(owner: number, name: unknown, parentId: unknown): FolderSummary {
  const n = cleanName(name);
  const parent = parentId == null ? null : Number(parentId);
  if (parent != null && (!Number.isInteger(parent) || parent <= 0)) throw new HttpError(404, NOT_FOUND);
  if (parent != null) need(owner, parent);
  if (clash(owner, parent, n)) throw new HttpError(409, CLASH);
  const r = db.query("INSERT INTO folder (owner_id, parent_id, name, created_at) VALUES (?, ?, ?, ?) RETURNING id, name").get(owner, parent, n, now()) as { id: number; name: string };
  return { id: r.id, name: r.name, count: 0, peek: [] };
}

export function renameFolder(owner: number, id: number, name: unknown): FolderSummary {
  const f = db.query("SELECT id, name, parent_id FROM folder WHERE id = ? AND owner_id = ?").get(id, owner) as { id: number; name: string; parent_id: number | null } | null;
  if (!f) throw new HttpError(404, NOT_FOUND);
  if (name === undefined) return summaryOf(f, owner);
  const n = cleanName(name);
  if (clash(owner, f.parent_id, n, id)) throw new HttpError(409, CLASH);
  db.query("UPDATE folder SET name = ? WHERE id = ?").run(n, id);
  return summaryOf({ id, name: n }, owner);
}

/** Only an empty folder can go (files in the trash do not count: they leave the folder with it). */
export function deleteFolder(owner: number, id: number) {
  need(owner, id);
  if (summaryOf({ id, name: "" }, owner).count > 0) throw new HttpError(409, "Der Ordner ist nicht leer.");
  db.query("DELETE FROM folder WHERE id = ? AND owner_id = ?").run(id, owner);
}

const idList = (v: unknown): number[] => {
  const l = Array.isArray(v) ? v : [];
  if (l.length > 5000) throw new HttpError(400, "Zu viele Einträge auf einmal.");
  return [...new Set(l.map(Number))].filter(n => Number.isInteger(n) && n > 0);
};
/** Moves files, photos and folders of `owner` into a folder (null: the top). All or nothing. */
export function move(owner: number, b: MoveIn) {
  const into = b.into == null ? null : Number(b.into);
  if (into != null && (!Number.isInteger(into) || into <= 0)) throw new HttpError(404, NOT_FOUND);
  if (into != null) need(owner, into);
  const docs = idList(b.docs), items = idList(b.items), folders = idList(b.folders);
  const own = (table: string, l: number[]) => { for (const x of l) if (!db.query(`SELECT 1 FROM ${table} WHERE id = ? AND owner_id = ?`).get(x, owner)) throw new HttpError(404, "Das gibt es nicht (mehr)."); };
  own("doc", docs); own("item", items); own("folder", folders);
  if (folders.length && into != null) {
    // into itself or into something below it
    const moving = new Set(folders);
    for (let at: number | null = into, k = 0; at != null && k < 64; k++) {
      if (moving.has(at)) throw new HttpError(400, "Ein Ordner kann nicht in sich selbst liegen.");
      at = (db.query("SELECT parent_id FROM folder WHERE id = ?").get(at) as { parent_id: number | null } | null)?.parent_id ?? null;
    }
  }
  try {
    db.transaction(() => {
      for (const f of folders) {
        const r = db.query("SELECT name FROM folder WHERE id = ?").get(f) as { name: string };
        if (clash(owner, into, r.name, f)) throw new HttpError(409, CLASH);
        db.query("UPDATE folder SET parent_id = ? WHERE id = ?").run(into, f);
      }
      for (const x of docs) db.query("UPDATE doc SET folder_id = ? WHERE id = ?").run(into, x);
      for (const x of items) db.query("UPDATE item SET folder_id = ? WHERE id = ?").run(into, x);
    })();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (/UNIQUE/.test((e as Error).message)) throw new HttpError(409, CLASH); // two moved folders with one name
    throw e;
  }
}

/** The folder an upload belongs in: `path` ("Uni/Seminar") below `inId` (null: the top), the missing folders made on the way.
 *  Returns the id of the last one; null when there is no path and no folder, the top. */
export function ensurePath(owner: number, inId: number | null, path: string | null): number | null {
  if (inId != null) need(owner, inId);
  let at = inId;
  const parts = (path ?? "").split("/").map(p => p.trim().slice(0, 120)).filter(p => p && p !== "." && p !== "..").slice(0, 24);
  for (const name of parts) {
    const have = db.query("SELECT id FROM folder WHERE owner_id = ? AND coalesce(parent_id, 0) = ? AND name = ?").get(owner, at ?? 0, name) as { id: number } | null;
    at = have?.id ?? (db.query("INSERT INTO folder (owner_id, parent_id, name, created_at) VALUES (?, ?, ?, ?) RETURNING id").get(owner, at, name, now()) as { id: number }).id;
  }
  return at;
}
