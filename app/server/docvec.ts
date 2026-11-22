// Vectors of files (docs/together.md, "Vectors"): SigLIP 2 vectors of a file's first pages (the image tower, the same
// space as the photos) and of its text pieces (the text tower), made by the darkroom like those of photos. Search reads
// them as int8 in memory, so a library of thousands of files costs a few MB. Labels for files come from the same vectors.
import { db } from "./db";
import { chunkText } from "./chunks";
import { reindexDoc } from "./docs";
import { CLIP_MODEL, DIM, labelShares, SEARCH_FLOOR, SEARCH_Z, vocabMean } from "./search";
import { blobVec, decodeVec, HttpError, normalise, vecBlob } from "./util";

/* Text against text, SigLIP's text tower is poor out of the box: every piece of every file lands at 0.78 +- 0.04 for any
 * query, and a few form-like pieces ("IBAN: BIC: Datum: Unterschrift") come first for everything. Taking out the mean
 * (of the library's pieces, and of the label prompts for the query side) and normalising again spreads them out and
 * removes those hubs. Calibrated on 2026-11-22 with 90 real files of this library (861 pieces) and 30 German queries
 * (docs/together.md): a centred cosine of at least 0.2 that is 3 standard deviations above the library keeps
 * "universität" (4 exam and enrolment papers), "aktien" (3 dividend statements), "internet" (4 papers on networks),
 * "einkaufen" (a receipt), and finds nothing for "auto", "haus" and "wohnung", which the sample has nothing of. */
export const TEXT_FLOOR = 0.2;
export const TEXT_Z = 3.0;
/** pages: the first ones say what a file is; later pages repeat the look */
export const PAGES = 3;
/** labels a file can get from its pages that every page of text would get: they say nothing */
const GENERIC = new Set(["Dokument", "Text", "Buchseite", "Screenshot", "Bildschirmfoto einer App", "Formular", "Tabelle", "Brief", "Zeitung", "Buch"]);

/* ---------- the plan of one file ---------- */
export type DocPlan = { images: string[]; texts: string[] };
type PlanRow = { id: number; kind: string; title: string; text: string | null; pages: number | null; width: number; by_name: string | null; album: string | null };
/** What the darkroom embeds for a file: picture URLs (cover and the next pages) and the text pieces, in this order. */
export function planOf(r: PlanRow, spoken: string | null): DocPlan {
  const images: string[] = [];
  const pictured = r.kind === "doc" || r.kind === "slides" || ((r.kind === "book" || r.kind === "audio") && r.width > 0);
  if (pictured) images.push(`/media/doc/${r.id}/c`);
  if (r.kind === "doc" || r.kind === "slides") for (let n = 2; n <= Math.min(PAGES, r.pages ?? 1); n++) images.push(`/media/doc/${r.id}/t/${n}`);
  const head = r.kind === "audio" ? [r.title, r.by_name, r.album].filter(Boolean).join(" ") : r.kind === "book" && r.by_name ? `${r.title} ${r.by_name}` : r.title;
  return { images, texts: chunkText(head, [r.text, spoken].filter(Boolean).join(" ")) };
}
const PLAN_COLS = "id, owner_id, kind, title, text, pages, width, by_name, album";
const spokenOf = (id: number) => (db.query("SELECT text FROM transcript WHERE ref = 'doc' AND ref_id = ?").get(id) as { text: string } | null)?.text ?? null;
export function planById(id: number): (DocPlan & { owner: number }) | null {
  const r = db.query(`SELECT ${PLAN_COLS} FROM doc WHERE id = ? AND state = 'ok' AND deleted_at IS NULL`).get(id) as (PlanRow & { owner_id: number }) | null;
  return r ? { ...planOf(r, spokenOf(id)), owner: r.owner_id } : null;
}
export type DocPending = DocPlan & { id: number; kind: string };
/** Files waiting for vectors, newest first; `owner` null: the whole household (a browser's darkroom). */
export function pendingDocs(owner: number | null, first: number, limit: number): DocPending[] {
  const rows = db.query(`SELECT ${PLAN_COLS} FROM doc WHERE ${owner == null ? "1" : "owner_id = ?"} AND state = 'ok' AND vec_ok = 0 AND deleted_at IS NULL AND kind != 'other'
    ORDER BY owner_id = ? DESC, uploaded_at DESC LIMIT ?`).all(...(owner == null ? [] : [owner]), first, limit) as PlanRow[];
  return rows.map(r => ({ id: r.id, kind: r.kind, ...planOf(r, spokenOf(r.id)) })).filter(p => p.images.length || p.texts.length);
}

