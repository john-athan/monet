// The full-text row of one item: OCR text, labels, place, people, file name. Rebuilt whenever one of them changes.
import { db } from "./db";
import { countryName } from "./places";

export function reindexFts(itemId: number) {
  const it = db.query("SELECT ocr_text, orig_name, place_id FROM item WHERE id = ?").get(itemId) as { ocr_text: string | null; orig_name: string | null; place_id: number | null } | null;
  db.query("DELETE FROM item_fts WHERE rowid = ?").run(itemId);
  if (!it) return;
  const labels = (db.query("SELECT label FROM item_label WHERE item_id = ? ORDER BY score DESC").all(itemId) as { label: string }[]).map(r => r.label).join(" ");
  const pl = it.place_id ? db.query("SELECT name, admin1, country FROM place WHERE id = ?").get(it.place_id) as { name: string; admin1: string | null; country: string } | null : null;
  const people = (db.query("SELECT DISTINCT p.name FROM face f JOIN person p ON p.id = f.person_id WHERE f.item_id = ? AND p.name IS NOT NULL").all(itemId) as { name: string }[]).map(r => r.name).join(" ");
  // the file name without its extension, with separators as spaces so "IMG_2019" tokenises sensibly
  const name = (it.orig_name ?? "").replace(/\.[A-Za-z0-9]{2,5}$/, "").replace(/[_\-.]+/g, " ");
  db.query("INSERT INTO item_fts (rowid, ocr_text, labels, place, people, orig_name) VALUES (?, ?, ?, ?, ?, ?)")
    .run(itemId, it.ocr_text ?? "", labels, pl ? `${pl.name} ${pl.admin1 ?? ""} ${countryName(pl.country)}` : "", people, name);
}
