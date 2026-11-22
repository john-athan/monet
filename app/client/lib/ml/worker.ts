/// <reference lib="webworker" />
// The ML worker: SigLIP 2 image and text embeddings (one space, German and English), YuNet face detection and SFace
// face embeddings, all through onnxruntime-web vendored at /vendor/ort/. One request at a time; sessions load lazily
// and are released after 2 minutes without use.
import { getFile, getJson, getText, type Progress } from "./models";
import { imageConfig, placeRect, rgbaToNchw, type ImagePre } from "./preprocess";
import { decodeYunet, faceQuality, nms, umeyama, warpFace, ARCFACE_TEMPLATE, type Det } from "./faces";
import { GemmaBpe } from "./bpe";
import { l2normalize } from "./vec";
import type { Backend, Face, FromWorker, ToWorker } from "./types";

declare const self: DedicatedWorkerGlobalScope;
const IDLE_MS = 120_000;
const MIN_FACE_PX = 24;
const DET_SIZE = 640; // YuNet input when the model is fixed-size; otherwise the longest side is capped to this

let ort: any = null;
let backend: Backend = "auto";
const post = (m: FromWorker, tr: Transferable[] = []) => self.postMessage(m, tr);
const onProgress = (p: Progress) => post({ type: "progress", p });

type Slot = { s: any; ep: string; used: number };
const slots = new Map<string, Slot>();
const loading = new Map<string, Promise<Slot>>();

async function loadOrt() {
  if (ort) return ort;
  const base = new URL("/vendor/ort/", self.location.origin).href;
  ort = await import(/* webpackIgnore: true */ base + "ort.webgpu.min.mjs");
  ort.env.logLevel = "error";
  ort.env.wasm.wasmPaths = base;
  // up to 8 threads: SigLIP 2 B/32 takes 70 ms per image with 4 and 44 ms with 8 on an M4 Pro (docs/ml.md)
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, self.navigator.hardwareConcurrency || 2) : 1;
  return ort;
}

async function hasWebGpu(): Promise<boolean> {
  try { return !!(self.navigator as any).gpu && !!(await (self.navigator as any).gpu.requestAdapter()); } catch { return false; }
}

// Execution providers per model: wasm everywhere, WebGPU only on request (init.backend "webgpu"). Measured in headless
// Chrome (docs/ml.md): the fp16 SigLIP file computes wrong vectors on WebGPU (cosine 0.48 to wasm); only an fp32 file
// would give the same vectors there, and an index must not depend on the device.
const PREFER: Record<string, string[]> = { image: ["wasm"], text: ["wasm"], faceDetect: ["wasm"], faceEmbed: ["wasm"] };

async function session(key: "image" | "text" | "faceDetect" | "faceEmbed"): Promise<Slot> {
  const have = slots.get(key);
  if (have) { have.used = Date.now(); return have; }
  let p = loading.get(key);
  if (!p) {
    p = (async () => {
      const [rt, m] = await Promise.all([loadOrt(), import("./models").then(x => x.loadManifest())]);
      const bytes = await getFile(m.models[key], onProgress);
      let order = backend === "auto" ? PREFER[key] : [backend, ...(backend === "webgpu" ? ["wasm"] : [])];
      const gpu = order.includes("webgpu") ? await hasWebGpu() : false;
      if (!gpu) order = order.filter(e => e !== "webgpu");
      if (!order.length) order = ["wasm"];
      let err: any;
      for (const ep of order) {
        try {
          const s = await rt.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: "all" });
          const slot = { s, ep, used: Date.now() };
          slots.set(key, slot);
          return slot;
        } catch (e) { err = e; }
      }
      throw err;
    })().finally(() => loading.delete(key));
    loading.set(key, p);
  }
  return p;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of slots) if (now - v.used > IDLE_MS && !busy) { slots.delete(k); try { v.s.release(); } catch { /* already gone */ } }
  if (now - lastUse > IDLE_MS && !busy) { imgCfg = null; text = null; }
}, 15_000);

