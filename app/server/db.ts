// One SQLite file holds everything. Every row carries owner_id so a second person needs no schema change.
// Migrations are appended to MIGRATIONS and never edited: the index into the list is the schema version.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrateAccounts, tableExists } from "./accounts/schema";

export const DB_PATH = process.env.MONET_DB ?? "data/monet.db";
if (DB_PATH !== ":memory:") mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true, strict: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

const MIGRATIONS: string[] = [
  `CREATE TABLE owner (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
   CREATE TABLE credential (id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), public_key BLOB NOT NULL, alg INTEGER NOT NULL,
     sign_count INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER) STRICT;
   CREATE TABLE device (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('android','mac')),
     token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER) STRICT;
   CREATE TABLE session (hash TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), kind TEXT NOT NULL CHECK (kind IN ('browser','device')),
     device_id INTEGER REFERENCES device(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, user_agent TEXT) STRICT;
   CREATE TABLE pairing (code_hash TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), expires_at INTEGER NOT NULL, used_at INTEGER) STRICT;
   -- small key/value table: the one-time setup token written by "monet reset-passkeys" lives here (as a hash)
   CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;

   CREATE TABLE place (id INTEGER PRIMARY KEY, name TEXT NOT NULL, admin1 TEXT, country TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL) STRICT;
   CREATE TABLE item (
     id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), sha256 TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('photo','video')), mime TEXT NOT NULL, ext TEXT NOT NULL, bytes INTEGER NOT NULL, width INTEGER, height INTEGER,
     taken_at INTEGER NOT NULL, tz_min INTEGER, taken_src TEXT NOT NULL CHECK (taken_src IN ('exif','name','sidecar','mtime','upload')),
     -- derived from taken_at and tz_min (Europe/Berlin when unknown): the timeline groups and the band count on it
     day TEXT NOT NULL,
     lat REAL, lon REAL, place_id INTEGER REFERENCES place(id), camera TEXT, exposure TEXT, fnumber REAL, iso INTEGER, focal REAL, duration_ms INTEGER,
     orig_name TEXT, source TEXT NOT NULL, device_id INTEGER, uploaded_at INTEGER NOT NULL,
     color TEXT, colors TEXT, favorite INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER,
     burst_id INTEGER, burst_rank INTEGER, ocr_text TEXT,
     thumbs_ok INTEGER NOT NULL DEFAULT 0, clip_ok INTEGER NOT NULL DEFAULT 0, faces_ok INTEGER NOT NULL DEFAULT 0, ocr_ok INTEGER NOT NULL DEFAULT 0, labels_ok INTEGER NOT NULL DEFAULT 0,
     -- where the original lives, relative to MONET_ORIGINALS. Stored because a sidecar can change taken_at later.
     orig_path TEXT NOT NULL, second_copy_at INTEGER,
     UNIQUE (owner_id, sha256)) STRICT;
   CREATE INDEX item_taken ON item(owner_id, taken_at);
   CREATE INDEX item_day ON item(owner_id, day);
   CREATE INDEX item_sha ON item(sha256);
   CREATE INDEX item_place ON item(owner_id, place_id);
   CREATE INDEX item_burst ON item(burst_id) WHERE burst_id IS NOT NULL;
   CREATE INDEX item_pending ON item(owner_id) WHERE thumbs_ok = 0;
   CREATE INDEX item_deleted ON item(deleted_at) WHERE deleted_at IS NOT NULL;
   CREATE TABLE clip (item_id INTEGER PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE, model TEXT NOT NULL, vec BLOB NOT NULL) STRICT;
   CREATE TABLE person (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), name TEXT, cover_face_id INTEGER, hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL) STRICT;
   CREATE TABLE face (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
     landmarks TEXT, score REAL, quality REAL, vec BLOB NOT NULL, person_id INTEGER REFERENCES person(id) ON DELETE SET NULL) STRICT;
   CREATE INDEX face_person ON face(person_id);
   CREATE INDEX face_item ON face(item_id);
   CREATE TABLE label_vocab (model TEXT NOT NULL, label TEXT NOT NULL, lang TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (model, label, lang)) STRICT;
   CREATE TABLE item_label (item_id INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE, label TEXT NOT NULL, score REAL NOT NULL, PRIMARY KEY (item_id, label)) STRICT;
   CREATE TABLE album (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), name TEXT NOT NULL, cover_item_id INTEGER, created_at INTEGER NOT NULL) STRICT;
   CREATE TABLE album_item (album_id INTEGER NOT NULL REFERENCES album(id) ON DELETE CASCADE, item_id INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE, added_at INTEGER NOT NULL, PRIMARY KEY (album_id, item_id)) STRICT;
   -- rowid = item.id. Rebuilt for one item whenever ocr_text, labels, place, people or orig_name change (library.reindexFts)
   CREATE VIRTUAL TABLE item_fts USING fts5(ocr_text, labels, place, people, orig_name, tokenize='unicode61 remove_diacritics 2');`,
  // stacks of variations (server/stack.ts): a photo the owner took out of its stack never joins one again
  `ALTER TABLE item ADD COLUMN unstacked INTEGER NOT NULL DEFAULT 0;`,
  // the household (server/household.ts): everyone picks a style for their own library; a new person joins by an
  // invite link, which opens a passkey registration for an owner row made when the link was made
  `ALTER TABLE owner ADD COLUMN theme TEXT NOT NULL DEFAULT 'monet';
   CREATE TABLE invite (hash TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id) ON DELETE CASCADE, created_by INTEGER REFERENCES owner(id),
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER) STRICT;`,
  // videos recorded without a GPS fix were placed at 0°/0° (the photo path already dropped it): no place at all
  `UPDATE item SET lat = NULL, lon = NULL, place_id = NULL WHERE lat = 0 AND lon = 0;`,
  // files (docs/files.md): documents, sheets and slides beside the photos, and one tree of folders that holds both
  `CREATE TABLE folder (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), parent_id INTEGER REFERENCES folder(id),
     name TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
   CREATE UNIQUE INDEX folder_name ON folder(owner_id, coalesce(parent_id, 0), name);
   ALTER TABLE item ADD COLUMN folder_id INTEGER REFERENCES folder(id) ON DELETE SET NULL;
   CREATE INDEX item_folder ON item(folder_id) WHERE folder_id IS NOT NULL;
   CREATE TABLE doc (
     id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), sha256 TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('doc','sheet','slides')), format TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
     title TEXT NOT NULL, orig_name TEXT, folder_id INTEGER REFERENCES folder(id) ON DELETE SET NULL,
     pages INTEGER, width REAL NOT NULL DEFAULT 0, height REAL NOT NULL DEFAULT 0,
     modified_at INTEGER NOT NULL, uploaded_at INTEGER NOT NULL, source TEXT NOT NULL, device_id INTEGER, orig_path TEXT NOT NULL,
     state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ok','failed')), error TEXT, text TEXT,
     -- sheets: JSON [{name, rows, cols, truncated}]
     sheets TEXT, deleted_at INTEGER,
     UNIQUE (owner_id, sha256)) STRICT;
   CREATE INDEX doc_kind ON doc(owner_id, kind, modified_at);
   CREATE INDEX doc_folder ON doc(folder_id) WHERE folder_id IS NOT NULL;
   CREATE INDEX doc_pending ON doc(state) WHERE state = 'pending';
   -- rowid = doc.id
   CREATE VIRTUAL TABLE doc_fts USING fts5(title, text, tokenize='unicode61 remove_diacritics 2');`,
  // books, audio and every other file (docs/files.md): the kind check widens, so the table is built again. Nothing
  // references doc, and doc_fts keys on the id, which is copied. by_name: author of a book, artist of a track.
  // is_text: an 'other' file that reads as text. book: JSON {spine, toc} of an EPUB.
  `CREATE TABLE doc_new (
     id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES owner(id), sha256 TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('doc','sheet','slides','book','audio','other')), format TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
     title TEXT NOT NULL, orig_name TEXT, folder_id INTEGER REFERENCES folder(id) ON DELETE SET NULL,
     pages INTEGER, width REAL NOT NULL DEFAULT 0, height REAL NOT NULL DEFAULT 0,
     modified_at INTEGER NOT NULL, uploaded_at INTEGER NOT NULL, source TEXT NOT NULL, device_id INTEGER, orig_path TEXT NOT NULL,
     state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ok','failed')), error TEXT, text TEXT,
     sheets TEXT, deleted_at INTEGER,
     by_name TEXT, album TEXT, track INTEGER, duration_ms INTEGER, is_text INTEGER NOT NULL DEFAULT 0, book TEXT,
     UNIQUE (owner_id, sha256)) STRICT;
   INSERT INTO doc_new (id, owner_id, sha256, kind, format, mime, bytes, title, orig_name, folder_id, pages, width, height, modified_at, uploaded_at,
       source, device_id, orig_path, state, error, text, sheets, deleted_at)
     SELECT id, owner_id, sha256, kind, format, mime, bytes, title, orig_name, folder_id, pages, width, height, modified_at, uploaded_at,
       source, device_id, orig_path, state, error, text, sheets, deleted_at FROM doc;
   DROP TABLE doc;
   ALTER TABLE doc_new RENAME TO doc;
   CREATE INDEX doc_kind ON doc(owner_id, kind, modified_at);
   CREATE INDEX doc_folder ON doc(folder_id) WHERE folder_id IS NOT NULL;
   CREATE INDEX doc_pending ON doc(state) WHERE state = 'pending';`,
  // everything together (docs/together.md): a file's own date and day for the timeline, stacks of near-identical
  // files, vectors of pages and text pieces, transcripts of audio and video, labels and the people and places a file
  // names. doc_fts gains the labels and the transcript, so it is built again (server/together.ts refills it at start).
  `ALTER TABLE doc ADD COLUMN taken_at INTEGER;
   ALTER TABLE doc ADD COLUMN taken_src TEXT;
   ALTER TABLE doc ADD COLUMN day TEXT;
   ALTER TABLE doc ADD COLUMN stack_id INTEGER;
   ALTER TABLE doc ADD COLUMN stack_rank INTEGER;
   ALTER TABLE doc ADD COLUMN unstacked INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE doc ADD COLUMN vec_ok INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE doc ADD COLUMN speech_ok INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE item ADD COLUMN speech_ok INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX doc_day ON doc(owner_id, day);
   CREATE INDEX doc_stack ON doc(stack_id) WHERE stack_id IS NOT NULL;
   CREATE TABLE doc_vec (doc_id INTEGER NOT NULL REFERENCES doc(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('page','text')), model TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (doc_id, seq)) STRICT;
   CREATE TABLE transcript (ref TEXT NOT NULL CHECK (ref IN ('item','doc')), ref_id INTEGER NOT NULL, model TEXT NOT NULL, lang TEXT,
     segments TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (ref, ref_id)) STRICT;
   CREATE TABLE doc_label (doc_id INTEGER NOT NULL REFERENCES doc(id) ON DELETE CASCADE, label TEXT NOT NULL, score REAL NOT NULL, PRIMARY KEY (doc_id, label)) STRICT;
   CREATE TABLE doc_link (doc_id INTEGER NOT NULL REFERENCES doc(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('person','place')),
     ref_id INTEGER NOT NULL, PRIMARY KEY (doc_id, kind, ref_id)) STRICT;
   CREATE INDEX doc_link_ref ON doc_link(kind, ref_id);
   DROP TABLE doc_fts;
   CREATE VIRTUAL TABLE doc_fts USING fts5(title, text, labels, extra, tokenize='unicode61 remove_diacritics 2');`,
  // the text of a file's pages where it stands (server/doctext.ts): 0 not yet, 1 from the PDF, 2 from OCR, 3 none, 4 waiting for OCR
  `ALTER TABLE doc ADD COLUMN words_ok INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX doc_words ON doc(words_ok) WHERE words_ok IN (0, 4);`,
];

