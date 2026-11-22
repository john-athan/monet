// /api/status and /api/export/list: counts for the Geräte page and the Mac's second copy.
import { db } from "./db";
import { counts } from "./docs";
import { docVecStats } from "./docvec";
import { SPEECH_MAX_MS } from "./together";
import { now } from "./util";
import type { ExportRow, Status, Theme } from "../shared/types";

export function status(owner: number): Status {
  const c = (sql: string) => (db.query(sql).get(owner) as { n: number }).n;
  const live = "owner_id = ? AND deleted_at IS NULL";
  const total = c(`SELECT count(*) AS n FROM item WHERE ${live}`);
  const photos = c(`SELECT count(*) AS n FROM item WHERE ${live} AND kind = 'photo'`);
  const done = (col: string) => c(`SELECT count(*) AS n FROM item WHERE ${live} AND ${col} = 1`);
  return {
    items: total - c(`SELECT count(*) AS n FROM item WHERE ${live} AND kind = 'video'`),
    videos: c(`SELECT count(*) AS n FROM item WHERE ${live} AND kind = 'video'`),
    bytes: c(`SELECT coalesce(sum(bytes), 0) AS n FROM item WHERE ${live}`),
    stages: {
      thumbs: { done: done("thumbs_ok"), total },
      clip: { done: done("clip_ok"), total },
      faces: { done: done("faces_ok"), total },
      // OCR makes no sense for a video frame: only photos are asked for it
      ocr: { done: c(`SELECT count(*) AS n FROM item WHERE ${live} AND kind = 'photo' AND ocr_ok = 1`), total: photos },
      labels: { done: done("labels_ok"), total },
    },
    // files and speech (docs/together.md): vectors of files from the darkroom, transcripts from the Mac
    files: docVecStats(owner),
    speech: db.query(`SELECT coalesce(sum(speech_ok != 0), 0) AS done, count(*) AS total FROM (
      SELECT speech_ok FROM item WHERE ${live} AND kind = 'video' AND thumbs_ok = 1 AND coalesce(duration_ms, 0) <= ?
      UNION ALL SELECT speech_ok FROM doc WHERE ${live} AND kind = 'audio' AND state = 'ok' AND album IS NULL AND coalesce(duration_ms, 0) <= ?)`).get(owner, SPEECH_MAX_MS, owner, SPEECH_MAX_MS) as { done: number; total: number },
    devices: c("SELECT count(*) AS n FROM auth_device WHERE account_id = ? AND revoked_at IS NULL"),
    secondCopy: (db.query("SELECT count(second_copy_at) AS n, max(second_copy_at) AS last FROM item WHERE owner_id = ?").get(owner) as { n: number; last: number | null }),
    lastUpload: (db.query("SELECT max(uploaded_at) AS m FROM item WHERE owner_id = ?").get(owner) as { m: number | null }).m,
    docs: counts(owner),
    theme: ((db.query("SELECT theme FROM owner WHERE id = ?").get(owner) as { theme: Theme } | null)?.theme) ?? "monet",
  };
}

/** Originals for the Mac's second copy, in id order. `after` is the last id the Mac has seen. Deleted items are
 *  included: the copy is a backup, and a soft delete is not the end of an original. */
export function exportList(owner: number, after: number, limit = 500): ExportRow[] {
  return (db.query("SELECT id, sha256, ext, bytes, taken_at FROM item WHERE owner_id = ? AND id > ? ORDER BY id LIMIT ?").all(owner, after, Math.min(2000, limit)) as any[])
    .map(r => ({ id: r.id, sha256: r.sha256, ext: r.ext, bytes: r.bytes, takenAt: r.taken_at }));
}
export function ackExport(owner: number, ids: number[]) {
  db.transaction(() => { for (const id of ids.slice(0, 5000)) db.query("UPDATE item SET second_copy_at = ? WHERE id = ? AND owner_id = ? AND second_copy_at IS NULL").run(now(), id, owner); })();
}