/* ---------- the matrix: int8 rows, one scale each ---------- */
type Mat = { doc: number[]; kind: number[]; q: Int8Array; scale: number[] };
/** Text rows are stored centred on the library's mean text vector (see TEXT_FLOOR); page rows as they are. */
const mats = new Map<number, Mat>();
function quantise(v: Float32Array, q: Int8Array, at: number): number {
  let m = 0;
  for (let i = 0; i < DIM; i++) m = Math.max(m, Math.abs(v[i]));
  const s = m > 0 ? 127 / m : 0;
  for (let i = 0; i < DIM; i++) q[at + i] = Math.round(v[i] * s);
  return m / 127;
}
function matFor(owner: number): Mat {
  let x = mats.get(owner);
  if (x) return x;
  const rows = db.query(`SELECT v.doc_id, v.kind, v.vec FROM doc_vec v JOIN doc d ON d.id = v.doc_id WHERE d.owner_id = ? AND v.model = ? AND d.deleted_at IS NULL ORDER BY v.doc_id, v.seq`).all(owner, CLIP_MODEL) as { doc_id: number; kind: string; vec: Uint8Array }[];
  x = { doc: [], kind: [], q: new Int8Array(rows.length * DIM), scale: [] };
  const vecs = rows.map(r => blobVec(r.vec)), mean = new Float32Array(DIM);
  let nt = 0;
  rows.forEach((r, i) => { if (r.kind === "text") { nt++; for (let k = 0; k < DIM; k++) mean[k] += vecs[i][k]; } });
  if (nt) for (let k = 0; k < DIM; k++) mean[k] /= nt;
  rows.forEach((r, i) => {
    const text = r.kind === "text", v = text ? normalise(vecs[i].map((a, k) => a - mean[k])) : vecs[i];
    x!.doc.push(r.doc_id); x!.kind.push(text ? 1 : 0); x!.scale.push(quantise(v, x!.q, i * DIM));
  });
  mats.set(owner, x);
  return x;
}
export const dropMatrix = (owner: number) => mats.delete(owner);

/** Stores the vectors of one file: `images` and `texts` must be as many as its plan has, in its order. */
export function storeDocVecs(id: number, b: { model?: unknown; images?: unknown; texts?: unknown }) {
  const plan = planById(id);
  if (!plan) throw new HttpError(404, "Das gibt es nicht (mehr).");
  if (b.model !== CLIP_MODEL) throw new HttpError(400, "Unbekanntes Modell.");
  const im = Array.isArray(b.images) ? b.images : [], tx = Array.isArray(b.texts) ? b.texts : [];
  // the file changed since the plan went out (a transcript came in): the darkroom asks again
  if (im.length !== plan.images.length || tx.length !== plan.texts.length) throw new HttpError(409, "Die Datei hat sich geändert.");
  const vecs = [...im.map(v => ({ k: "page", v: decodeVec(v, DIM) })), ...tx.map(v => ({ k: "text", v: decodeVec(v, DIM) }))];
  if (vecs.some(x => !x.v)) throw new HttpError(400, "Ein Vektor ist ungültig.");
  db.transaction(() => {
    db.query("DELETE FROM doc_vec WHERE doc_id = ?").run(id);
    vecs.forEach((x, seq) => db.query("INSERT INTO doc_vec (doc_id, seq, kind, model, vec) VALUES (?, ?, ?, ?, ?)").run(id, seq, x.k, CLIP_MODEL, vecBlob(x.v!)));
    db.query("UPDATE doc SET vec_ok = 1 WHERE id = ?").run(id);
  })();
  dropMatrix(plan.owner);
  labelDoc(id);
}