const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
for (let v = version; v < MIGRATIONS.length; v++) {
  db.transaction(() => { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); })();
}

// accounts (server/accounts, docs/accounts.md): passkeys, sessions, devices and links in the module's auth_* tables,
// roles on `owner`. A database from before the module still has Monet's own tables: their rows move over once, in
// one transaction, and the old tables go. A recovery token from `monet reset-passkeys` becomes a recovery link.
migrateAccounts(db, "owner");
if (tableExists(db, "credential")) db.transaction(() => {
  db.exec(`INSERT INTO auth_passkey (id, account_id, public_key, alg, sign_count, name, created_at, last_used_at)
      SELECT id, owner_id, public_key, alg, sign_count, name, created_at, last_used_at FROM credential;
    INSERT INTO auth_device (id, account_id, name, kind, token_hash, scopes, created_at, last_seen_at, revoked_at)
      SELECT id, owner_id, name, kind, token_hash, scopes, created_at, last_seen_at, revoked_at FROM device;
    INSERT INTO auth_session (hash, account_id, kind, device_id, created_at, expires_at, last_seen_at, user_agent)
      SELECT hash, owner_id, kind, device_id, created_at, expires_at, last_seen_at, user_agent FROM session;
    INSERT INTO auth_pairing (code_hash, account_id, expires_at, used_at) SELECT code_hash, owner_id, expires_at, used_at FROM pairing;
    INSERT INTO auth_link (hash, account_id, purpose, created_by, created_at, expires_at, used_at)
      SELECT hash, owner_id, 'join', created_by, created_at, expires_at, used_at FROM invite;
    INSERT OR IGNORE INTO auth_link (hash, account_id, purpose, created_at, expires_at)
      SELECT h.value, CAST(o.value AS INTEGER), 'recover', CAST(e.value AS INTEGER) - 3600000, CAST(e.value AS INTEGER)
      FROM meta h JOIN meta e ON e.key = 'reset_exp' JOIN meta o ON o.key = 'reset_owner' WHERE h.key = 'reset_hash';
    DELETE FROM meta WHERE key IN ('reset_hash', 'reset_exp', 'reset_owner');
    DROP TABLE session; DROP TABLE device; DROP TABLE pairing; DROP TABLE credential; DROP TABLE invite;`);
  // the first person was the only one who could do everything; they stay that way
  db.exec("UPDATE owner SET role = 'admin' WHERE id = (SELECT min(id) FROM owner) AND NOT EXISTS (SELECT 1 FROM owner WHERE role = 'admin')");
})();

export const metaGet =(k: string) => (db.query("SELECT value FROM meta WHERE key = ?").get(k) as { value: string } | null)?.value ?? null;
export const metaSet = (k: string, v: string) => db.query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
export const metaDel = (k: string) => db.query("DELETE FROM meta WHERE key = ?").run(k);