// ---------- SigLIP 2 image ----------
let imgCfg: ImagePre | null = null;
let canvas: OffscreenCanvas | null = null;

async function embedImage(bitmap: ImageBitmap): Promise<Float32Array> {
  imgCfg ??= imageConfig(await getJson("siglip-preprocessor.json", onProgress));
  const { size } = imgCfg;
  canvas ??= new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  // transparent pixels (PNG cut-outs, drawings) count as white paper, like a light viewer shows them
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  const r = placeRect(bitmap.width, bitmap.height, imgCfg);
  ctx.drawImage(bitmap, r.dx, r.dy, r.dw, r.dh);
  const input = rgbaToNchw(ctx.getImageData(0, 0, size, size).data, size, imgCfg);
  const { s } = await session("image");
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, size, size]) });
  const v = l2normalize(new Float32Array(await out[pooled(s)].getData()));
  for (const o of Object.values<any>(out)) o.dispose?.();
  return v;
}

/** Both SigLIP towers end in a pooled vector ("pooler_output"); the image/text projection is already inside it. */
const pooled = (s: any): string => s.outputNames.includes("pooler_output") ? "pooler_output" : s.outputNames[s.outputNames.length - 1];

// ---------- SigLIP 2 text ----------
let text: GemmaBpe | null = null;

async function embedText(q: string): Promise<Float32Array> {
  text ??= new GemmaBpe(await getText("siglip-tokenizer.json", onProgress), 64);
  const { s } = await session("text");
  // SigLIP 2 was trained on lowercased text padded to 64 tokens; both matter (docs/ml.md)
  const ids = text.encode(q.toLowerCase());
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]) });
  const v = l2normalize(new Float32Array(await out[pooled(s)].getData()));
  for (const o of Object.values<any>(out)) o.dispose?.();
  return v;
}

// ---------- faces ----------
function fixedShape(s: any): [number, number] | null {
  const md = s.inputMetadata;
  const m = Array.isArray(md) ? md[0] : md?.[s.inputNames[0]];
  const sh: any[] | undefined = m?.shape;
  return sh && sh.length === 4 && typeof sh[2] === "number" && typeof sh[3] === "number" && sh[2] > 0 && sh[3] > 0 ? [sh[2], sh[3]] : null;
}

async function detectFaces(bitmap: ImageBitmap): Promise<Det[]> {
  const { s } = await session("faceDetect");
  const fixed = fixedShape(s);
  const W0 = bitmap.width, H0 = bitmap.height;
  let IW: number, IH: number, scale: number;
  if (fixed) { [IH, IW] = fixed; scale = Math.min(IW / W0, IH / H0); }
  else { scale = Math.min(1, DET_SIZE / Math.max(W0, H0)); IW = Math.max(32, Math.round(W0 * scale / 32) * 32); IH = Math.max(32, Math.round(H0 * scale / 32) * 32); }
  const c = new OffscreenCanvas(IW, IH), ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, IW, IH);
  ctx.imageSmoothingQuality = "high";
  // fixed-size model: letterbox at the top-left; dynamic: stretch to the 32-multiple (scale differs per axis)
  const dw = fixed ? W0 * scale : IW, dh = fixed ? H0 * scale : IH;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, dw, dh); // under transparent pixels
  ctx.drawImage(bitmap, 0, 0, dw, dh);
  const px = ctx.getImageData(0, 0, IW, IH).data, n = IW * IH, input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { input[i] = px[i * 4 + 2]; input[n + i] = px[i * 4 + 1]; input[2 * n + i] = px[i * 4]; } // BGR, 0..255
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, IH, IW]) });
  const named: Record<string, { data: Float32Array; dims: readonly number[] }> = {};
  for (const k of s.outputNames as string[]) named[k] = { data: new Float32Array(await out[k].getData()), dims: out[k].dims };
  for (const o of Object.values<any>(out)) o.dispose?.();
  const sx = dw / W0, sy = dh / H0; // source -> detector input
  return nms(decodeYunet(named, IW, IH, 0.6), 0.3).map(d => ({ x: d.x / sx, y: d.y / sy, w: d.w / sx, h: d.h / sy, score: d.score, lm: d.lm.map((v, i) => v / (i % 2 ? sy : sx)) }))
    .filter(d => Math.min(d.w, d.h) >= MIN_FACE_PX);
}

