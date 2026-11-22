// Text in photos, the process that runs the models. onnxruntime holds about 330 MB once loaded and peaks at 610 MB on
// the server (measured 2026-11-21), so it never lives in the server process: server/ocr-queue.ts starts this as a child for a batch,
// and the memory is gone when the batch is done. Input on stdin: JSON [{id, path}] (path: the large thumbnail).
// Output on stdout: one JSON line per item, {id, text} or {id, error}. Runtime: the onnxruntime-web build the
// browser uses (vendor/ort), on its wasm backend with one thread; no extra dependency.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readPpmImage } from "./calc";
import { boxesFromMap, ctcDecode, detInput, readingOrder, recInput, REC_H, type Box } from "./ocr";
import { run } from "./util";

const DIST = process.env.MONET_DIST ?? "dist";
const MODELS = process.env.MONET_MODELS ?? "models";
export const OCR_FILES = { det: "ocr-det.onnx", rec: "ocr-rec.onnx", dict: "ocr-dict.txt" };
const DROP = 0.5; // PaddleOCR's drop_score: a line read with less mean confidence is noise
// a line needs 3 letters or digits: on the first 25 photos the shorter reads were noise ("*", "el", "un")
const WORDY = /[\p{L}\p{N}].*[\p{L}\p{N}].*[\p{L}\p{N}]/u;

export async function ocrWorker(items: { id: number | string; path: string; lines?: boolean }[], write: (line: string) => void) {
  const base = resolve(DIST, "vendor/ort") + "/";
  const ort: any = await import(join(base, "ort.webgpu.min.mjs"));
  ort.env.wasm.wasmPaths = "file://" + base;
  ort.env.wasm.numThreads = 1;
  const model = (f: string) => new Uint8Array(readFileSync(join(MODELS, f)));
  const det = await ort.InferenceSession.create(model(OCR_FILES.det), { executionProviders: ["wasm"] });
  const rec = await ort.InferenceSession.create(model(OCR_FILES.rec), { executionProviders: ["wasm"] });
  const dict = readFileSync(join(MODELS, OCR_FILES.dict), "utf8").replace(/\r/g, "").split("\n");
  if (dict[dict.length - 1] === "") dict.pop();
  const tmp = mkdtempSync(join(tmpdir(), "monet-ocr-"));
  try {
    for (const it of items) {
      try {
        const ppm = join(tmp, "x.ppm");
        await run(["vips", "copy", it.path, ppm], 60_000, { VIPS_CONCURRENCY: "1" });
        const im = readPpmImage(new Uint8Array(readFileSync(ppm)));
        const d = detInput(im);
        const out = await det.run({ [det.inputNames[0]]: new ort.Tensor("float32", d.data, [1, 3, d.h, d.w]) });
        const map = out[det.outputNames[0]].data as Float32Array;
        const boxes: Box[] = boxesFromMap(map, d.w, d.h).map(b => ({ ...b, x: b.x * d.sx, y: b.y * d.sy, w: b.w * d.sx, h: b.h * d.sy }));
        const lines: { box: Box; text: string }[] = [];
        // a page of a document holds far more lines than a photo
        for (const box of boxes.slice(0, it.lines ? 160 : 80)) {
          const r = recInput(im, box);
          const o = (await rec.run({ [rec.inputNames[0]]: new ort.Tensor("float32", r.data, [1, 3, REC_H, r.w]) }))[rec.outputNames[0]];
          const [, steps, classes] = o.dims as number[];
          const t = ctcDecode(o.data as Float32Array, steps, classes, dict);
          if (t.score >= DROP && WORDY.test(t.text)) lines.push({ box, text: t.text });
        }
        const ordered = readingOrder(lines);
        // with `lines`: every line's box as fractions of the picture, for the text layer of a scanned page (server/doctext.ts)
        write(JSON.stringify({ id: it.id, text: ordered.map(l => l.text).join("\n"),
          ...(it.lines ? { lines: ordered.map(l => ({ x: l.box.x / im.w, y: l.box.y / im.h, w: l.box.w / im.w, h: l.box.h / im.h, t: l.text })) } : {}) }));
      } catch (e: any) {
        write(JSON.stringify({ id: it.id, error: String(e?.message ?? e).slice(0, 300) }));
      }
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
