// Text in photos, the server side of the queue: every photo with thumbnails and no text yet goes to
// server/ocr-worker.ts, which runs as a child process (`monet ocr-worker`) for one batch and then exits, so the
// memory of the models is only held while there is work. One batch at a time, after ingest and at start.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db";
import { reindexFts } from "./fts";
import { thumbPath } from "./ingest";
import { OCR_FILES } from "./ocr-worker";
import { storeOcr } from "./search";
import { pageFile, rowById } from "./docs";
import { OCR_PAGES, storeOcrWords } from "./doctext";
import { textChanged } from "./together";

const MODELS = process.env.MONET_MODELS ?? "models";
const BATCH = 25;
const RETRY_MS = 10 * 60_000;
const failed = new Set<number>(); // skipped until the next start: a photo the worker cannot read must not loop
const failedDocs = new Set<number>();
/* The detector sees a photo at 960 px on its long side; an A4 page shrunk that far has letters 8 to 10 px high and the
 * reader misreads them ("Finanzant Münchon"). A page goes in at DOC_DET, nearly its full 1600 x 2263 px picture.
 * Measured on 2026-11-22, see docs/ml.md. */
export const DOC_DET = Number(process.env.MONET_OCR_DOC_DET ?? 2048);

/** OCR of a scanned file (docs/together.md, "Text on the page"): its first OCR_PAGES pages, as the 1600 px page pictures
 *  the viewer uses, read with line boxes. Then the file is dated, linked and embedded again with its new text.
 *  False when the worker could not start (try later). */
async function scan(id: number): Promise<boolean> {
  const d = rowById(id);
  if (!d || !d.pages) { db.query("UPDATE doc SET words_ok = 3 WHERE id = ?").run(id); return true; }
  const items: { id: number; path: string; lines: true; det: number }[] = [];
  for (let n = 1; n <= Math.min(d.pages, OCR_PAGES); n++) { const f = await pageFile(d, "p", n); if (f) items.push({ id: n, path: f, lines: true, det: DOC_DET }); }
  const pages: { x: number; y: number; w: number; h: number; t: string }[][] = Array.from({ length: d.pages ? Math.min(d.pages, OCR_PAGES) : 0 }, () => []);
  let read = 0;
  const code = await work(items, (r: { id: number; lines?: any[]; error?: string }) => {
    if (Array.isArray(r.lines)) { pages[r.id - 1] = r.lines; read++; } else console.error(`ocr doc ${id} page ${r.id}: ${r.error}`);
  });
  if (code !== 0 && !read) { failedDocs.add(id); return false; }
  storeOcrWords(id, pages);
  await textChanged(id);
  return true;
}
let running = false, again = false;

function pending(): { id: number; path: string }[] {
  const rows = db.query(`SELECT id, sha256 FROM item WHERE kind = 'photo' AND thumbs_ok = 1 AND ocr_ok = 0 AND deleted_at IS NULL
    ORDER BY id LIMIT ?`).all(BATCH + failed.size) as { id: number; sha256: string }[];
  return rows.filter(r => !failed.has(r.id)).slice(0, BATCH).map(r => ({ id: r.id, path: thumbPath(r.sha256, "l") }));
}

/** The command that starts this program again as the worker: the compiled binary, or bun with the script in dev. */
function self(): string[] {
  return Bun.main.includes("$bunfs") ? [process.execPath, "ocr-worker"] : [process.execPath, Bun.main, "ocr-worker"];
}

/** One worker run over `items`; `onLine` gets every answer. Returns the exit code. */
async function work(items: object[], onLine: (r: any) => void): Promise<number> {
  const p = Bun.spawn(self(), { stdin: new Blob([JSON.stringify(items)]), stdout: "pipe", stderr: "inherit" });
  let buf = "";
  const take = (line: string) => { if (line.trim()) onLine(JSON.parse(line)); };
  for await (const chunk of p.stdout.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  take(buf);
  return p.exited;
}

/** False when the worker could not start at all. */
async function batch(items: { id: number; path: string }[]): Promise<boolean> {
  const done = new Set<number>();
  const code = await work(items, (r: { id: number; text?: string; error?: string }) => {
    done.add(r.id);
    if (typeof r.text === "string") {
      // the photo may have been deleted or read by the Mac meanwhile: only an unread, live photo takes the text
      const live = db.query("SELECT 1 FROM item WHERE id = ? AND ocr_ok = 0 AND deleted_at IS NULL").get(r.id);
      if (live) { storeOcr(r.id, r.text); reindexFts(r.id); }
    } else { failed.add(r.id); console.error(`ocr ${r.id}: ${r.error}`); }
  });
  // a worker that died (out of memory, a crash in the runtime) leaves the rest of its batch unread: skip those
  // photos for this run rather than starting it again on the same photos forever
  if (code === 0) return true;
  console.error(`ocr worker exited ${code} after ${done.size} of ${items.length} photos`);
  // nothing read at all: the worker itself is broken (models missing during a deploy), not the photos; try later
  if (!done.size) return false;
  for (const it of items) if (!done.has(it.id)) failed.add(it.id);
  return true;
}

/** Starts reading text if it is not running already; a call while it runs makes it look again when done. */
export function kickOcr() {
  // no models (a dev setup without tools/fetch-models.ts), or under `bun test`: nothing to start
  if (process.env.NODE_ENV === "test" || !existsSync(join(MODELS, OCR_FILES.rec))) return;
  if (running) { again = true; return; }
  running = true;
  (async () => {
    try {
      for (;;) {
        again = false;
        const items = pending();
        if (items.length) {
          if (await batch(items)) continue;
          setTimeout(kickOcr, RETRY_MS).unref();
          break;
        }
        // the photos are read: now one scanned file at a time
        const doc = db.query("SELECT id FROM doc WHERE words_ok = 4 AND state = 'ok' AND deleted_at IS NULL ORDER BY uploaded_at DESC LIMIT 1").get() as { id: number } | null;
        if (doc && !failedDocs.has(doc.id)) { if (await scan(doc.id)) continue; setTimeout(kickOcr, RETRY_MS).unref(); break; }
        if (!again) break;
      }
    } catch (e) { console.error("ocr:", (e as Error).message); }
    finally { running = false; }
  })();
}