async function embedFaces(bitmap: ImageBitmap, dets: Det[]): Promise<Face[]> {
  if (!dets.length) return [];
  const W = bitmap.width, H = bitmap.height;
  const c = new OffscreenCanvas(W, H), ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const { s } = await session("faceEmbed");
  const faces: Face[] = [];
  for (const d of dets) {
    const src = [0, 1, 2, 3, 4].map(i => [d.lm[2 * i], d.lm[2 * i + 1]]);
    const crop = warpFace(rgba, W, H, umeyama(src, ARCFACE_TEMPLATE), 112);
    // SFace (OpenCV blobFromImage with swapRB on a BGR Mat): RGB, 0..255, no normalisation, NCHW
    const input = new Float32Array(3 * 112 * 112);
    for (let i = 0; i < 112 * 112; i++) for (let k = 0; k < 3; k++) input[k * 112 * 112 + i] = crop[i * 3 + k];
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, 112, 112]) });
    const vec = l2normalize(new Float32Array(await out[s.outputNames[0]].getData()));
    for (const o of Object.values<any>(out)) o.dispose?.();
    faces.push({
      x: d.x / W, y: d.y / H, w: d.w / W, h: d.h / H, landmarks: d.lm.map((v, i) => v / (i % 2 ? H : W)),
      score: d.score, quality: faceQuality(d.score, d.w, d.h), vec,
    });
  }
  return faces;
}

// ---------- plumbing ----------
let busy = false, lastUse = Date.now();
let queue: Promise<unknown> = Promise.resolve();

async function handle(m: ToWorker) {
  const ms: Record<string, number> = {};
  const t = async <T>(k: string, f: () => Promise<T>) => { const t0 = performance.now(); const r = await f(); ms[k] = Math.round(performance.now() - t0); return r; };
  try {
    if (m.type === "init") {
      backend = m.backend;
      await loadOrt();
      post({ type: "result", id: m.id, info: { webgpu: await hasWebGpu(), isolated: self.crossOriginIsolated, threads: ort.env.wasm.numThreads, ort: ort.env.versions?.web } });
    } else if (m.type === "info") {
      post({ type: "result", id: m.id, info: { sessions: Object.fromEntries([...slots].map(([k, v]) => [k, v.ep])) } });
    } else if (m.type === "text") {
      const vec = await t("text", () => embedText(m.text));
      post({ type: "result", id: m.id, vec, ms }, [vec.buffer]);
    } else if (m.type === "image") {
      const bm = m.bitmap;
      try {
        const clip = m.clip ? await t("clip", () => embedImage(bm)) : null;
        let faces: Face[] = [];
        if (m.faces) {
          const dets = await t("detect", () => detectFaces(bm));
          faces = await t("faceEmbed", () => embedFaces(bm, dets));
        }
        post({ type: "result", id: m.id, clip, faces, ms }, [...(clip ? [clip.buffer as ArrayBuffer] : []), ...faces.map(f => f.vec.buffer as ArrayBuffer)]);
      } finally { bm.close(); }
    }
  } catch (e: any) {
    post({ type: "error", id: m.id, message: String(e?.message ?? e) });
  }
}

self.onmessage = ({ data }: MessageEvent<ToWorker>) => {
  queue = queue.then(async () => { busy = true; try { await handle(data); } finally { busy = false; lastUse = Date.now(); } });
};