/* ---------- labels of a file ---------- */
export const DOC_LABEL_SHARE = 0.15;
export const DOC_LABEL_TOP = 3;
/** The labels of a file: what its pages show (as for a photo, without the labels every page of text gets). */
export function labelDoc(id: number) {
  const rows = db.query("SELECT kind, vec FROM doc_vec WHERE doc_id = ? AND model = ? ORDER BY seq").all(id, CLIP_MODEL) as { kind: string; vec: Uint8Array }[];
  const best = new Map<string, number>();
  for (const r of rows) {
    if (r.kind !== "page") continue;
    const shares = labelShares(blobVec(r.vec));
    if (!shares) return;
    for (const [label, share] of shares) if (!GENERIC.has(label) && share > (best.get(label) ?? 0)) best.set(label, share);
  }
  const top = [...best].filter(([, s]) => s >= DOC_LABEL_SHARE).sort((a, b) => b[1] - a[1]).slice(0, DOC_LABEL_TOP);
  db.transaction(() => {
    db.query("DELETE FROM doc_label WHERE doc_id = ?").run(id);
    for (const [label, score] of top) db.query("INSERT INTO doc_label (doc_id, label, score) VALUES (?, ?, ?)").run(id, label, score);
  })();
  reindexDoc(id);
}
export async function relabelDocs() {
  let k = 0;
  for (const r of db.query("SELECT DISTINCT doc_id FROM doc_vec").all() as { doc_id: number }[]) { labelDoc(r.doc_id); if (++k % 50 === 0) await new Promise(res => setTimeout(res, 0)); }
}

/* ---------- search ---------- */
/** Files whose pages or text stand out for the query vector, best first, with their score (the best z of any of their
 *  vectors). Pages are held to the photos' rule (they are images); text pieces to TEXT_Z: text against text runs higher
 *  and wider than text against pictures, so only its own spread says what stands out. */
export function semanticDocs(owners: number[], vec: Float32Array): Map<number, number> {
  const out = new Map<number, number>();
  const mq = vocabMean(), qc = mq ? normalise(vec.map((a, k) => a - mq[k])) : vec;
  for (const o of owners) {
    const m = matFor(o), n = m.doc.length;
    if (n < 2) continue;
    const cos = new Float32Array(n);
    const sum = [0, 0], sq = [0, 0], cnt = [0, 0];
    for (let r = 0; r < n; r++) {
      let s = 0;
      const at = r * DIM, q = m.kind[r] === 1 ? qc : vec;
      for (let i = 0; i < DIM; i++) s += q[i] * m.q[at + i];
      const c = s * m.scale[r];
      cos[r] = c; const k = m.kind[r]; sum[k] += c; sq[k] += c * c; cnt[k]++;
    }
    const mu = [0, 1].map(k => (cnt[k] ? sum[k] / cnt[k] : 0)), sd = [0, 1].map(k => (cnt[k] > 1 ? Math.sqrt(Math.max(1e-9, sq[k] / cnt[k] - mu[k] ** 2)) : 1));
    for (let r = 0; r < n; r++) {
      const k = m.kind[r], z = (cos[r] - mu[k]) / sd[k];
      const ok = k === 0 ? cos[r] >= SEARCH_FLOOR && z >= SEARCH_Z : cos[r] >= TEXT_FLOOR && z >= TEXT_Z;
      if (ok && z > (out.get(m.doc[r]) ?? -Infinity)) out.set(m.doc[r], z);
    }
  }
  return out;
}

export function docVecStats(owner: number) {
  return db.query("SELECT count(*) AS total, coalesce(sum(vec_ok = 1), 0) AS done FROM doc WHERE owner_id = ? AND state = 'ok' AND deleted_at IS NULL AND kind != 'other'").get(owner) as { total: number; done: number };
}
