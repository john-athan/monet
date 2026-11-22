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

const MODELS = process.env.MONET_MODELS ?? "models";
const BATCH = 25;
const RETRY_MS = 10 * 60_000;
const failed = new Set<number>(); // skipped until the next start: a photo the worker cannot read must not loop
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

/** False when the worker could not start at all. */
async function batch(items: { id: number; path: string }[]): Promise<boolean> {
  const p = Bun.spawn(self(), { stdin: new Blob([JSON.stringify(items)]), stdout: "pipe", stderr: "inherit" });
  const done = new Set<number>();
  let buf = "";
  const take = (line: string) => {
    if (!line.trim()) return;
    const r = JSON.parse(line) as { id: number; text?: string; error?: string };
    done.add(r.id);
    if (typeof r.text === "string") {
      // the photo may have been deleted or read by the Mac meanwhile: only an unread, live photo takes the text
      const live = db.query("SELECT 1 FROM item WHERE id = ? AND ocr_ok = 0 AND deleted_at IS NULL").get(r.id);
      if (live) { storeOcr(r.id, r.text); reindexFts(r.id); }
    } else { failed.add(r.id); console.error(`ocr ${r.id}: ${r.error}`); }
  };
  for await (const chunk of p.stdout.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  take(buf);
  const code = await p.exited;
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
        if (!again) break;
      }
    } catch (e) { console.error("ocr:", (e as Error).message); }
    finally { running = false; }
  })();
}
